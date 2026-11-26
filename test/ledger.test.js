import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import writeExcelFile from 'write-excel-file/universal'
import { commitImport, parseFile, parseRows } from '../src/importer.js'
import { balances, cents, classify, emptyLedger, makeTransaction, remember, report, validate } from '../src/ledger.js'

const fromFixture = async name => new File([await readFile(new URL('./fixtures/' + name, import.meta.url))], name)
const row = values => makeTransaction({ date: '2026-11-05T12:00:00', account: 'bank', ...values })

test('金额按整数分解析并拒绝多余小数位', () => {
  assert.equal(cents('￥3,500.05'), 350005)
  assert.equal(cents('-0.01'), -1)
  assert.throws(() => cents('10.001'))
  assert.throws(() => cents('1,2'))
})

test('工资、内部划拨、借款、信用卡与余额调整各自计账', () => {
  const ledger = emptyLedger()
  ledger.accounts.push({ id: 'partner-bank', name: '对象卡', owner: 'partner', opening: 0 },
    { id: 'credit', name: '信用卡', owner: 'me', opening: 0 },
    { id: 'loan', name: '借款', owner: 'me', opening: 0 })
  ledger.transactions = [
    row({ type: 'income', amount: 450000, category: '工资' }),
    row({ type: 'income', amount: 400000, category: '工资', account: 'partner-bank' }),
    row({ type: 'transfer', amount: 350000, account: 'partner-bank', to: 'bank' }),
    row({ type: 'expense', amount: 10000, account: 'credit', category: '购物' }),
    row({ type: 'transfer', amount: 10000, to: 'credit' }),
    row({ type: 'transfer', amount: 5000, account: 'loan', to: 'bank' }),
    row({ type: 'transfer', amount: 1000, to: 'loan' }),
    row({ type: 'adjustment', amount: -100 }),
  ]
  validate(ledger)
  const all = report(ledger, '2026-11')
  assert.equal(all.income, 850000)
  assert.equal(all.expense, 10000)
  assert.equal(all.net, 840000)
  assert.equal(report(ledger, '2026').net, all.net)
  const joint = report(ledger, '2026-11', 'joint')
  assert.equal(joint.transfersIn, 355000)
  assert.equal(joint.transfersOut, 11000)
  const map = balances(ledger)
  assert.equal(map.get('partner-bank'), 50000)
  assert.equal(map.get('bank'), 793900)
  assert.equal(map.get('loan'), -4000)
  assert.equal(map.get('credit'), 0)
})

test('分次跨月退款冲减原分类，校验累计退款上限', () => {
  const ledger = emptyLedger()
  const expense = row({ type: 'expense', amount: 10000, category: '餐饮' })
  const refunds = [
    row({ type: 'refund', amount: 1000, related: expense.id }),
    row({ type: 'refund', amount: 2500, related: expense.id, date: '2026-12-01T12:00:00' }),
  ]
  ledger.transactions.push(expense, ...refunds)
  validate(ledger)
  assert.equal(report(ledger, '2026-11').expense, 9000)
  assert.equal(report(ledger, '2026-12').groups['餐饮'], -2500)
  assert.equal(report(ledger, '2026').income, 0)
  assert.equal(balances(ledger).get('bank'), -6500)
  ledger.transactions.push(row({ type: 'refund', amount: 9000, related: expense.id }))
  assert.throws(() => validate(ledger), /超过原支出/)
})

test('微信 CSV 识别已关闭、待核对转账、异常、同批退款和重复导入', async () => {
  const ledger = emptyLedger()
  const matrix = await parseFile(await fromFixture('wechat.csv'))
  const preview = parseRows(matrix, 'wechat', ledger, 'bank')
  assert.deepEqual(preview.map(item => item.tx.status), ['posted', 'posted', 'pending', 'void', 'posted'])
  assert.equal(preview[0].tx.category, '餐饮')
  assert.equal(preview[0].tx.sources[0].order, '42000000000000000013')
  assert.equal(preview[4].include, false)
  const first = commitImport(ledger, preview)
  assert.equal(first.added, 4)
  assert.equal(first.ledger.transactions[1].related, first.ledger.transactions[0].id)
  assert.equal(report(first.ledger, '2026-11').expense, 2300)
  const again = parseRows(matrix, 'wechat', first.ledger, 'bank')
  assert.equal(again.filter(item => item.duplicate).length, 4)
  assert.equal(commitImport(first.ledger, preview).added, 0)
})

test('支付宝 XLSX 保留长订单号，退款和还款按各自类型入账', async () => {
  const source = await parseFile(await fromFixture('alipay.csv'))
  const blob = await writeExcelFile([{ sheet: '说明', data: [['说明']] }, { sheet: '交易明细', data: source }]).toBlob()
  const matrix = await parseFile(new File([blob], '支付宝.xlsx'))
  const ledger = emptyLedger()
  const preview = parseRows(matrix, 'alipay', ledger, 'alipay')
  assert.equal(preview[0].tx.sources[0].order, '2026110500000000000123456789')
  assert.equal(preview[0].tx.category, '交通')
  assert.deepEqual(preview.map(item => item.tx.type), ['expense', 'refund', 'transfer'])
  const result = commitImport(ledger, preview)
  assert.equal(report(result.ledger, '2026-11').expense, 130)
  assert.equal(report(result.ledger, '2026-11').income, 0)
})

test('同笔微信和银行卡流水待选择后合并来源，金额仅算一次', async () => {
  const matrix = await parseFile(await fromFixture('wechat.csv'))
  const ledger = commitImport(emptyLedger(), parseRows(matrix, 'wechat', emptyLedger(), 'bank')).ledger
  const bank = parseRows([
    ['交易时间', '金额', '收支', '交易状态', '交易对方', '交易单号'],
    ['2026-11-01 12:31:00', '28.00', '支出', '交易成功', '微信支付', 'BANK-1'],
  ], 'bank', ledger, 'bank')
  assert.equal(bank[0].candidates.length, 1)
  assert.equal(bank[0].include, false)
  bank[0].match = bank[0].candidates[0].id
  bank[0].include = true
  const result = commitImport(ledger, bank)
  assert.equal(result.added, 0)
  assert.equal(result.linked, 1)
  assert.equal(result.ledger.transactions[0].sources.length, 2)
  assert.equal(report(result.ledger, '2026-11').expense, 2300)
})

test('用户规则优先于历史确认，历史优先于原分类', () => {
  const ledger = emptyLedger()
  const tx = row({ type: 'expense', amount: 20, merchant: '咖啡店', originalCategory: '购物' })
  assert.equal(classify(tx, ledger).category, '购物')
  assert.equal(classify({ ...tx, originalCategory: '食品生鲜' }, ledger).subcategory, '买菜')
  remember(ledger, { ...tx, confirmed: true, category: '餐饮', subcategory: '饮料' })
  assert.equal(classify(tx, ledger).category, '餐饮')
  ledger.rules.push({ type: 'expense', merchant: '咖啡店', category: '其他' })
  assert.equal(classify(tx, ledger).category, '其他')
})
