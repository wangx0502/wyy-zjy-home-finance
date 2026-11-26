import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Cloud, CloudOff, LayoutGrid, List, LogOut, Plus, RefreshCw, UploadCloud, Wallet, X } from 'lucide-react'
import { EntryForm, Modal } from './components.jsx'
import { Bills, Overview, Settings } from './views.jsx'
import { ImportView } from './ImportView.jsx'
import { audit, remember } from './ledger.js'
import { loadLedger, saveLedger, supabase } from './storage.js'
import { makeDemo } from './demo.js'
import './style.css'

const menu = [
  ['overview', '财务总览', LayoutGrid], ['bills', '账单明细', List],
  ['import', '导入账单', UploadCloud], ['settings', '账户设置', Wallet],
]

function Login() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    })
    setMessage(error ? '登录邮件发送失败，请确认邮箱已获得授权。' : '已发送登录链接，请检查你的邮箱。')
    setBusy(false)
  }
  return <main className="auth"><div className="panel">
    <span className="brand-icon"><BookOpen size={22}/></span><h1>家庭账本</h1><p>使用管理员邮箱登录。</p>
    <form className="form-stack" onSubmit={submit}><label>邮箱<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required/></label>
      <button className="button primary" disabled={busy}>{busy ? '正在发送…' : '发送登录链接'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </div></main>
}

