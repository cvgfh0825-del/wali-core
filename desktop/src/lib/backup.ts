// النسخ الاحتياطي: التصدير بيتعمل جوه الداتا بيز (export_backup) عشان ميتقطعش عند 1000 صف
import type { Backend } from './backend'

const LAST_KEY = 'wali-auto-backup'

export async function makeBackup(db: Backend, tag = 'backup') {
  const data = await db.rpc('export_backup')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return { name: `wali-core-${tag}-${stamp}.json`, json: JSON.stringify(data) }
}

export const lastAutoBackup = () => { try { return localStorage.getItem(LAST_KEY) } catch { return null } }

// مرة واحدة في اليوم لما الأدمن يفتح البرنامج (برنامج الويندوز بس)
export async function autoBackupIfDue(db: Backend) {
  const w = (window as any).wali
  if (!w?.autoBackup) return
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Khartoum' })
  if (lastAutoBackup() === day) return
  try {
    const { json } = await makeBackup(db)
    await w.autoBackup(`wali-core-${day}.json`, json)
    try { localStorage.setItem(LAST_KEY, day) } catch { /* */ }
  } catch (e) {
    console.warn('auto backup failed', e)
  }
}
