import Papa from 'papaparse'
import { audit, cents, classify, localCategory, makeTransaction, matches, normalize, remember, validDate, validate } from './ledger.js'

const columns = {
  date: ['交易时间', '交易创建时间', '创建时间', '入账日期', '交易日期'],
  amount: ['金额(元)', '金额', '交易金额', '交易金额(元)', '交易额', '发生额'],
  merchant: ['交易对方', '对方名称', '商户名称', '对方', '商户'],
  description: ['商品', '商品说明', '商品名称', '商品描述', '摘要', '交易描述'],
  type: ['收/支', '收支', '收支类型', '收支方向', '资金流向'],
  kind: ['交易类型', '交易分类', '业务类型'],
  status: ['当前状态', '交易状态', '状态'],
  account: ['支付方式', '收/付款方式', '收付款方式', '付款方式', '资金渠道', '账户'],
  order: ['交易单号', '交易订单号', '交易号', '订单号', '支付宝交易号'],
  external: ['商户单号', '商家订单号', '商户订单号'],
  original: ['原交易单号', '原交易订单号', '原交易号', '原支付订单号'],
  note: ['备注', '交易备注'],
}

const keyName = text => normalize(text).replace(/\s/g, '')
const cellText = cell => cell instanceof Date
  ? cell.toISOString().slice(0, 19).replace('T', ' ')
  : String(cell ?? '').trim()

function findHeader(matrix) {
  return matrix.findIndex(row => {
    const keys = row.map(keyName)
    return columns.date.some(key => keys.includes(keyName(key))) && columns.amount.some(key => keys.includes(keyName(key)))
  })
}

function readDate(text) {
  const m = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) return ''
  const pieces = m.slice(2).map(value => (value || '0').padStart(2, '0'))
  const date = m[1] + '-' + pieces.slice(0, 2).join('-') + 'T' + pieces.slice(2).join(':')
  return validDate(date) ? date : ''
}

export async function parseFile(file) {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readSheets } = await import('read-excel-file/universal')
    const sheets = await readSheets(file, { parseNumber: text => text })
    const rows = sheets.find(sheet => findHeader(sheet.data) >= 0)?.data
    if (!rows) throw new Error('找不到账单工作表')
    return rows
  }
  if (!/\.csv$/i.test(file.name)) throw new Error('请选择 CSV 或 XLSX 文件')
  const bytes = await file.arrayBuffer()
  let contents
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    contents = new TextDecoder('gb18030').decode(bytes)
  }
  const parsed = Papa.parse(contents, { skipEmptyLines: 'greedy', delimiter: ',' })
  if (parsed.errors.length) throw new Error('CSV 分隔或引号格式有误，请重新导出文件')
  return parsed.data
}

function parseType(direction, kind, details, status) {
  if (/退款|退货|返还/.test(kind) || /^退款(?:[-：:\s]|$)/.test(details) || /^退款成功$/.test(status)) return 'refund'
  if (/提现|充值|还款|借款|转账|(?:零钱通|余额宝).*转[入出]/.test(kind)) return 'transfer'
  if (/^不计收支$/.test(direction)) return 'transfer'
  if (/支出|付款|^支$/.test(direction)) return 'expense'
  if (/收入|收款|^收$/.test(direction)) return 'income'
  return ''
}

function parseStatus(text) {
  if (/失败|关闭|取消|已撤销|已退还|未支付|未付款|拒收/.test(text)) return 'void'
  if (/待|处理中|进行中|未领取/.test(text)) return 'pending'
  if (/成功|已到账|已转入|已转出|已存入|已收钱|已领取|已收款|已完成|已入账|已付款|已支付|已退款|已全额退款|已部分退款|部分退款|交易完成/.test(text)) return 'posted'
  return 'pending'
}

export function getCandidates(tx, pool, platform) {
  return pool.filter(existing => existing.account === tx.account && matches(tx, existing) &&
    !existing.sources.some(source => source.platform === platform))
}

