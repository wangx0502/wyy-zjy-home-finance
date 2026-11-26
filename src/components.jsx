import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CircleHelp, Receipt, RotateCcw, X } from 'lucide-react'
import { amountText, categoryLabel, cents, format, makeTransaction, owners, states, types } from './ledger.js'

const symbols = { expense: ArrowUpRight, income: ArrowDownLeft, transfer: ArrowLeftRight, refund: RotateCcw, adjustment: Receipt }

export function Empty({ children = '暂无账单' }) {
  return <div className="empty"><CircleHelp size={23} strokeWidth={1.5}/><span>{children}</span></div>
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></div>
    {children}
  </dialog>
}

export function AccountOptions({ accounts }) {
  return <><option value="">选择账户</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {owners[account.owner]}</option>)}</>
}

export function Categories({ categories, type, category, subcategory, onChange }) {
  const groups = categories.filter(group => Boolean(group.income) === (type === 'income'))
  const children = groups.find(group => group.name === category)?.children || []
  return <>
    <label>一级分类<select value={category || ''} onChange={event => onChange(event.target.value, '')}>
      <option value="">未分类</option>{groups.map(group => <option key={group.name}>{group.name}</option>)}
    </select></label>
    <label>二级分类<select value={subcategory || ''} onChange={event => onChange(category, event.target.value)} disabled={!children.length}>
      <option value="">无</option>{children.map(child => <option key={child}>{child}</option>)}
    </select></label>
  </>
}

