import Papa from 'papaparse'
import { amountText, categoryLabel, owners, states, types } from './ledger.js'

export function download(data, filename, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportRows(ledger, rows) {
  const accounts = new Map(ledger.accounts.map(account => [account.id, account]))
  return [
    ['交易时间', '类型', '金额（元）', '状态', '账户', '转入账户', '资金归属', '一级分类', '二级分类', '商户', '描述', '渠道', '备注', '数据来源', '原始订单号'],
    ...rows.map(tx => [
      tx.date.replace('T', ' '), types[tx.type], amountText(tx.amount), states[tx.status], accounts.get(tx.account)?.name || '',
      accounts.get(tx.to)?.name || '', owners[accounts.get(tx.account)?.owner] || '', categoryLabel(tx, ledger), tx.subcategory,
      tx.merchant, tx.description, tx.channel, tx.note, tx.sources.map(item => item.platform).join(' / ') || '手工',
      tx.sources.map(item => item.order).filter(Boolean).join(' / '),
    ]),
  ]
}

export async function exportFile(ledger, rows, kind) {
  const data = exportRows(ledger, rows)
  if (kind === 'csv') {
    download('\ufeff' + Papa.unparse(data, { escapeFormulae: true }), '家庭账本.csv', 'text/csv;charset=utf-8')
    return
  }
  const { default: writeExcelFile } = await import('write-excel-file/universal')
  const cells = data.map((row, i) => row.map((value, column) => {
    if (!i) return { value, fontWeight: 'bold' }
    return column === 2 ? { value: Number(value), format: '0.00' } : String(value ?? '')
  }))
  const columns = data[0].map((_, index) => ({ width: index === 0 || index === 14 ? 24 : 16 }))
  const blob = await writeExcelFile(cells, { sheet: '账单明细', columns, stickyRowsCount: 1 }).toBlob()
  download(blob, '家庭账本.xlsx', blob.type)
}
