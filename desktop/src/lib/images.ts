// صور الأصناف: بتتحمّل مرة واحدة لكل جهاز وبتتحفظ فيه، وبتتحمّل تاني بس لو رقم نسخة الصورة (image_v) اتغير
// ده بيوفّر حد التحميل في خطة Supabase المجانية، لأن قايمة الأصناف بتتحمّل تاني مع كل بيعة
import type { Backend } from './backend'

type Entry = { v: number; image: string | null }

const store = {
  db: null as Promise<IDBDatabase> | null,
  open() {
    this.db ??= new Promise((res, rej) => {
      const r = indexedDB.open('wali-core-images', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('img')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    return this.db
  },
  async get(id: string): Promise<Entry | null> {
    try {
      const d = await this.open()
      return await new Promise((res) => { const q = d.transaction('img').objectStore('img').get(id); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null) })
    } catch { return null }
  },
  async set(id: string, e: Entry) {
    try { const d = await this.open(); d.transaction('img', 'readwrite').objectStore('img').put(e, id) } catch { /* */ }
  },
}

const mem = new Map<string, Entry>()
const inflight = new Map<string, Promise<string | null>>()
let queue: { id: string; v: number; done: (img: string | null) => void }[] = []
let timer: any = null

// الطلبات اللي بتيجي في نفس اللحظة بتتجمّع في طلب واحد
function flush(db: Backend) {
  const batch = queue; queue = []; timer = null
  const ids = [...new Set(batch.map((b) => b.id))]
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50)
    db.list('product_images', { select: 'product_id,image', in: { product_id: part } })
      .then((rows: any[]) => {
        const got = new Map(rows.map((r) => [r.product_id, r.image as string]))
        for (const b of batch.filter((x) => part.includes(x.id))) {
          const e = { v: b.v, image: got.get(b.id) ?? null }
          mem.set(b.id, e); store.set(b.id, e); b.done(e.image)
        }
      })
      .catch(() => batch.filter((x) => part.includes(x.id)).forEach((b) => b.done(null)))
  }
}

// من الذاكرة على طول (عشان الصورة متطلعش وتختفي لما الشاشة تتحدّث)
export const cachedImage = (id: string, v?: number) => {
  const m = mem.get(id)
  return v && m && m.v === v ? m.image : null
}

export function productImage(db: Backend, id: string, v: number): Promise<string | null> {
  if (!v) return Promise.resolve(null)
  const m = mem.get(id)
  if (m && m.v === v) return Promise.resolve(m.image)
  const key = `${id}:${v}`
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      const saved = await store.get(id)
      if (saved && saved.v === v) { mem.set(id, saved); return saved.image }
      return new Promise<string | null>((done) => {
        queue.push({ id, v, done })
        timer ??= setTimeout(() => flush(db), 40)
      })
    })().finally(() => inflight.delete(key)))
  }
  return inflight.get(key)!
}

// بعد ما الصورة تتغير من الجهاز ده، نحطها في الكاش على طول من غير ما نحمّلها تاني
export function rememberImage(id: string, v: number, image: string | null) {
  const e = { v, image }
  mem.set(id, e); store.set(id, e)
}
