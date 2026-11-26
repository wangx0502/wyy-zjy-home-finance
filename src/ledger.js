export const owners = { me: '我', partner: '对象', joint: '家庭共同' }
export const types = { expense: '支出', income: '收入', transfer: '转账', refund: '退款', adjustment: '余额调整' }
export const states = { posted: '已入账', pending: '待核对', void: '已关闭' }
export const defaults = [
  ['餐饮', '外卖', '堂食', '买菜', '饮料'], ['购物', '日用品', '服装', '数码'], ['居家', '房租', '水电', '家具'],
  ['交通', '打车', '公交', '加油'], ['宠物', '猫粮', '猫砂', '宠物用品'], ['娱乐', '电影', '旅游', '休闲'],
  ['个人', '护肤', '美容', '健身'], ['人情', '礼物', '红包'], ['医疗', '药品', '看病'], ['其他'],
]
export const incomeCategories = ['工资', '奖金', '兼职', '红包', '其他收入']
export const format = amount => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount / 100)
export const amountText = amount => (amount / 100).toFixed(2)
export const normalize = text => String(text ?? '').normalize('NFKC').trim().toLowerCase()
export const id = () => crypto.randomUUID()
export function now() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date()).replace(' ', 'T')
}

export function cents(input) {
  const raw = String(input).trim().replace(/^[¥￥]\s*/, '').replaceAll('，', ',')
  if (raw.includes(',') && !/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) throw new Error('请检查金额的千位分隔符')
  const value = raw.replaceAll(',', '')
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(value)) throw new Error('金额须为最多两位小数的人民币数值')
  const [whole, decimal = ''] = value.replace(/^-/, '').split('.')
  return (value.startsWith('-') ? -1 : 1) * (Number(whole) * 100 + Number(decimal.padEnd(2, '0')))
}

export function emptyLedger() {
  return {
    schema: 1,
    accounts: [
      { id: 'wechat', name: '微信余额', owner: 'me', kind: 'wallet', opening: 0 },
      { id: 'alipay', name: '支付宝余额', owner: 'me', kind: 'wallet', opening: 0 },
      { id: 'bank', name: '银行卡', owner: 'joint', kind: 'bank', opening: 0 },
      { id: 'cash', name: '现金', owner: 'me', kind: 'cash', opening: 0 },
    ],
    categories: defaults.map(([name, ...children]) => ({ name, children })).concat(incomeCategories.map(name => ({ name, children: [], income: true }))),
    rules: [], learned: [], transactions: [], history: [],
  }
}

export function categoryLabel(tx, ledger) {
  const original = tx.type === 'refund' && ledger.transactions.find(row => row.id === tx.related)
  return (original || tx).category || '未分类'
}

const providerCategories = {
  餐饮美食: '餐饮', 食品生鲜: '买菜', 交通出行: '交通', 出行交通: '交通', 日用百货: '日用品',
  服饰装扮: '服装', 数码电器: '数码', 家居家装: '居家', 医疗健康: '医疗', 休闲娱乐: '娱乐',
  工资薪酬: '工资', 工资收入: '工资',
}

export function classify(tx, ledger) {
  const merchant = normalize(tx.merchant)
  if (!merchant && !tx.originalCategory) return {}
  const rule = ledger.rules.find(item => item.merchant === merchant && item.type === tx.type)
  const learned = ledger.learned.find(item => item.merchant === merchant && item.type === tx.type)
  const group = ledger.categories.filter(item => Boolean(item.income) === (tx.type === 'income'))
  const source = normalize(tx.originalCategory)
  const contains = (item, label) => normalize(item.name) === label || item.children.some(child => normalize(child) === label)
  const alias = Object.hasOwn(providerCategories, source) ? providerCategories[source] : undefined
  const direct = group.find(item => contains(item, source))
  const original = direct || (alias && group.find(item => contains(item, alias)))
  if (rule || learned) return { category: (rule || learned).category, subcategory: (rule || learned).subcategory, method: rule ? '商户规则' : '历史确认' }
  if (original) return { category: original.name, subcategory: original.children.find(child => normalize(child) === (direct ? source : alias)) || '', method: '账单分类' }
  return {}
}

