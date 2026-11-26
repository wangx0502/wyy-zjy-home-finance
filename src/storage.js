import { emptyLedger, validate } from './ledger.js'

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = import.meta.env
export const supabase = url && key ? (await import('@supabase/supabase-js')).createClient(url, key) : null
const localKey = 'easy-note-ledger-v1'

export async function loadLedger(user) {
  if (!supabase) {
    const stored = localStorage.getItem(localKey)
    return stored ? { ledger: validate(JSON.parse(stored)), revision: stored } : { ledger: emptyLedger(), revision: null }
  }
  const allowed = await supabase.from('ledger_admins').select('user_id').eq('user_id', user.id).maybeSingle()
  if (allowed.error) throw allowed.error
  if (!allowed.data) throw new Error('此账号尚未获得账本访问权限')
  const { data, error } = await supabase.from('ledgers').select('revision,document').eq('user_id', user.id).maybeSingle()
  if (error) throw error
  return data ? { ledger: validate(data.document), revision: data.revision } : { ledger: emptyLedger(), revision: null }
}

export async function saveLedger(ledger, revision) {
  validate(ledger)
  if (!supabase) {
    if (localStorage.getItem(localKey) !== revision) throw new Error('账本在另一个页面中已更新，请先刷新账本再重试')
    const stored = JSON.stringify(ledger)
    localStorage.setItem(localKey, stored)
    return stored
  }
  const { data, error } = await supabase.rpc('save_ledger', { expected_revision: revision, next_document: ledger })
  if (error?.code === '40001') throw new Error('另一台设备已修改账本。请先刷新账本，再提交这次修改')
  if (error) throw error
  return data
}
