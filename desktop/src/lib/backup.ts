// النسخ الاحتياطي: التصدير بيتعمل جوه الداتا بيز (export_backup) عشان ميتقطعش عند 1000 صف
import type { Backend } from './backend'

const LAST_KEY = 'wali-auto-backup'
const BUCKET = 'backups'
const KEEP = 30

export async function makeBackup(db: Backend, tag = 'backup') {
  const data = await db.rpc('export_backup')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return { name: `wali-core-${tag}-${stamp}.json`, json: JSON.stringify(data) }
}

export const lastAutoBackup = () => { try { return localStorage.getItem(LAST_KEY) } catch { return null } }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Khartoum' })

// ---- نسخة الموقع: النسخ بتتحفظ في مخزن خاص على Supabase (الأدمن بس يقدر يوصله)
const storage = (db: Backend) => (db as any).sb?.storage.from(BUCKET)
export const hasCloudBackups = (db: Backend) => !(window as any).wali && db.mode === 'supabase'

export type CloudBackup = { path: string; name: string; created_at: string; size: number }

export async function listCloudBackups(db: Backend, folder = 'auto'): Promise<CloudBackup[]> {
  const { data, error } = await storage(db).list(folder, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw error
  return (data ?? []).filter((f: any) => f.name.endsWith('.json'))
    .map((f: any) => ({ path: `${folder}/${f.name}`, name: f.name, created_at: f.created_at, size: f.metadata?.size ?? 0 }))
}

export async function uploadCloudBackup(db: Backend, path: string, json: string) {
  const { error } = await storage(db).upload(path, new Blob([json], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
  if (error) throw error
}

export async function downloadCloudBackup(db: Backend, path: string): Promise<string> {
  const { data, error } = await storage(db).download(path)
  if (error) throw error
  return data.text()
}

// مرة واحدة في اليوم لما الأدمن يفتح البرنامج:
// برنامج الويندوز بيحفظها على الجهاز، والموقع بيرفعها على Supabase ويحتفظ بآخر 30 يوم
export async function autoBackupIfDue(db: Backend) {
  const w = (window as any).wali
  const day = today()
  try {
    if (w?.autoBackup) {
      if (lastAutoBackup() === day) return
      const { json } = await makeBackup(db)
      await w.autoBackup(`wali-core-${day}.json`, json)
    } else if (hasCloudBackups(db)) {
      const list = await listCloudBackups(db)
      if (list.some((b) => b.name === `${day}.json`)) return
      const { json } = await makeBackup(db)
      await uploadCloudBackup(db, `auto/${day}.json`, json)
      const old = [{ name: `${day}.json` }, ...list].slice(KEEP).map((b) => `auto/${b.name}`)
      if (old.length) await storage(db).remove(old)
    } else return
    try { localStorage.setItem(LAST_KEY, day) } catch { /* */ }
  } catch (e) {
    console.warn('auto backup failed', e)
  }
}