export function parseRows(matrix, platform, ledger, account) {
  const headerIndex = findHeader(matrix)
  if (headerIndex < 0) throw new Error('找不到账单表头，请使用官方导出的 CSV 或 XLSX 文件')
  const header = matrix[headerIndex].map(cellText)
  const normalized = header.map(keyName)
  const indexes = Object.fromEntries(Object.entries(columns).map(([key, names]) => [key, normalized.findIndex(name => names.some(alias => keyName(alias) === name))]))
  const sourceMap = new Map(ledger.transactions.flatMap(tx => tx.sources.map(source => [source.key, tx.id])))
  const validMatches = new Map()
  for (const tx of ledger.transactions) {
    const key = tx.type + ':' + tx.amount
    const similar = validMatches.get(key) || []
    similar.push(tx)
    validMatches.set(key, similar)
  }
  const preview = []
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const row = matrix[index].map(cellText)
    const field = key => row[indexes[key]] || ''
    if (!row.some(Boolean) || (/^[-=]{4,}|^共\s*\d+\s*笔|^(导出|合计|注：)/.test(row[0]) && !field('amount'))) continue
    const date = readDate(field('date'))
    const originalCategory = field('kind')
    const statusText = field('status')
    const type = parseType(field('type'), originalCategory, field('description'), statusText)
    const status = parseStatus(statusText)
    const merchant = field('merchant')
    const description = field('description')
    const order = field('order').replace(/^['’]/, '')
    const original = field('original').replace(/^['’]/, '')
    const errors = [], warnings = []
    let amount = 0
    try {
      amount = Math.abs(cents(field('amount')))
      if (!amount) errors.push('金额为零')
    } catch {
      errors.push('金额无法识别')
    }
    if (!date) errors.push('日期无法识别')
    if (!type) warnings.push('请核对交易类型')
    if (status === 'pending') warnings.push('请核对交易状态')
    if (type === 'transfer') warnings.push('请填写付款和收款账户')
    if (type === 'expense' && /退款/.test(statusText)) warnings.push('请核对是否已另行导入退款')
    const shipment = type === 'expense' && /美团|饿了么|京东|淘宝|拼多多/.exec(merchant + ' ' + description)?.[0]
    const sourceKey = platform + ':' + (order
      ? JSON.stringify([order, type === 'refund' ? ['refund', date, amount] : 'payment'])
      : JSON.stringify([date, amount, merchant, description, field('type'), field('account'), field('external')]))
    const source = {
      platform, key: sourceKey, order, original, payment: field('account'),
      raw: Object.fromEntries(header.map((label, i) => [label || '列 ' + (i + 1), row[i] || ''])),
    }
    const related = type === 'refund' && original && ledger.transactions.find(tx => tx.type === 'expense' && tx.status === 'posted' &&
      tx.sources.some(item => item.platform === platform && item.order === original))?.id
    if (type === 'refund' && !related) warnings.push('请核对原支出，可在明细关联')
    const tx = makeTransaction({
      date, amount, type: type || 'expense', status: type === 'transfer' || !type ? (status === 'void' ? 'void' : 'pending') : status,
      account, merchant, description, originalCategory, related: related || '',
      note: field('note'), channel: shipment || '', sources: [source],
    })
    const suggestion = ['income', 'expense'].includes(type) ? classify(tx, ledger) : {}
    const fallback = ['income', 'expense'].includes(type) ? localCategory(tx, ledger) : {}
    Object.assign(tx, fallback, suggestion)
    const duplicate = !errors.length && sourceMap.has(sourceKey)
    const candidates = getCandidates(tx, validMatches.get(tx.type + ':' + tx.amount) || [], platform)
    preview.push({ line: index + 1, tx, duplicate, errors, warnings, candidates, match: '',
      needsAi: ['income', 'expense'].includes(type) && !suggestion.category, include: !duplicate && !errors.length && !candidates.length })
    if (!errors.length) sourceMap.set(sourceKey, tx.id)
  }
  return preview
}

export function commitImport(ledger, preview) {
  const copy = structuredClone(ledger)
  const existing = new Map(copy.transactions.map(tx => [tx.id, tx]))
  const keys = new Set(copy.transactions.flatMap(tx => tx.sources.map(source => source.key)))
  let added = 0, linked = 0
  for (const item of preview) {
    if (!item.include || item.errors.length) continue
    const tx = item.tx
    const [source] = tx.sources
    if (keys.has(source.key)) continue
    if (item.match) {
      const original = existing.get(item.match)
      if (!original || original.account !== tx.account || !matches(tx, original) || original.sources.some(entry => entry.platform === source.platform)) throw new Error('来源关联已失效，请重新核对')
      const before = structuredClone(original)
      original.sources.push(source)
      audit(copy, '合并流水来源', before, original)
      linked++
    } else {
      copy.transactions.push(structuredClone(tx))
      remember(copy, tx)
      added++
    }
    keys.add(source.key)
  }
  const payments = new Map(copy.transactions.filter(tx => tx.type === 'expense' && tx.status === 'posted')
    .flatMap(tx => tx.sources.filter(source => source.order).map(source => [source.platform + ':' + source.order, tx.id])))
  for (const tx of copy.transactions) {
    if (tx.type !== 'refund' || tx.related) continue
    const [source] = tx.sources
    if (!source?.original) continue
    const related = payments.get(source.platform + ':' + source.original)
    if (related) {
      const before = { ...tx }
      tx.related = related
      audit(copy, '关联原支出', before, tx)
    }
  }
  if (added) audit(copy, '批量导入', null, { count: added })
  validate(copy)
  return { ledger: copy, added, linked }
}
