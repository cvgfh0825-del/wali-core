// طبقة البيانات: نفس الواجهة بتشتغل على Supabase الحقيقي أو على وضع التجربة (PGlite جوه البرنامج)
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export type Row = Record<string, any>
export type Query = {
  select?: string
  eq?: Row
  neq?: Row
  gte?: Row
  lte?: Row
  in?: Record<string, any[]>
  isNull?: string[]
  search?: { cols: string[]; term: string }
  order?: { col: string; asc?: boolean }[]
  limit?: number
}

export interface Profile {
  id: string
  username: string
  full_name: string
  role: 'admin' | 'accountant' | 'warehouse' | 'showroom' | 'custom'
  permissions: Record<string, string[]>
  is_active: boolean
}

export interface Backend {
  mode: 'supabase' | 'demo'
  signIn(username: string, password: string): Promise<Profile>
  signOut(): Promise<void>
  restore(): Promise<Profile | null>
  list<T = Row>(table: string, q?: Query): Promise<T[]>
  get<T = Row>(table: string, id: string | number, key?: string): Promise<T | null>
  insert<T = Row>(table: string, row: Row | Row[]): Promise<T[]>
  update<T = Row>(table: string, id: string | number, patch: Row, key?: string): Promise<T>
  remove(table: string, id: string | number): Promise<void>
  rpc<T = any>(fn: string, args?: Row): Promise<T>
  invoke<T = any>(fn: string, body: Row): Promise<T>
  subscribe(table: string, cb: (payload: any) => void): () => void
}

export const toEmail = (u: string) => `${u.trim().toLowerCase()}@wali.local`
const clean = (t: string) => t.replace(/[,()%*\\]/g, ' ').trim()

const arErr = (e: any): Error => {
  const m: string = e?.message ?? String(e)
  if (/Invalid login credentials/i.test(m)) return new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
  if (/duplicate key.*code/i.test(m)) return new Error('هذا الكود مستخدم لصنف آخر')
  if (/duplicate key.*barcode/i.test(m)) return new Error('هذا الباركود مستخدم من قبل')
  if (/duplicate key/i.test(m)) return new Error('هذه القيمة موجودة من قبل')
  if (/row-level security|permission denied/i.test(m)) return new Error('ليس لديك صلاحية لهذه العملية')
  if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) return new Error('تعذّر الاتصال بالخادم، تحقق من اتصال الإنترنت')
  if (/violates foreign key/i.test(m)) return new Error('لا يمكن الحذف لأن هذا العنصر مستخدم في عمليات أخرى')
  return new Error(m)
}

