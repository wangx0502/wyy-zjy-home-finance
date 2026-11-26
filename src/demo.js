import { audit, emptyLedger, makeTransaction, now } from './ledger.js'

export function makeDemo() {
  const ledger = emptyLedger()
  ledger.accounts.push({ id: 'partner-bank', name: '对象银行卡', owner: 'partner', kind: 'bank', opening: 230000 })
  ledger.accounts.find(account => account.id === 'bank').opening = 1192000
  const period = now().slice(0, 7)
  const add = (day, type, amount, account, merchant, category, extras = {}) => {
    const tx = makeTransaction({ date: period + '-' + String(day).padStart(2, '0') + 'T12:30:00', type, amount, merchant, category, account, confirmed: true, ...extras })
    ledger.transactions.push(tx)
    return tx.id
  }
  add(1, 'expense', 190000, 'bank', '本月房租', '居家', { subcategory: '房租' })
  add(3, 'expense', 5680, 'alipay', '叮咚买菜', '餐饮', { subcategory: '买菜' })
  add(5, 'income', 450000, 'bank', '本月工资', '工资')
  add(5, 'income', 400000, 'partner-bank', '对象工资', '工资')
  add(6, 'transfer', 350000, 'partner-bank', '划入共同账户', '', { to: 'bank' })
  add(7, 'expense', 2200, 'wechat', '通勤地铁', '交通', { subcategory: '公交' })
  const store = add(9, 'expense', 23800, 'bank', '家庭日用品', '购物', { subcategory: '日用品' })
  add(10, 'expense', 4500, 'wechat', '周末午餐', '餐饮', { subcategory: '堂食' })
  add(10, 'refund', 4800, 'bank', '日用品部分退款', '', { related: store })
  add(11, 'expense', 13500, 'alipay', '宠物用品', '宠物', { subcategory: '宠物用品' })
  add(12, 'expense', 6800, 'wechat', '社区菜市场', '餐饮', { subcategory: '买菜' })
  audit(ledger, '载入模拟账单', null, { count: ledger.transactions.length })
  return ledger
}