const localPatterns = [
  ['餐饮', /外卖|餐饮|餐厅|咖啡|奶茶|肯德基|麦当劳|瑞幸|沙县|面馆|火锅|饭店/],
  ['交通', /地铁|公交|滴滴|出行|加油|停车|铁路|单车/],
  ['居家', /电费|水费|燃气|房租|物业|家具/],
  ['宠物', /宠物|猫粮|猫砂|狗粮/],
  ['医疗', /医院|药房|药店|诊所/],
  ['娱乐', /影院|电影|景区|门票/],
  ['购物', /超市|便利店|商贸|百货|服饰|数码/],
  ['工资', /工资|薪酬|薪资/],
]

export function localCategory(tx, ledger) {
  const candidates = new Set(ledger.categories.filter(item => Boolean(item.income) === (tx.type === 'income')).map(item => item.name))
  const found = localPatterns.find(([name, pattern]) => candidates.has(name) && pattern.test(tx.merchant + ' ' + tx.description))
  return found ? { category: found[0], subcategory: '', method: '本地词库' } : {}
}

export function remember(ledger, tx) {
  const merchant = normalize(tx.merchant)
  if (!merchant || !tx.category || !tx.confirmed || !['expense', 'income'].includes(tx.type)) return
  ledger.learned = ledger.learned.filter(item => item.merchant !== merchant || item.type !== tx.type)
  ledger.learned.unshift({ merchant, type: tx.type, category: tx.category, subcategory: tx.subcategory || '' })
}

export function audit(ledger, action, before, after) {
  ledger.history.unshift({ id: id(), time: new Date().toISOString(), action, before, after })
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return false
  const normalized = value.length === 16 ? value + ':00' : value
  const parsed = new Date(normalized + 'Z')
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 19) === normalized
}

export function validate(ledger) {
  if (ledger?.schema !== 1 || !['accounts', 'transactions', 'categories', 'rules', 'learned', 'history'].every(key => Array.isArray(ledger[key]))) throw new Error('账本或备份文件格式有误')
  const accounts = new Map()
  for (const account of ledger.accounts) {
    if (!account.id || !account.name?.trim() || accounts.has(account.id) || !Object.hasOwn(owners, account.owner) || !Number.isSafeInteger(account.opening)) throw new Error('账户数据有误')
    accounts.set(account.id, account)
  }
  const categories = new Map()
  for (const item of ledger.categories) {
    const key = Boolean(item.income) + ':' + item.name
    if (!item.name?.trim() || categories.has(key) || !Array.isArray(item.children) || item.children.some(child => typeof child !== 'string') || new Set(item.children).size !== item.children.length) throw new Error('分类数据有误')
    categories.set(key, item.children)
  }
  const checkCategory = record => {
    if (!record.category && !record.subcategory) return
    const children = categories.get((record.type === 'income') + ':' + record.category)
    if (!children || (record.subcategory && !children.includes(record.subcategory))) throw new Error('账单分类无效')
  }
  for (const rule of [...ledger.rules, ...ledger.learned]) {
    if (!rule.merchant || !['income', 'expense'].includes(rule.type)) throw new Error('商户规则无效')
    checkCategory(rule)
  }
  const transactions = new Map()
  const keys = new Set()
  for (const row of ledger.transactions) {
    if (!row?.id || transactions.has(row.id) || !validDate(row.date) || !Object.hasOwn(states, row.status) || !Object.hasOwn(types, row.type) ||
      !Number.isSafeInteger(row.amount) || row.amount === 0 || (row.type !== 'adjustment' && row.amount < 0) ||
      (row.status === 'posted' && !accounts.has(row.account)) || (row.account && !accounts.has(row.account))) throw new Error('请检查交易时间、金额、类型和账户')
    if (row.type === 'transfer' && ((row.status === 'posted' && !accounts.has(row.to)) || (row.to && (!accounts.has(row.to) || row.account === row.to)))) throw new Error('转账须选择两个不同账户')
    if (row.type !== 'refund' && row.related) throw new Error('只有退款可以关联支出')
    if (row.type === 'income' || row.type === 'expense') checkCategory(row)
    transactions.set(row.id, row)
    if (!Array.isArray(row.sources)) throw new Error('流水来源数据有误')
    for (const source of row.sources) {
      if (!source.key || keys.has(source.key)) throw new Error('检测到重复原始流水')
      keys.add(source.key)
    }
  }
  const refunded = new Map()
  for (const row of ledger.transactions) {
    if (!row.related) continue
    const original = transactions.get(row.related)
    if (!original || original.type !== 'expense' || (row.status === 'posted' && original.status !== 'posted')) throw new Error('关联退款前，请确认原支出已入账')
    if (row.status !== 'posted') continue
    const sum = (refunded.get(original.id) || 0) + row.amount
    if (sum > original.amount) throw new Error('关联退款金额超过原支出')
    refunded.set(original.id, sum)
  }
  return ledger
}