// ---------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------
export class SupabaseBackend implements Backend {
  mode = 'supabase' as const
  sb: SupabaseClient
  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, storageKey: 'wali-core-auth' } })
  }
  private async profile(): Promise<Profile | null> {
    const { data: u } = await this.sb.auth.getUser()
    if (!u.user) return null
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', u.user.id).single()
    if (error) throw arErr(error)
    if (!data.is_active) { await this.sb.auth.signOut(); throw new Error('هذا الحساب موقوف، تواصل مع مدير النظام') }
    return data as Profile
  }
  async signIn(username: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: toEmail(username), password })
    if (error) throw arErr(error)
    return (await this.profile())!
  }
  async signOut() { await this.sb.auth.signOut() }
  async restore() {
    const { data } = await this.sb.auth.getSession()
    return data.session ? this.profile() : null
  }
  async list<T>(table: string, q: Query = {}) {
    let b: any = this.sb.from(table).select(q.select ?? '*')
    for (const [k, v] of Object.entries(q.eq ?? {})) b = b.eq(k, v)
    for (const [k, v] of Object.entries(q.neq ?? {})) b = b.neq(k, v)
    for (const [k, v] of Object.entries(q.gte ?? {})) b = b.gte(k, v)
    for (const [k, v] of Object.entries(q.lte ?? {})) b = b.lte(k, v)
    for (const [k, v] of Object.entries(q.in ?? {})) b = b.in(k, v)
    for (const k of q.isNull ?? []) b = b.is(k, null)
    if (q.search?.term?.trim()) {
      const t = clean(q.search.term)
      b = b.or(q.search.cols.map((c) => `${c}.ilike.*${t}*`).join(','))
    }
    for (const o of q.order ?? []) b = b.order(o.col, { ascending: o.asc ?? true })
    if (q.limit) b = b.limit(q.limit)
    const { data, error } = await b
    if (error) throw arErr(error)
    return data as T[]
  }
  async get<T>(table: string, id: string | number, key = 'id') {
    const { data, error } = await this.sb.from(table).select('*').eq(key, id).maybeSingle()
    if (error) throw arErr(error)
    return data as T | null
  }
  async insert<T>(table: string, row: Row | Row[]) {
    const { data, error } = await this.sb.from(table).insert(row as any).select()
    if (error) throw arErr(error)
    return data as T[]
  }
  async update<T>(table: string, id: string | number, patch: Row, key = 'id') {
    const { data, error } = await this.sb.from(table).update(patch).eq(key, id).select().single()
    if (error) throw arErr(error)
    return data as T
  }
  async remove(table: string, id: string | number) {
    const { error } = await this.sb.from(table).delete().eq('id', id)
    if (error) throw arErr(error)
  }
  async rpc<T>(fn: string, args: Row = {}) {
    const { data, error } = await this.sb.rpc(fn, args)
    if (error) throw arErr(error)
    return data as T
  }
  async invoke<T>(fn: string, body: Row) {
    const { data, error } = await this.sb.functions.invoke(fn, { body })
    if (error) {
      let msg = error.message
      try { msg = (await (error as any).context.json()).error ?? msg } catch { /* */ }
      throw new Error(msg)
    }
    if (data?.error) throw new Error(data.error)
    return data as T
  }
  subscribe(table: string, cb: (p: any) => void) {
    const ch = this.sb
      .channel(`rt-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, cb)
      .subscribe()
    return () => { this.sb.removeChannel(ch) }
  }
}

// ---------------------------------------------------------------------
// وضع التجربة: Postgres كامل جوه البرنامج بنفس ملفات الـ SQL
// ---------------------------------------------------------------------
// تخزين بسيط في IndexedDB لنسخة الداتا بيز
const kv = {
  open: () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('wali-core-demo-store', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }),
  async get(k: string): Promise<any> {
    const d = await kv.open()
    return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error) })
  },
  async set(k: string, v: any) {
    const d = await kv.open()
    return new Promise<void>((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error) })
  },
}
// دوال القراءة بس — مبتغيرش حاجة، فمش لازم تنبّه الشاشات تعيد التحميل
const READ_ONLY_RPC = new Set(['current_rate', 'latest_rate', 'has_perm', 'is_admin', 'dashboard', 'annual_report', 'my_employee', 'shareholder_terms_at', 'period_sales', 'export_backup', 'peek_doc_number'])

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('اسم غير صالح: ' + s)
  return s
}

export class DemoBackend implements Backend {
  mode = 'demo' as const
  db: any
  user: Profile | null = null
  listeners = new Map<string, Set<(p: any) => void>>()

  static async create(onProgress?: (msg: string) => void) {
    const self = new DemoBackend()
    const { PGlite } = await import('@electric-sql/pglite')
    // الداتا بيز بتشتغل في الذاكرة (سريعة)، ونسخة مضغوطة بتتحفظ في المتصفح بعد كل تغيير
    indexedDB.deleteDatabase('/pglite/wali-core-demo') // نسخة قديمة كانت بطيئة
    const dump = await kv.get('dump').catch(() => null)
    self.db = dump ? new PGlite({ loadDataDir: dump }) : new PGlite()
    await self.db.waitReady
    const ready = await self.db.query(`select to_regclass('public.settings') is not null as ok`)
    if (!ready.rows[0].ok) {
      onProgress?.('جارٍ تجهيز قاعدة البيانات لأول مرة...')
      const { setupDemo } = await import('../demo/seed')
      await setupDemo(self.db, onProgress)
      await self.persist()
    } else {
      const { upgradeDemo } = await import('../demo/seed')
      if (await upgradeDemo(self.db)) await self.persist()
    }
    return self
  }

  private saveTimer: any = null
  private schedulePersist() {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.persist(), 1500)
  }
  async persist() {
    try { await kv.set('dump', await this.db.dumpDataDir('gzip')) } catch (e) { console.warn('demo persist failed', e) }
  }

  private async asUser() {
    await this.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [this.user?.id ?? ''])
  }
  private emit(table: string) {
    this.schedulePersist()
    for (const t of [table, '*']) this.listeners.get(t)?.forEach((cb) => cb({ table }))
  }
  private emitAll() { ['notifications', 'invoices', 'products', 'exchange_rates', 'delivery_permits', 'attendance'].forEach((t) => this.emit(t)) }

  async signIn(username: string, password: string) {
    const r = await this.db.query(
      `select p.* from profiles p join demo_passwords d on d.username = p.username where p.username = $1 and d.password = $2`,
      [username.trim().toLowerCase(), password])
    if (!r.rows.length) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
    if (!r.rows[0].is_active) throw new Error('هذا الحساب موقوف، تواصل مع مدير النظام')
    this.user = r.rows[0]
    localStorage.setItem('wali-demo-user', this.user!.id)
    await this.asUser()
    return this.user!
  }
  async signOut() { this.user = null; localStorage.removeItem('wali-demo-user'); await this.asUser() }
  async restore() {
    const id = localStorage.getItem('wali-demo-user')
    if (!id) return null
    const r = await this.db.query(`select * from profiles where id = $1 and is_active`, [id])
    this.user = r.rows[0] ?? null
    await this.asUser()
    return this.user
  }

  async list<T>(table: string, q: Query = {}) {
    const where: string[] = []
    const params: any[] = []
    const p = (v: any) => { params.push(v); return `$${params.length}` }
    for (const [k, v] of Object.entries(q.eq ?? {})) where.push(`${ident(k)} = ${p(v)}`)
    for (const [k, v] of Object.entries(q.neq ?? {})) where.push(`${ident(k)} is distinct from ${p(v)}`)
    for (const [k, v] of Object.entries(q.gte ?? {})) where.push(`${ident(k)} >= ${p(v)}`)
    for (const [k, v] of Object.entries(q.lte ?? {})) where.push(`${ident(k)} <= ${p(v)}`)
    for (const [k, v] of Object.entries(q.in ?? {})) {
      if (!v.length) where.push('false')
      else where.push(`${ident(k)}::text in (${v.map((x) => p(String(x))).join(',')})`)
    }
    for (const k of q.isNull ?? []) where.push(`${ident(k)} is null`)
    if (q.search?.term?.trim()) {
      const t = p(`%${clean(q.search.term)}%`)
      where.push('(' + q.search.cols.map((c) => `${ident(c)}::text ilike ${t}`).join(' or ') + ')')
    }
    const order = (q.order ?? []).map((o) => `${ident(o.col)} ${o.asc === false ? 'desc' : 'asc'} nulls last`).join(', ')
    const sql = `select coalesce(jsonb_agg(t), '[]'::jsonb) as rows from (
      select * from public.${ident(table)} ${where.length ? 'where ' + where.join(' and ') : ''}
      ${order ? 'order by ' + order : ''} ${q.limit ? 'limit ' + Number(q.limit) : ''}) t`
    await this.asUser()
    try {
      const r = await this.db.query(sql, params)
      return r.rows[0].rows as T[]
    } catch (e) { throw arErr(e) }
  }
  async get<T>(table: string, id: string | number, key = 'id') {
    const rows = await this.list<T>(table, { eq: { [key]: id }, limit: 1 })
    return rows[0] ?? null
  }
  async insert<T>(table: string, row: Row | Row[]) {
    const rows = Array.isArray(row) ? row : [row]
    const out: T[] = []
    await this.asUser()
    try {
      for (const r of rows) {
        // الأعمدة اللي اتبعتت بس، والباقي ياخد الافتراضي من الداتا بيز
        const cols = Object.keys(r).map(ident)
        const res = await this.db.query(
          `insert into public.${ident(table)} (${cols.join(',')})
           select ${cols.join(',')} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb)
           returning to_jsonb(${ident(table)}.*) as r`, [JSON.stringify(r)])
        out.push(res.rows[0].r)
      }
    } catch (e) { throw arErr(e) }
    this.emit(table)
    return out
  }
  async update<T>(table: string, id: string | number, patch: Row, key = 'id') {
    const cols = Object.keys(patch).map(ident)
    await this.asUser()
    try {
      const r = await this.db.query(
        `update public.${ident(table)} t set (${cols.join(',')}) = (select ${cols.join(',')} from jsonb_populate_record(t, $1::jsonb))
         where ${ident(key)}::text = $2 returning to_jsonb(t.*) as r`,
        [JSON.stringify(patch), String(id)])
      this.emit(table)
      return r.rows[0]?.r as T
    } catch (e) { throw arErr(e) }
  }
  async remove(table: string, id: string | number) {
    await this.asUser()
    try { await this.db.query(`delete from public.${ident(table)} where id::text = $1`, [String(id)]) }
    catch (e) { throw arErr(e) }
    this.emit(table)
  }
  async rpc<T>(fn: string, args: Row = {}) {
    const keys = Object.keys(args)
    const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]))
    await this.asUser()
    try {
      const r = await this.db.query(`select to_jsonb(public.${ident(fn)}(${named})) as r`, vals)
      if (!READ_ONLY_RPC.has(fn)) this.emitAll()
      return r.rows[0].r as T
    } catch (e) { throw arErr(e) }
  }
  async invoke<T>(fn: string, body: Row) {
    if (fn !== 'admin-users') throw new Error('غير مدعوم في الوضع التجريبي')
    const can = await this.rpc<boolean>('has_perm', { p_module: 'users', p_action: 'create' })
    if (!can) throw new Error('ليس لديك صلاحية إدارة المستخدمين')
    if (body.action === 'create') {
      const username = String(body.username).trim().toLowerCase()
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('يجب أن يكون اسم المستخدم بالإنجليزية ومن 3 إلى 30 حرفًا')
      if (String(body.password ?? '').length < 6) throw new Error('يجب ألا تقل كلمة المرور عن 6 أحرف')
      const exists = await this.db.query(`select 1 from profiles where username = $1`, [username])
      if (exists.rows.length) throw new Error('اسم المستخدم هذا موجود بالفعل')
      const r = await this.db.query(
        `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
        [toEmail(username), JSON.stringify({ username, full_name: body.full_name, role: body.role, permissions: body.permissions })])
      await this.db.query(`insert into demo_passwords (username, password) values ($1, $2)`, [username, body.password])
      this.emitAll()
      return { id: r.rows[0].id } as T
    }
    if (body.action === 'set_password') {
      if (String(body.password ?? '').length < 6) throw new Error('يجب ألا تقل كلمة المرور عن 6 أحرف')
      await this.db.query(`update demo_passwords set password = $1 where username = (select username from profiles where id = $2)`, [body.password, body.id])
      return { ok: true } as T
    }
    throw new Error('عملية غير معروفة')
  }
  subscribe(table: string, cb: (p: any) => void) {
    if (!this.listeners.has(table)) this.listeners.set(table, new Set())
    this.listeners.get(table)!.add(cb)
    return () => { this.listeners.get(table)?.delete(cb) }
  }
}

