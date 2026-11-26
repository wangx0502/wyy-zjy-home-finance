import { useState } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Layers, Search, ShieldCheck, Upload, Wallet } from 'lucide-react'
import { Categories, Empty, Transactions } from './components.jsx'
import { audit, balances, categoryLabel, cents, format, id, normalize, now, owners, report, states, types, validate } from './ledger.js'
import { download, exportFile } from './files.js'

export function Heading({ title, subtitle, actions }) {
  return <header className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions}</header>
}

function Summary({ label, value, icon: Icon, color }) {
  return <div className="summary-card"><div className="summary-label"><span className={'summary-icon ' + color}><Icon size={18}/></span>{label}</div><strong>{format(value)}</strong></div>
}

function Trend({ data, annual, onSelect }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return <Empty>该期间没有入账流水</Empty>
  const axis = Math.max(1, ...entries.flatMap(([, point]) => [point.income, Math.abs(point.expense)]))
  return <div className="chart-scroll"><div className="chart" style={{ '--column-count': entries.length }}>
    {entries.map(([date, point]) =>
      <button key={date} className="chart-column" onClick={() => onSelect({ from: date, through: date, status: 'posted' })} title={date + ' · 收入 ' + format(point.income) + ' · 支出 ' + format(point.expense)}>
        <span className="bar-pair"><span className="bar income" style={{ height: 100 * point.income / axis + '%' }}/>
          <span className={'bar expense ' + (point.expense < 0 ? 'credit' : '')} style={{ height: 100 * Math.abs(point.expense) / axis + '%' }}/></span>
        <small>{annual ? Number(date.slice(5)) + '月' : date.slice(5).replace('-', '/')}</small>
      </button>)}
  </div></div>
}