export function EntryForm({ ledger, original, onSubmit, onDelete, onClose, busy }) {
  const [data, setData] = useState(() => original || makeTransaction({ account: ledger.accounts[0]?.id || '', confirmed: true }))
  const [amount, setAmount] = useState(() => data.amount ? amountText(data.amount) : '')
  const [error, setError] = useState('')
  const [advanced, setAdvanced] = useState(Boolean(original))
  const update = patch => setData(previous => ({ ...previous, ...patch }))
  const field = name => ({ value: data[name] ?? '', onChange: event => update({ [name]: event.target.value }) })
  const applicable = ['income', 'expense'].includes(data.type)
  const possibleRefunds = ledger.transactions.filter(tx => tx.type === 'expense' && tx.status === 'posted' && tx.id !== data.id)
    .sort((a, b) => b.date.localeCompare(a.date))
  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      const total = cents(amount)
      if (!total || (data.type !== 'adjustment' && total < 0)) throw new Error('请填写有效的交易金额')
      if (data.status === 'posted' && !data.account) throw new Error('请选择账户')
      if (data.type === 'transfer' && data.status === 'posted' && (!data.to || data.account === data.to)) throw new Error('请选择两个不同的账户')
      await onSubmit({ ...data, amount: total, merchant: data.merchant.trim(), description: data.description.trim() })
    } catch (error) {
      setError(error.message)
    }
  }
  return <form className="form-stack" onSubmit={submit}>
    {error && <p className="alert" role="alert">{error}</p>}
    <div className="segmented wrap" aria-label="交易类型">{Object.entries(types).map(([key, label]) =>
      <button type="button" key={key} className={data.type === key ? 'active' : ''} onClick={() => update({ type: key, to: '', related: '', category: '', subcategory: '', method: '', confidence: null })}>{label}</button>
    )}</div>
    <div className="form-grid">
      <label>金额（元）<input required inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)}/></label>
      <label>{data.type === 'transfer' ? '转出账户' : '账户'}<select {...field('account')}><AccountOptions accounts={ledger.accounts}/></select></label>
      {data.type === 'transfer' && <label>转入账户<select {...field('to')}><AccountOptions accounts={ledger.accounts.filter(account => account.id !== data.account)}/></select></label>}
      {data.type === 'refund' && <label className="full">原支出<select {...field('related')}>
        <option value="">暂未关联</option>{possibleRefunds.map(tx => <option key={tx.id} value={tx.id}>{tx.date.slice(0, 10)} · {tx.merchant || tx.description || '支出'} · {format(tx.amount)}</option>)}
      </select></label>}
      <label>商户 / 对方<input {...field('merchant')} placeholder="选填"/></label>
      <label>交易时间<input required type="datetime-local" step="1" {...field('date')}/></label>
      {applicable && <Categories categories={ledger.categories} type={data.type} category={data.category} subcategory={data.subcategory} onChange={(category, subcategory) => update({ category, subcategory, method: '', confidence: null, confirmed: true })}/>}
    </div>
    {!advanced && <button className="text-button left" type="button" onClick={() => setAdvanced(true)}>更多字段</button>}
    {advanced && <div className="form-grid">
      <label>商品或描述<input {...field('description')}/></label>
      <label>消费渠道<input {...field('channel')}/></label>
      <label>状态<select {...field('status')}>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>备注<input {...field('note')}/></label>
      {applicable && <label className="check"><input type="checkbox" checked={data.confirmed} onChange={event => update({ confirmed: event.target.checked })}/> 分类已确认</label>}
    </div>}
    {applicable && data.method && <small className="muted">分类来源 {data.method}{data.confidence != null ? ' · 置信度 ' + Math.round(data.confidence * 100) + '%' : ''}</small>}
    {original?.sources?.length > 0 && <details><summary>原始流水（{original.sources.length}）</summary>
      {original.sources.map(source => <dl className="raw" key={source.key}>
        {Object.entries(source.raw).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}
      </dl>)}
    </details>}
    {original && ledger.history.some(record => [record.before?.id, record.after?.id].includes(original.id)) && <details>
      <summary>修改历史</summary>
      {ledger.history.filter(record => [record.before?.id, record.after?.id].includes(original.id)).map(record =>
        <details key={record.id} className="audit-entry"><summary>{record.action} · {new Date(record.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</summary>
          <pre>{JSON.stringify({ 修改前: record.before, 修改后: record.after }, null, 2)}</pre></details>)}
    </details>}
    <div className="dialog-actions">
      {onDelete && <button type="button" className="button danger" disabled={busy} onClick={() => onDelete(original).catch(error => setError(error.message))}>删除</button>}
      <button type="button" className="button" onClick={onClose}>取消</button>
      <button type="submit" className="button primary" disabled={busy}>保存</button>
    </div>
  </form>
}

export function Transactions({ rows, ledger, onEdit, selectable, selected, onSelect, compact = false }) {
  if (!rows.length) return <Empty/>
  const accounts = new Map(ledger.accounts.map(account => [account.id, account.name]))
  return <div className="transaction-list">{rows.map(tx => {
    const Icon = symbols[tx.type]
    const prefix = tx.type === 'income' || tx.type === 'refund' ? '+' : tx.type === 'expense' ? '−' : ''
    const detail = [categoryLabel(tx, ledger) === '未分类' ? types[tx.type] : categoryLabel(tx, ledger), accounts.get(tx.account), tx.type === 'transfer' && accounts.get(tx.to) ? '→ ' + accounts.get(tx.to) : '', tx.date.slice(5, 10).replace('-', '/')]
    return <div className="transaction-line" key={tx.id}>
      {selectable && <input type="checkbox" aria-label={'选择 ' + (tx.merchant || types[tx.type])} checked={selected.includes(tx.id)} onChange={() => onSelect(tx.id)}/>}
      <button className="transaction" onClick={() => onEdit(tx)}>
        <span className={'tx-icon ' + tx.type}><Icon size={17}/></span>
        <span className="tx-title"><strong>{tx.merchant || tx.description || types[tx.type]}</strong><small>{detail.filter(Boolean).join(' · ')}</small></span>
        {!compact && <span className="tx-status">{tx.status !== 'posted' ? states[tx.status] : (!tx.confirmed && ['income', 'expense'].includes(tx.type) ? '待确认分类' : '')}</span>}
        <span className={'tx-amount ' + tx.type}>{prefix}{format(tx.amount)}</span>
      </button>
    </div>
  })}</div>
}