// ---------------------------------------------------------------------
// الإعداد: Supabase (من ملف .env أو من شاشة الإعداد) أو وضع التجربة
// ---------------------------------------------------------------------
export type Conn = { mode: 'supabase'; url: string; key: string } | { mode: 'demo' }

// مشروع والي بلازا (المفاتيح دي عامة ومش سرية)
const WALI = { url: 'https://avqwkxoeptkbzxdckedy.supabase.co', key: 'sb_publishable_P3BzxNxjqMMZeXjSlRCkYw_YjIyPZgJ' }
// نسخة الموقع (Vercel) مقفولة على قاعدة بيانات والي بلازا: من غير وضع تجربة ولا تغيير قاعدة البيانات
// (برنامج الويندوز ووقت التطوير زي ما هم)
export const LOCKED = !(window as any).wali && !import.meta.env.DEV

export function savedConn(): Conn | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (LOCKED) return { mode: 'supabase', url: envUrl || WALI.url, key: envKey || WALI.key }
  try {
    const s = localStorage.getItem('wali-conn')
    if (s) return JSON.parse(s)
  } catch { /* */ }
  if (envUrl && envKey) return { mode: 'supabase', url: envUrl, key: envKey }
  return null
}
export function saveConn(c: Conn | null) {
  if (LOCKED) return
  if (c) localStorage.setItem('wali-conn', JSON.stringify(c))
  else localStorage.removeItem('wali-conn')
}

// نسخة واحدة بس من كل اتصال (قاعدة التجربة مينفعش تتفتح مرتين على نفس التخزين)
let cached: { key: string; p: Promise<Backend> } | null = null
export function openBackend(c: Conn, onProgress?: (m: string) => void): Promise<Backend> {
  const key = JSON.stringify(c)
  if (cached?.key === key) return cached.p
  const p = c.mode === 'demo' ? DemoBackend.create(onProgress) : Promise.resolve(new SupabaseBackend(c.url, c.key))
  cached = { key, p }
  p.catch(() => { if (cached?.p === p) cached = null })
  return p
}
