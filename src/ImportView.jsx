import { useRef, useState } from 'react'
import { FileUp, Sparkles, UploadCloud } from 'lucide-react'
import { AccountOptions, Empty, EntryForm, Modal } from './components.jsx'
import { Heading, Pagination } from './views.jsx'
import { commitImport, getCandidates, parseFile, parseRows } from './importer.js'
import { format, states, types } from './ledger.js'
import { supabase } from './storage.js'

const platformNames = { wechat: '微信支付', alipay: '支付宝', bank: '银行卡（通用格式）' }
const pageSize = 20
const windowInfo = {
  all: '全部流水', issues: '需核对', duplicates: '重复记录',
}

export function ImportView({ ledger, commit, notify, busy, aiEnabled }) {
  const [platform, setPlatform] = useState('wechat')
  const [account, setAccount] = useState('')
  const [entries, setEntries] = useState([])
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState(null)
  const [paymentAccounts, setPaymentAccounts] = useState({})
  const file = useRef()
  const selected = entries.filter(item => item.include)
  const issues = item => item.warnings.length || item.errors.length || item.candidates.length
  const filtered = entries.filter(item => filter === 'all' || (filter === 'issues' ? issues(item) && !item.duplicate : item.duplicate))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1))
  const availableAi = entries.filter(item => item.needsAi && item.include)
  const paymentMethods = [...new Set(entries.map(item => item.tx.sources[0].payment).filter(Boolean))]
  function update(line, patch) {
    setEntries(previous => previous.map(item => item.line === line ? { ...item, ...patch } : item))
  }
  function reset() {
    setEntries([])
    setFileName('')
    setPage(0)
    setFilter('all')
    setPaymentAccounts({})
  }
  function assignPayment(payment, accountId) {
    const assigned = accountId || account
    setPaymentAccounts(previous => ({ ...previous, [payment]: accountId }))
    setEntries(previous => previous.map(item => {
      if (item.duplicate || item.tx.sources[0].payment !== payment || item.tx.account === assigned) return item
      const tx = { ...item.tx, account: assigned }
      if (tx.to === assigned) {
        tx.to = ''
        tx.status = 'pending'
      }
      const candidates = getCandidates(tx, ledger.transactions, platform)
      return { ...item, tx, candidates, match: '', include: item.include && !candidates.length }
    }))
  }
  async function read(event) {
    const selectedFile = event.target.files[0]
    event.target.value = ''
    if (!selectedFile) return
    if (!account) return notify('请先选择此次导入的账户', true)
    setReading(true)
    reset()
    try {
      const result = parseRows(await parseFile(selectedFile), platform, ledger, account)
      if (!result.length) throw new Error('文件中没有可预览的流水')
      setEntries(result)
      setFileName(selectedFile.name)
    } catch (error) {
      notify(error.message, true)
    } finally {
      setReading(false)
    }
  }
  async function ai() {
    if (!availableAi.length) return
    if (!window.confirm('将发送待分类的商户名和商品描述片段给你配置的 AI 服务。请确认你已授权该服务处理这些字段。')) return
    setThinking(true)
    let count = 0
    try {
      for (let start = 0; start < availableAi.length; start += 20) {
        const batch = availableAi.slice(start, start + 20)
        const { data, error } = await supabase.functions.invoke('classify', {
          body: {
            rows: batch.map(item => ({ line: item.line, merchant: item.tx.merchant.slice(0, 100), description: item.tx.description.slice(0, 180), type: item.tx.type })),
            categories: ledger.categories.map(({ name, income }) => ({ name, income: Boolean(income) })),
          },
        })
        if (error || !Array.isArray(data?.suggestions)) throw new Error('AI 分类服务暂不可用，已保留现有分类')
        const suggestions = new Map(data.suggestions.map(item => [item.line, item]))
        setEntries(previous => previous.map(item => {
          if (!batch.some(row => row.line === item.line)) return item
          const suggestion = suggestions.get(item.line)
          const valid = ledger.categories.some(group => group.name === suggestion?.category && Boolean(group.income) === (item.tx.type === 'income'))
          return { ...item, needsAi: false, tx: valid ? { ...item.tx, category: suggestion.category, subcategory: '', method: 'AI 推荐', confidence: suggestion.confidence } : item.tx }
        }))
        count += batch.filter(item => suggestions.has(item.line)).length
      }
      notify('AI 返回 ' + count + ' 条建议，请核对后确认导入')
    } catch (error) {
      notify(error.message, true)
    } finally {
      setThinking(false)
    }
  }
  async function finish() {
    try {
      const result = commitImport(ledger, entries)
      await commit(result.ledger, '已新增 ' + result.added + ' 笔，合并 ' + result.linked + ' 笔来源')
      reset()
    } catch (error) {
      notify(error.message, true)
    }
  }
  return <>
    <Heading title="导入账单" subtitle="上传微信支付或支付宝的导出文件，核对后批量入账。"/>
    <section className="panel">
      <div className="panel-head"><div><h2>选择文件</h2><p>支持 CSV、XLSX。原始字段会随流水保存。</p></div><FileUp className="muted" size={22}/></div>
      <div className="form-grid import-config">
        <label>账单来源<select value={platform} disabled={reading || thinking || busy} onChange={event => { setPlatform(event.target.value); reset() }}>{Object.entries(platformNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>默认入账账户<select value={account} disabled={reading || thinking || busy} onChange={event => { setAccount(event.target.value); reset() }}><AccountOptions accounts={ledger.accounts}/></select></label>
      </div>
      <button className="upload-zone" disabled={reading || thinking || busy} onClick={() => account ? file.current.click() : notify('请先选择此次导入的账户', true)}>
        <span><UploadCloud size={25}/></span><strong>{reading ? '正在解析…' : fileName || '选择账单文件'}</strong><small>{fileName ? '点击替换文件' : 'CSV 或 XLSX'}</small>
      </button>
      <input ref={file} type="file" accept=".csv,.xlsx" className="visually-hidden" tabIndex={-1} aria-label="账单文件" onChange={read}/>
      {platform === 'bank' && <a className="text-button sample-link" href="./bank-template.csv" download>下载通用模板</a>}
    </section>
    {entries.length > 0 && <section className="panel">
      <div className="panel-head"><div><h2>导入预览</h2><p>{entries.length} 条原始流水 · 已选 {selected.length} 条</p></div></div>
      <div className="toolbar preview-toolbar">
        <div className="segmented">{Object.entries(windowInfo).map(([key, name]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => { setFilter(key); setPage(0) }}>{name}{key === 'issues' ? ' ' + entries.filter(item => issues(item) && !item.duplicate).length : key === 'duplicates' ? ' ' + entries.filter(item => item.duplicate).length : ''}</button>)}</div>
        {aiEnabled && <button className="button" disabled={thinking || busy || !availableAi.length} onClick={ai}><Sparkles size={16}/> {thinking ? '正在分类…' : 'AI 补充分类'}</button>}
      </div>
      <p className="muted import-note">请核对原支付方式与入账账户。待核对的交易保留在明细中，确认入账后纳入统计。</p>
      {paymentMethods.length > 0 && <details className="payment-map">
        <summary>按支付方式批量匹配账户（{paymentMethods.length} 种）</summary>
        <div className="form-grid">{paymentMethods.map(payment => <label key={payment}>{payment}
          <select value={paymentAccounts[payment] || ''} disabled={thinking || busy} onChange={event => assignPayment(payment, event.target.value)}>
            <option value="">使用默认账户</option>{ledger.accounts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>)}</div>
      </details>}
      {filtered.length === 0 && <Empty>没有匹配的记录</Empty>}
      {filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => <div className="import-item" key={item.line}>
        <input type="checkbox" aria-label={'导入第 ' + item.line + ' 行'} checked={item.include} disabled={item.duplicate || Boolean(item.errors.length) || thinking || busy} onChange={event => update(item.line, { include: event.target.checked })}/>
        <div className="import-data">
          <div className="import-row"><strong>{item.tx.merchant || item.tx.description || '第 ' + item.line + ' 行'}</strong><strong>{item.tx.amount ? format(item.tx.amount) : '—'}</strong></div>
          <small>{[item.tx.date.replace('T', ' '), types[item.tx.type], states[item.tx.status], item.tx.sources[0].payment,
            ledger.accounts.find(account => account.id === item.tx.account)?.name, item.tx.category, item.tx.subcategory,
            item.tx.method, item.tx.confidence != null && Math.round(item.tx.confidence * 100) + '%'].filter(Boolean).join(' · ')}</small>
          {(item.duplicate || item.errors.length > 0 || item.warnings.length > 0) && <small className="warning">{item.duplicate ? '检测到已存在的流水' : [...item.errors, ...item.warnings].join(' · ')}</small>}
          {item.candidates.length > 0 && <label className="candidate">疑似同一交易<select value={item.match || (item.include ? 'new' : '')} disabled={thinking || busy || item.duplicate} onChange={event => update(item.line, { match: event.target.value === 'new' ? '' : event.target.value, include: Boolean(event.target.value) })}>
            <option value="">稍后核对</option><option value="new">作为新流水导入</option>{item.candidates.map(tx => <option key={tx.id} value={tx.id}>合并至 {tx.date.replace('T', ' ')} · {tx.merchant || tx.description || types[tx.type]}</option>)}
          </select></label>}
        </div>
        <button className="text-button" disabled={thinking || busy || item.duplicate} onClick={() => setEditing(item)}>核对</button>
      </div>)}
      <Pagination count={filtered.length} page={currentPage} onChange={setPage} limit={pageSize}/>
      <div className="panel-actions"><button className="button primary" disabled={busy || thinking || !selected.length} onClick={finish}>确认导入 {selected.length} 笔</button></div>
    </section>}
    {editing && <Modal title={'核对第 ' + editing.line + ' 行'} onClose={() => setEditing(null)}>
      <EntryForm ledger={ledger} original={editing.tx} onClose={() => setEditing(null)} onSubmit={tx => {
        const candidates = getCandidates(tx, ledger.transactions, platform)
        update(editing.line, { tx, errors: [], warnings: tx.status === 'pending' ? ['待核对'] : [], candidates, match: '', include: candidates.length === 0, needsAi: false })
        setEditing(null)
      }}/>
    </Modal>}
  </>
}