export function Overview({ ledger, onEdit, onDetails, openEntry }) {
  const [annual, setAnnual] = useState(false)
  const [month, setMonth] = useState(now().slice(0, 7))
  const [year, setYear] = useState(now().slice(0, 4))
  const [scope, setScope] = useState('all')
  const period = annual ? (/^[1-9]\d{3}$/.test(year) ? year : now().slice(0, 4)) : month
  const metrics = report(ledger, period, scope)
  const detailFilters = { from: period, through: period, scope, status: 'posted' }
  const priorDate = new Date(period + (annual ? '-01-01' : '-01') + 'T00:00:00Z')
  if (annual) priorDate.setUTCFullYear(priorDate.getUTCFullYear() - 1)
  else priorDate.setUTCMonth(priorDate.getUTCMonth() - 1)
  const prior = report(ledger, priorDate.toISOString().slice(0, period.length), scope)
  const includedAccounts = new Set(ledger.accounts.filter(account => scope === 'all' || account.owner === 'joint').map(account => account.id))
  const totalAssets = end => [...balances(ledger, end)].reduce((sum, [account, value]) =>
    sum + (includedAccounts.has(account) ? value : 0), 0)
  const groups = Object.entries(metrics.groups).sort(([, a], [, b]) => b - a)
  const categoryMax = Math.max(1, ...groups.map(([, value]) => Math.abs(value)))
  const recent = [...ledger.transactions].filter(tx => scope === 'all' || ledger.accounts.some(account => account.owner === 'joint' && [tx.account, tx.to].includes(account.id)))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  return <>
    <Heading title="财务总览" subtitle="管理家庭账户、收支与每一笔流水。" actions={<button className="button primary desktop-entry" onClick={openEntry}>＋ 记一笔</button>}/>
    <div className="toolbar overview-toolbar"><div className="segmented"><button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>月报</button><button className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>年报</button></div>
      <label className="compact-control"><CalendarDays size={17}/>{annual ?
        <input type="number" min="1901" max="9999" aria-label="年份" value={year} onChange={event => setYear(event.target.value)}/> :
        <input type="month" aria-label="月份" value={month} onChange={event => event.target.value && setMonth(event.target.value)}/>}</label>
      <select aria-label="统计口径" value={scope} onChange={event => setScope(event.target.value)}><option value="all">全家收支</option><option value="joint">共同账户资金流</option></select>
    </div>
    <div className="summary-grid">
      <Summary label="当前净资产" value={totalAssets()} icon={Wallet} color="amber"/>
      <button className="summary-link" onClick={() => onDetails({ ...detailFilters, type: 'income' })}><Summary label="期间收入" value={metrics.income} icon={ArrowDownLeft} color="green"/></button>
      <button className="summary-link" onClick={() => onDetails({ ...detailFilters, type: 'netExpense' })}><Summary label="期间净支出" value={metrics.expense} icon={ArrowUpRight} color="red"/></button>
      <button className="summary-link" onClick={() => onDetails(detailFilters)}><Summary label="期间结余" value={metrics.net} icon={Layers} color="blue"/></button>
    </div>
    <div className="overview-columns">
      <section className="panel">
        <div className="panel-head"><div><h2>收支趋势</h2><p>点击日期查看流水</p></div><div className="legend"><i/>收入 <i/>净支出</div></div>
        <Trend data={metrics.trend} annual={annual} onSelect={filters => onDetails({ ...filters, scope })}/>
        <div className="trend-meta"><div><small>较{annual ? '上年' : '上月'}结余变化</small><strong>{format(metrics.net - prior.net)}</strong></div>
          <div><small>{scope === 'joint' ? '共同账户净划拨' : '储蓄率'}</small><strong>{scope === 'joint' ? format(metrics.transfersIn - metrics.transfersOut) : (metrics.income ? (100 * metrics.net / metrics.income).toFixed(1) + '%' : '—')}</strong></div>
          {scope === 'joint' && <div><small>共同账户总流入 / 总流出</small><strong>{format(metrics.income + metrics.refunds + metrics.transfersIn)} / {format(metrics.expense + metrics.refunds + metrics.transfersOut)}</strong></div>}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>消费分类</h2><p>按退款冲减后的支出排行</p></div></div>
        {groups.length ? <div className="group-list">{groups.map(([category, value]) => <button key={category} onClick={() => onDetails({ ...detailFilters, category, type: 'netExpense' })}>
          <span>{category}{metrics.expense > 0 && value > 0 ? ' · ' + (100 * value / metrics.expense).toFixed(0) + '%' : ''}</span><strong>{format(value)}</strong><span className="group-track"><i style={{ width: 100 * Math.abs(value) / categoryMax + '%' }}/></span>
        </button>)}</div> : <Empty>暂无分类支出</Empty>}
        {metrics.largest && <button className="text-button left largest" onClick={() => onEdit(metrics.largest)}>最大单笔支出 {format(metrics.largest.amount)} <ArrowRight size={15}/></button>}
      </section>
    </div>
    {annual && <section className="panel"><div className="panel-head"><h2>月度结余与净资产</h2></div>
      <div className="owner-list">{Array.from({ length: 12 }, (_, i) => {
        const date = period + '-' + String(i + 1).padStart(2, '0')
        const month = report(ledger, date, scope)
        return <button key={date} onClick={() => onDetails({ ...detailFilters, from: date, through: date })}>
          <strong>{i + 1} 月</strong><span>结余 {format(month.net)}</span><span>月末净资产 {format(totalAssets(date + '\uffff'))}</span>
        </button>
      })}</div>
    </section>}
    <section className="panel">
      <div className="panel-head"><h2>最近账单</h2><button className="text-button" onClick={() => onDetails({ scope })}>查看全部 <ArrowRight size={16}/></button></div>
      <Transactions rows={recent} ledger={ledger} onEdit={onEdit} compact/>
    </section>
    {scope === 'all' && <section className="panel"><div className="panel-head"><h2>按资金归属</h2></div>
      <div className="owner-list">{Object.entries(owners).map(([key, name]) => <button key={key} onClick={() => onDetails({ ...detailFilters, owner: key })}><strong>{name}</strong><span>收入 {format(metrics.ownerTotals[key].income)}</span><span>净支出 {format(metrics.ownerTotals[key].expense)}</span></button>)}</div>
    </section>}
  </>
}