export function effects(tx) {
  if (tx.status !== 'posted') return []
  if (tx.type === 'transfer') return [[tx.account, -tx.amount], [tx.to, tx.amount]]
  return [[tx.account, tx.type === 'expense' ? -tx.amount : tx.amount]]
}

export function balances(ledger, end = '\uffff') {
  const map = new Map(ledger.accounts.map(account => [account.id, account.opening]))
  for (const tx of ledger.transactions) {
    if (tx.date > end) continue
    for (const [account, amount] of effects(tx)) map.set(account, (map.get(account) || 0) + amount)
  }
  return map
}

export function report(ledger, period, scope = 'all', until = period) {
  const joint = new Set(ledger.accounts.filter(account => account.owner === 'joint').map(account => account.id))
  const groups = Object.create(null)
  const trend = Object.create(null)
  const ownersByAccount = new Map(ledger.accounts.map(account => [account.id, account.owner]))
  const ownerTotals = Object.fromEntries(Object.keys(owners).map(owner => [owner, { income: 0, expense: 0 }]))
  const transactionsById = new Map(ledger.transactions.map(row => [row.id, row]))
  const rows = []
  let income = 0, expense = 0, refunds = 0, transfersIn = 0, transfersOut = 0, largest = null
  for (const tx of ledger.transactions) {
    if (tx.date < period || tx.date > until + '\uffff' || tx.status !== 'posted') continue
    const isJoint = joint.has(tx.account)
    const toJoint = joint.has(tx.to)
    if (scope === 'joint' && !isJoint && !(tx.type === 'transfer' && toJoint)) continue
    rows.push(tx)
    const bucket = tx.date.slice(0, period.length <= 4 ? 7 : 10)
    const point = trend[bucket] ||= { income: 0, expense: 0 }
    const owner = ownerTotals[ownersByAccount.get(tx.account)]
    if (tx.type === 'income') {
      income += tx.amount
      point.income += tx.amount
      owner.income += tx.amount
    }
    if (tx.type === 'expense' || tx.type === 'refund') {
      const delta = tx.type === 'expense' ? tx.amount : -tx.amount
      if (tx.type === 'refund') refunds += tx.amount
      const category = (transactionsById.get(tx.related) || tx).category || '未分类'
      groups[category] = (groups[category] || 0) + delta
      expense += delta
      point.expense += delta
      owner.expense += delta
      if (tx.type === 'expense' && (!largest || tx.amount > largest.amount)) largest = tx
    }
    if (scope === 'joint' && tx.type === 'transfer' && isJoint !== toJoint) {
      if (toJoint) transfersIn += tx.amount
      else transfersOut += tx.amount
    }
  }
  return { income, expense, refunds, transfersIn, transfersOut, net: income - expense + transfersIn - transfersOut, groups, trend, rows, ownerTotals, largest }
}

export function matches(a, b) {
  if (!a.date || !b.date || a.amount !== b.amount || a.type !== b.type || !['expense', 'refund', 'income', 'transfer'].includes(a.type) || a.status !== 'posted' || b.status !== 'posted') return false
  const date = row => Date.parse(row.date + 'Z')
  return Math.abs(date(a) - date(b)) <= 5 * 60 * 1000
}

export function makeTransaction(input) {
  return {
    id: id(), date: now(), amount: 0, type: 'expense', status: 'posted', account: '',
    to: '', related: '', category: '', subcategory: '', merchant: '', description: '',
    channel: '', note: '', method: '', confidence: null, confirmed: false, sources: [], ...input,
  }
}