function Workspace({ user }) {
  const [model, setModel] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('overview')
  const [detail, setDetail] = useState({ filters: {}, version: 0 })
  const [entry, setEntry] = useState(null)
  const [toast, setToast] = useState(null)
  const lock = useRef(false)
  const userId = user?.id
  const load = useCallback(async () => loadLedger(userId ? { id: userId } : null), [userId])
  useEffect(() => {
    let active = true
    load().then(value => { if (active) setModel(value) }).catch(error => { if (active) setLoadError(error.message) })
    return () => { active = false }
  }, [load])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), 5500)
    return () => clearTimeout(timeout)
  }, [toast])
  const notify = (text, error = false) => setToast({ text, error })
  async function refresh() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      setModel(await load())
      setLoadError('')
      notify('账本已刷新')
    } catch (error) {
      setLoadError(error.message)
      notify(error.message, true)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function commit(next, message) {
    if (lock.current) throw new Error('账本正在保存，请稍候')
    lock.current = true
    setBusy(true)
    try {
      const revision = await saveLedger(next, model.revision)
      setModel({ ledger: next, revision })
      notify(message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const edit = tx => setEntry({ tx })
  const newEntry = () => setEntry({})
  function navigate(next) {
    if (next === 'bills') setDetail(previous => ({ filters: {}, version: previous.version + 1 }))
    setView(next)
    window.scrollTo(0, 0)
  }
  function onDetails(filters) {
    setDetail(previous => ({ filters, version: previous.version + 1 }))
    setView('bills')
    window.scrollTo(0, 0)
  }
  if (!model) return <main className="auth"><div className="panel"><h1>家庭账本</h1><p>{loadError || '正在加载账本…'}</p>{loadError && <div className="toolbar">
    <button className="button" disabled={busy} onClick={refresh}>重试</button>{supabase && <button className="button" onClick={() => supabase.auth.signOut()}>退出登录</button>}
  </div>}</div></main>

  const { ledger } = model
  async function saveTransaction(tx) {
    const copy = structuredClone(ledger)
    const index = copy.transactions.findIndex(item => item.id === tx.id)
    const old = index === -1 ? null : copy.transactions[index]
    if (entry.tx && JSON.stringify(entry.tx) !== JSON.stringify(old)) throw new Error('这笔交易已变化，请关闭并重新打开后再编辑')
    if (old) copy.transactions[index] = tx
    else copy.transactions.push(tx)
    remember(copy, tx)
    audit(copy, old ? '编辑账单' : '快速记账', old, tx)
    await commit(copy, old ? '账单已更新' : '已记一笔')
    setEntry(null)
  }
  async function remove(tx) {
    if (JSON.stringify(tx) !== JSON.stringify(ledger.transactions.find(item => item.id === tx.id))) throw new Error('这笔交易已变化，请关闭并重新打开后再编辑')
    if (!window.confirm('确定删除这笔交易吗？原始记录仍可在审计历史中查看。')) return
    const copy = structuredClone(ledger)
    copy.transactions = copy.transactions.filter(item => item.id !== tx.id)
    audit(copy, '删除账单', tx, null)
    await commit(copy, '账单已删除')
    setEntry(null)
  }
  async function bulk(rows, category) {
    const copy = structuredClone(ledger)
    const selected = new Set(rows.map(row => row.id))
    copy.transactions = copy.transactions.map(tx => {
      if (!selected.has(tx.id)) return tx
      const updated = { ...tx, ...category, confirmed: true, method: '', confidence: null }
      remember(copy, updated)
      audit(copy, '批量修改分类', tx, updated)
      return updated
    })
    await commit(copy, '已更新 ' + rows.length + ' 笔账单')
  }
  async function loadDemo() {
    if (ledger.transactions.length && !window.confirm('载入模拟账单会替换当前本地账本。是否继续？')) return
    await commit(makeDemo(), '已载入模拟账单')
    navigate('overview')
  }
  return <div className="app">
    <aside className="sidebar"><div className="brand">
      <span className="brand-icon"><BookOpen size={21}/></span><div><strong>家庭账本</strong><small>个人家庭财务</small></div>
    </div>
      <div className="nav-heading">工作台</div>
      <nav aria-label="主导航">{menu.map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={19}/>{label}</button>)}</nav>
      <div className="side-bottom">
        <button className="button primary side-entry" onClick={newEntry}><Plus size={18}/> 快速记账</button>
        <div className="connection">{supabase ? <Cloud size={17}/> : <CloudOff size={17}/>} <span>{supabase ? '云端账本' : '本地体验'}</span></div>
        {supabase && <button className="text-button" onClick={() => supabase.auth.signOut()}><LogOut size={16}/> 退出登录</button>}
      </div>
    </aside>
    <div className="workspace">
      <div className="topbar"><div className="mobile-brand"><BookOpen size={19}/> 家庭账本</div><span className="breadcrumb">{menu.find(item => item[0] === view)?.[1]}</span>
        <button className="text-button refresh" disabled={busy} onClick={refresh}><RefreshCw size={16}/> <span>刷新账本</span></button>
        {supabase && <button className="icon-button mobile-signout" aria-label="退出登录" onClick={() => supabase.auth.signOut()}><LogOut size={17}/></button>}
      </div>
      <main className="content">
        {!supabase && !ledger.transactions.length && view === 'overview' && <div className="demo-note"><span>本地体验模式 · 数据保存在当前浏览器</span><button className="text-button" disabled={busy} onClick={() => loadDemo().catch(error => notify(error.message, true))}>载入模拟账单</button></div>}
        {view === 'overview' && <Overview ledger={ledger} onEdit={edit} onDetails={onDetails} openEntry={newEntry}/>}
        {view === 'bills' && <Bills key={detail.version} ledger={ledger} filters={detail.filters} onEdit={edit} onBulk={bulk} notify={notify}/>}
        {view === 'import' && <ImportView ledger={ledger} commit={commit} notify={notify} busy={busy} aiEnabled={Boolean(supabase && import.meta.env.VITE_ENABLE_AI === 'true')}/>}
        {view === 'settings' && <Settings ledger={ledger} onSave={commit} onDetails={onDetails} notify={notify} busy={busy} onDemo={supabase ? null : loadDemo} isCloud={Boolean(supabase)}/>}
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">
      {menu.slice(0, 2).map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={20}/>{label}</button>)}
      <button className="mobile-entry" onClick={newEntry}><span><Plus size={24}/></span>记一笔</button>
      {menu.slice(2).map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={20}/>{label}</button>)}
    </nav>
    {entry && <Modal title={entry.tx ? '编辑账单' : '记一笔'} onClose={() => !busy && setEntry(null)}>
      <EntryForm ledger={ledger} original={entry.tx} onSubmit={saveTransaction} onClose={() => !busy && setEntry(null)} onDelete={entry.tx ? remove : undefined} busy={busy}/>
    </Modal>}
    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={17}/></button></div>}
  </div>
}

function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])
  if (!supabase) return <Workspace/>
  if (session === undefined) return <main className="auth">正在检查登录状态…</main>
  return session ? <Workspace key={session.user.id} user={session.user}/> : <Login/>
}

createRoot(document.getElementById('root')).render(<App/>)