const PAGE = 30
const blankFilters = { term: '', from: '', through: '', scope: 'all', status: '', account: '', type: '', category: '', owner: '' }
export function Bills({ ledger, filters: initial, onEdit, onBulk, notify }) {
  const [filters, setFilters] = useState({ ...blankFilters, ...initial })
  const [page, setPage] = useState(0)
  const [selection, setSelection] = useState([])
  const [group, setGroup] = useState({ category: '', subcategory: '' })
  const options = ledger.accounts
  const byId = new Map(options.map(account => [account.id, account]))
  const term = normalize(filters.term)
  const rows = ledger.transactions.filter(tx => {
    if (term && !normalize([tx.merchant, tx.description, tx.note, tx.channel, ...tx.sources.map(source => source.order)].join(' ')).includes(term)) return false
    if (filters.from && tx.date < filters.from) return false
    if (filters.through && tx.date > filters.through + '\uffff') return false
    if (filters.scope === 'joint' && ![tx.account, tx.to].some(account => byId.get(account)?.owner === 'joint')) return false
    if (filters.owner && ![tx.account, tx.to].some(account => byId.get(account)?.owner === filters.owner)) return false
    if (filters.account && ![tx.account, tx.to].includes(filters.account)) return false
    if (filters.status && tx.status !== filters.status) return false
    if (filters.type && !(filters.type === 'netExpense' ? ['expense', 'refund'].includes(tx.type) : filters.type === tx.type)) return false
    return !filters.category || categoryLabel(tx, ledger) === filters.category
  }).sort((a, b) => b.date.localeCompare(a.date))
  const activeSelection = rows.filter(tx => selection.includes(tx.id))
  const bulkType = activeSelection[0]?.type
  const bulkAllowed = ['income', 'expense'].includes(bulkType) && activeSelection.every(tx => tx.type === bulkType)
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1))
  const set = patch => {
    setFilters(previous => ({ ...previous, ...patch }))
    setPage(0)
    setSelection([])
  }
  return <>
    <Heading title="账单明细" subtitle={rows.length + ' 笔流水'} actions={<button className="button" onClick={() => exportFile(ledger, rows, 'xlsx').catch(error => notify(error.message, true))}><Download size={17}/> 导出当前结果</button>}/>
    <section className="panel">
      <div className="filter-grid">
        <label className="search"><Search size={17}/><input aria-label="搜索账单" placeholder="搜索商户、备注或订单号" value={filters.term} onChange={event => set({ term: event.target.value })}/></label>
        <select aria-label="筛选账户" value={filters.account} onChange={event => set({ account: event.target.value })}><option value="">所有账户</option>{options.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        <select aria-label="筛选类型" value={filters.type} onChange={event => set({ type: event.target.value })}><option value="">所有类型</option><option value="netExpense">支出和退款</option>{Object.entries(types).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <select aria-label="筛选状态" value={filters.status} onChange={event => set({ status: event.target.value })}><option value="">所有状态</option>{Object.entries(states).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <select aria-label="筛选分类" value={filters.category} onChange={event => set({ category: event.target.value })}><option value="">所有分类</option>{['未分类', ...new Set(ledger.categories.map(item => item.name))].map(name => <option key={name}>{name}</option>)}</select>
        <select aria-label="资金归属" value={filters.owner} onChange={event => set({ owner: event.target.value })}><option value="">全部归属</option>{Object.entries(owners).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <label className="date-filter">起始<input aria-label="开始日期，支持年月或日期" placeholder="YYYY-MM-DD" value={filters.from} onChange={event => set({ from: event.target.value })}/></label>
        <label className="date-filter">截止<input aria-label="结束日期，支持年月或日期" placeholder="YYYY-MM-DD" value={filters.through} onChange={event => set({ through: event.target.value })}/></label>
        <button className="text-button" onClick={() => set(blankFilters)}>重置筛选{filters.scope === 'joint' ? ' · 共同账户' : ''}</button>
      </div>
      {activeSelection.length > 0 && <div className="toolbar bulk">
        <span>选中 {activeSelection.length} 笔</span>
        {bulkAllowed && <><Categories categories={ledger.categories} type={bulkType} {...group} onChange={(category, subcategory) => setGroup({ category, subcategory })}/>
          <button className="button" onClick={() => onBulk(activeSelection, group).then(() => setSelection([])).catch(error => notify(error.message, true))}>修改分类</button></>}
        {!bulkAllowed && <span className="muted">请选择同为收入或同为支出的账单</span>}
      </div>}
      <Transactions rows={rows.slice(currentPage * PAGE, (currentPage + 1) * PAGE)} ledger={ledger} onEdit={onEdit} selectable selected={selection}
        onSelect={id => setSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])}/>
      <Pagination count={rows.length} page={currentPage} onChange={setPage}/>
    </section>
  </>
}

export function Pagination({ count, page, onChange, limit = PAGE }) {
  if (count <= limit) return null
  const last = Math.ceil(count / limit) - 1
  return <div className="pagination"><button className="icon-button" aria-label="上一页" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={19}/></button>
    <span>{page + 1} / {last + 1}</span><button className="icon-button" aria-label="下一页" disabled={page === last} onClick={() => onChange(page + 1)}><ChevronRight size={19}/></button></div>
}

export function Settings({ ledger, onSave, onDetails, notify, busy, onDemo, isCloud }) {
  const [account, setAccount] = useState({ id: '', name: '', owner: 'me', kind: 'wallet', opening: '0' })
  const [category, setCategory] = useState({ name: '', children: '', income: false })
  const [rule, setRule] = useState({ merchant: '', type: 'expense', category: '', subcategory: '' })
  const current = balances(ledger)
  const handle = async callback => { try { await callback() } catch (error) { notify(error.message, true) } }
  async function saveAccount(event) {
    event.preventDefault()
    await handle(async () => {
      const copy = structuredClone(ledger)
      const old = copy.accounts.find(item => item.id === account.id)
      const entry = { ...account, id: account.id || id(), name: account.name.trim(), opening: cents(account.opening) }
      if (!entry.name) throw new Error('请填写账户名称')
      if (old) copy.accounts[copy.accounts.indexOf(old)] = entry
      else copy.accounts.push(entry)
      audit(copy, old ? '编辑账户' : '添加账户', old, entry)
      await onSave(copy, '账户已保存')
      setAccount({ id: '', name: '', owner: 'me', kind: 'wallet', opening: '0' })
    })
  }
  async function saveCategory(event) {
    event.preventDefault()
    await handle(async () => {
      const copy = structuredClone(ledger)
      const name = category.name.trim()
      const children = [...new Set(category.children.split(/[，,、]/).map(item => item.trim()).filter(Boolean))]
      const old = copy.categories.find(item => item.name === name && Boolean(item.income) === category.income)
      if (!name) throw new Error('请填写一级分类名称')
      if (old) old.children = [...new Set([...old.children, ...children])]
      else copy.categories.push({ name, income: category.income, children })
      await onSave(copy, '分类已保存')
      setCategory({ name: '', children: '', income: false })
    })
  }
  async function saveRule(event) {
    event.preventDefault()
    await handle(async () => {
      const copy = structuredClone(ledger)
      const merchant = normalize(rule.merchant)
      if (!merchant || !rule.category) throw new Error('请填写商户并选择分类')
      copy.rules = copy.rules.filter(item => item.merchant !== merchant || item.type !== rule.type)
      copy.rules.unshift({ ...rule, merchant })
      await onSave(copy, '商户规则已保存')
      setRule({ merchant: '', type: 'expense', category: '', subcategory: '' })
    })
  }
  return <>
    <Heading title="账户与设置" subtitle="管理资金归属、记账规则和数据备份。"/>
    <div className="settings-grid">
      <section className="panel"><div className="panel-head"><h2>资金账户</h2></div>
        <div className="account-list">{ledger.accounts.map(item => <div key={item.id}><button className="text-button" onClick={() => onDetails({ account: item.id })}>{item.name} · {owners[item.owner]}</button>
          <strong>{format(current.get(item.id))}</strong><button className="text-button" onClick={() => setAccount({ ...item, opening: (item.opening / 100).toFixed(2) })}>编辑</button></div>)}</div>
        <form className="form-stack settings-form" onSubmit={saveAccount}>
          <h3>{account.id ? '编辑账户' : '添加账户'}</h3>
          <div className="form-grid">
            <label>名称<input required value={account.name} onChange={event => setAccount({ ...account, name: event.target.value })}/></label>
            <label>归属<select value={account.owner} onChange={event => setAccount({ ...account, owner: event.target.value })}>{Object.entries(owners).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
            <label>账户类型<select value={account.kind} onChange={event => setAccount({ ...account, kind: event.target.value })}>{Object.entries({ wallet: '电子钱包', bank: '银行卡', cash: '现金', credit: '信用卡', loan: '借款', other: '其他' }).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
            <label>初始余额（元）<input required value={account.opening} inputMode="decimal" onChange={event => setAccount({ ...account, opening: event.target.value })}/></label>
          </div><button className="button left" disabled={busy}>保存账户</button>
        </form>
      </section>
      <section className="panel"><div className="panel-head"><h2>分类管理</h2></div>
        <form className="form-stack" onSubmit={saveCategory}>
          <div className="form-grid">
            <label>一级分类<input required value={category.name} onChange={event => setCategory({ ...category, name: event.target.value })}/></label>
            <label>分类类型<select value={category.income ? 'income' : 'expense'} onChange={event => setCategory({ ...category, income: event.target.value === 'income' })}><option value="expense">支出</option><option value="income">收入</option></select></label>
            <label className="full">二级分类（用逗号分隔）<input value={category.children} onChange={event => setCategory({ ...category, children: event.target.value })}/></label>
          </div><button className="button left" disabled={busy}>保存分类</button>
        </form>
        <form className="form-stack settings-form" onSubmit={saveRule}><h3>商户分类规则</h3>
          <div className="form-grid">
            <label>商户名称<input required value={rule.merchant} onChange={event => setRule({ ...rule, merchant: event.target.value })}/></label>
            <label>交易类型<select value={rule.type} onChange={event => setRule({ ...rule, type: event.target.value, category: '', subcategory: '' })}><option value="expense">支出</option><option value="income">收入</option></select></label>
            <Categories categories={ledger.categories} {...rule} onChange={(category, subcategory) => setRule({ ...rule, category, subcategory })}/>
          </div><button className="button left" disabled={busy}>保存规则</button>
        </form>
        {ledger.rules.length > 0 && <div className="account-list">{ledger.rules.map(item => <div key={item.type + ':' + item.merchant}>
          <span>{item.merchant} → {item.category}{item.subcategory ? ' / ' + item.subcategory : ''}</span>
          <button className="text-button" disabled={busy} onClick={() => handle(() => onSave({ ...ledger, rules: ledger.rules.filter(rule => rule !== item) }, '规则已移除'))}>移除</button></div>)}</div>}
      </section>
    </div>
    <section className="panel">
      <div className="panel-head"><div><h2>备份与导出</h2><p><ShieldCheck size={15}/> {isCloud ? '账本保存至你的 Supabase 项目' : '本地体验模式 · 数据保存在当前浏览器'}</p></div></div>
      <div className="toolbar">
        <button className="button" onClick={() => handle(() => exportFile(ledger, ledger.transactions, 'xlsx'))}><FileSpreadsheet size={17}/> 导出 Excel</button>
        <button className="button" onClick={() => handle(() => exportFile(ledger, ledger.transactions, 'csv'))}><Download size={17}/> 导出 CSV</button>
        <button className="button" onClick={() => download(JSON.stringify(ledger, null, 2), '家庭账本备份-' + now().slice(0, 10) + '.json', 'application/json')}><Download size={17}/> 下载备份</button>
        <label className="button file-label"><Upload size={17}/> 恢复备份<input type="file" aria-label="恢复备份" accept=".json" disabled={busy} onChange={event => {
          const file = event.target.files[0]
          event.target.value = ''
          if (!file) return
          handle(async () => {
            const restored = validate(JSON.parse(await file.text()))
            if (window.confirm('恢复备份会替换当前账本。要继续吗？')) await onSave(restored, '备份已恢复')
          })
        }}/></label>
        {onDemo && <button className="button" disabled={busy} onClick={() => handle(onDemo)}>载入模拟账单</button>}
      </div>
      {ledger.history.length > 0 && <details className="history"><summary>最近修改历史</summary>
        {ledger.history.slice(0, 30).map(item => <details key={item.id}><summary>{item.action} · {new Date(item.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</summary><pre>{JSON.stringify({ 修改前: item.before, 修改后: item.after }, null, 2)}</pre></details>)}</details>}
    </section>
  </>
}
