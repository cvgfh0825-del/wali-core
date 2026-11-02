import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import {
  Bell, BellRing, LogOut, Share, PlusSquare, DollarSign, TrendingUp, FileClock, X, Loader2, FileText, Package, Wallet,
  Clock, ShieldAlert, Truck, PieChart, Users, CheckCheck, ChevronLeft, Smartphone, Download,
} from 'lucide-react'

type Row = Record<string, any>

// ---------------------------------------------------------------------
// الاتصال: من ملف .env، وإلا مشروع والي بلازا (المفاتيح دي عامة ومش سرية)
// ---------------------------------------------------------------------
const WALI = {
  url: 'https://avqwkxoeptkbzxdckedy.supabase.co',
  key: 'sb_publishable_P3BzxNxjqMMZeXjSlRCkYw_YjIyPZgJ',
  vapid: 'BJu3sYzgZd0pAmDsT2JvULMu0-yas6TpcRa3DF49x8iwg_UHw9WLKoDWgaZFLUh4g705SshNOcwhr97MzsiwG9E',
}
function getConn() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || WALI.url
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || WALI.key
  if (url && key && !url.includes('xxxx')) return { url, key }
  try { return JSON.parse(localStorage.getItem('wali-admin-conn') || 'null') } catch { return null }
}
const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string) || WALI.vapid

const fmt = (n: any) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))
const short = (n: any) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' م'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + ' ألف'
  return fmt(v)
}
const TZ = 'Africa/Khartoum'
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const ago = (s: string) => {
  const d = (Date.now() - new Date(s).getTime()) / 1000
  if (d < 60) return 'دلوقتي'
  if (d < 3600) return `${Math.floor(d / 60)} د`
  if (d < 86400) return `${Math.floor(d / 3600)} س`
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(s))
}
const timeStr = (s: string) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(s))

const ICON: Record<string, any> = {
  invoices: FileText, products: Package, stock_movements: Package, exchange_rates: DollarSign, payments: Wallet, expenses: Wallet,
  attendance: Clock, employees: Users, profiles: ShieldAlert, delivery_permits: Truck, shareholders: PieChart, shareholder_terms: PieChart,
  shareholder_payouts: PieChart, payrolls: Wallet, salary_advances: Wallet, salary_deductions: Wallet, purchases: Package,
}
const LEVEL: Record<string, string> = {
  info: 'bg-brand-500/15 text-brand-300', success: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300', danger: 'bg-red-500/15 text-red-300',
}
const FILTERS = [
  { key: 'all', label: 'الكل' }, { key: 'unread', label: 'جديد' },
  { key: 'sales', label: 'المبيعات', types: ['invoices', 'payments'] },
  { key: 'stock', label: 'المخزن', types: ['products', 'stock_movements', 'delivery_permits', 'purchases'] },
  { key: 'people', label: 'الموظفين', types: ['attendance', 'employees', 'salary_advances', 'salary_deductions', 'payrolls', 'profiles'] },
  { key: 'money', label: 'الحسابات', types: ['expenses', 'exchange_rates', 'shareholders', 'shareholder_terms', 'shareholder_payouts'] },
]

function Logo({ size = 40 }: { size?: number }) {
  return <img src="./icons/icon.svg" width={size} height={size} alt="" />
}

export default function App() {
  const [conn, setConn] = useState(getConn())
  const sb = useMemo(() => (conn ? createClient(conn.url, conn.key, { auth: { persistSession: true, storageKey: 'wali-admin-auth' } }) : null), [conn])
  const [me, setMe] = useState<Row | null | undefined>(undefined)

  const loadMe = useCallback(async () => {
    if (!sb) return setMe(null)
    const { data: s } = await sb.auth.getSession()
    if (!s.session) return setMe(null)
    const { data } = await sb.from('profiles').select('*').eq('id', s.session.user.id).single()
    setMe(data ?? null)
  }, [sb])
  useEffect(() => { loadMe() }, [loadMe])

  if (!conn || !sb) return <Setup onDone={(c) => { localStorage.setItem('wali-admin-conn', JSON.stringify(c)); setConn(c) }} />
  if (me === undefined) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-brand-500" /></div>
  if (!me) return <Login sb={sb} onLogin={loadMe} />
  if (me.role !== 'admin') return <Blocked sb={sb} onOut={() => setMe(null)} />
  return <Home sb={sb} me={me} onOut={async () => { await sb.auth.signOut(); setMe(null) }} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden safe-top safe-bottom">
      <div className="absolute inset-0 grid-lines opacity-50 pointer-events-none" />
      <div className="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-brand-500/20 blur-[90px] pointer-events-none" />
      <div className="relative px-5">{children}</div>
    </div>
  )
}

function Setup({ onDone }: { onDone: (c: { url: string; key: string }) => void }) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  return (
    <Shell>
      <div className="pt-16 max-w-sm mx-auto">
        <Logo size={64} />
        <h1 className="font-display text-3xl font-black mt-6">إعداد أول مرة</h1>
        <p className="text-zinc-400 mt-2">بيانات مشروع Supabase بتاع الشركة.</p>
        <div className="space-y-3 mt-8">
          <input className="input" dir="ltr" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
          <input className="input" dir="ltr" placeholder="anon key" value={key} onChange={(e) => setKey(e.target.value.trim())} />
          <button className="btn-primary w-full" disabled={!url.startsWith('https://') || key.length < 20} onClick={() => onDone({ url, key })}>حفظ</button>
        </div>
      </div>
    </Shell>
  )
}

function Login({ sb, onLogin }: { sb: SupabaseClient; onLogin: () => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await sb.auth.signInWithPassword({ email: `${u.trim().toLowerCase()}@wali.local`, password: p })
    setBusy(false)
    if (error) setErr('اسم المستخدم أو كلمة السر غلط'); else onLogin()
  }
  return (
    <Shell>
      <form onSubmit={go} className="pt-20 max-w-sm mx-auto">
        <Logo size={72} />
        <div className="font-display text-[15px] font-black tracking-wide mt-6" dir="ltr">WALI<span className="text-brand-500">CORE</span></div>
        <h1 className="font-display text-3xl font-black mt-1">لوحة الأدمن</h1>
        <p className="text-zinc-400 mt-2">كل اللي بيحصل في والي بلازا — على موبايلك.</p>
        <div className="space-y-3 mt-8">
          <input className="input" dir="ltr" placeholder="اسم المستخدم" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} />
          <input className="input" dir="ltr" type="password" placeholder="كلمة السر" value={p} onChange={(e) => setP(e.target.value)} />
          {err && <div className="text-red-300 text-sm">{err}</div>}
          <button className="btn-primary w-full" disabled={busy || !u || !p}>{busy ? <Loader2 className="animate-spin" size={18} /> : 'دخول'}</button>
        </div>
      </form>
    </Shell>
  )
}

function Blocked({ sb, onOut }: { sb: SupabaseClient; onOut: () => void }) {
  return (
    <Shell>
      <div className="pt-24 text-center max-w-sm mx-auto">
        <ShieldAlert size={48} className="mx-auto text-red-400" />
        <h1 className="text-2xl font-black mt-4">التطبيق ده للأدمن بس</h1>
        <button className="btn-ghost mt-8" onClick={async () => { await sb.auth.signOut(); onOut() }}>خروج</button>
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------------
// الإشعارات على الموبايل
// ---------------------------------------------------------------------
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const native = Capacitor.isNativePlatform()

// تطبيق الأندرويد: بنسجّل الموبايل في Firebase (FCM) ونحفظ الـ token في push_subscriptions
// على هيئة endpoint يبدأ بـ fcm: — ودالة push-notify بتفرّق بينه وبين اشتراكات المتصفح
async function registerNative(sb: SupabaseClient, me: Row) {
  await PushNotifications.createChannel({ id: 'wali', name: 'إشعارات والي بلازا', importance: 5, visibility: 1, sound: 'default', vibration: true, lights: true, lightColor: '#FF7A1A' })
  await PushNotifications.removeAllListeners()
  const token = new Promise<string>((ok, fail) => {
    PushNotifications.addListener('registration', (t) => ok(t.value))
    PushNotifications.addListener('registrationError', (e) => fail(new Error(e.error)))
  })
  // الضغط على الإشعار بيفتح تفاصيله
  PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const id = a.notification.data?.id
    if (id) location.hash = `#/n/${id}`
  })
  PushNotifications.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event('wali-push')))
  await PushNotifications.register()
  const t = await token
  await sb.from('push_subscriptions').upsert({ user_id: me.id, endpoint: `fcm:${t}`, p256dh: '', auth: '', user_agent: navigator.userAgent }, { onConflict: 'endpoint' })
}

// أندرويد: Chrome بيبعت حدث التثبيت، بنمسكه عشان نعرض زرار «تثبيت التطبيق»
let installEvt: any = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; window.dispatchEvent(new Event('wali-install')) })

function InstallCard() {
  const [can, setCan] = useState(!!installEvt)
  useEffect(() => {
    const on = () => setCan(!!installEvt)
    window.addEventListener('wali-install', on)
    window.addEventListener('appinstalled', () => { installEvt = null; setCan(false) })
    return () => window.removeEventListener('wali-install', on)
  }, [])
  if (native || isStandalone() || isIOS() || !can) return null
  const install = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; setCan(false) }
  return (
    <button onClick={install} className="w-full mt-5 rounded-3xl border border-ink-600 bg-ink-900 p-4 flex items-center gap-3 text-right active:scale-[.98] transition">
      <span className="w-11 h-11 rounded-2xl bg-brand-500/15 text-brand-400 grid place-items-center"><Download size={20} /></span>
      <span className="flex-1">
        <span className="block font-black">ثبّت التطبيق على الموبايل</span>
        <span className="block text-[13px] text-zinc-400">يبقى ليه أيقونة على الشاشة ويفتح زي أي تطبيق</span>
      </span>
    </button>
  )
}
const b64ToU8 = (b: string) => {
  const pad = '='.repeat((4 - (b.length % 4)) % 4)
  const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

function PushCard({ sb, me }: { sb: SupabaseClient; me: Row }) {
  const [state, setState] = useState<'checking' | 'install' | 'off' | 'on' | 'denied' | 'unsupported'>('checking')
  const [busy, setBusy] = useState(false)
  const check = useCallback(async () => {
    if (native) {
      const p = (await PushNotifications.checkPermissions()).receive
      if (p === 'denied') return setState('denied')
      if (p !== 'granted') return setState('off')
      // كل مرة التطبيق يفتح بنجدد الـ token (ممكن يتغير)
      registerNative(sb, me).catch(() => {})
      return setState('on')
    }
    if (isIOS() && !isStandalone()) return setState('install')
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported')
    if (Notification.permission === 'denied') return setState('denied')
    const reg = await navigator.serviceWorker.ready
    setState((await reg.pushManager.getSubscription()) ? 'on' : 'off')
  }, [sb, me])
  useEffect(() => { check() }, [check])

  const enable = async () => {
    setBusy(true)
    try {
      if (native) {
        if ((await PushNotifications.requestPermissions()).receive !== 'granted') return setState('denied')
        await registerNative(sb, me)
        return setState('on')
      }
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) })
      const j = sub.toJSON() as any
      await sb.from('push_subscriptions').upsert({ user_id: me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent }, { onConflict: 'endpoint' })
      setState('on')
    } catch (e: any) { alert('مقدرناش نفعّل الإشعارات: ' + e.message) } finally { setBusy(false) }
  }

  if (state === 'on' || state === 'checking') return null
  return (
    <div className="rounded-3xl border border-brand-500/40 bg-gradient-to-br from-brand-500/20 to-brand-500/5 p-5 mt-5">
      {state === 'install' ? (
        <>
          <div className="flex items-center gap-2 font-black text-lg"><Smartphone size={20} className="text-brand-400" /> نزّل التطبيق على الآيفون</div>
          <ol className="text-[14px] text-zinc-300 mt-3 space-y-2.5 leading-6">
            <li className="flex gap-2"><span className="num text-brand-400 font-black">1</span> دوس على زرار المشاركة <Share size={16} className="inline text-sky-400" /> تحت في Safari</li>
            <li className="flex gap-2"><span className="num text-brand-400 font-black">2</span> اختار «إضافة إلى الشاشة الرئيسية» <PlusSquare size={16} className="inline" /></li>
            <li className="flex gap-2"><span className="num text-brand-400 font-black">3</span> افتح التطبيق من الأيقونة وفعّل الإشعارات</li>
          </ol>
        </>
      ) : state === 'denied' && native ? (
        <div className="text-[14px] leading-6">الإشعارات مقفولة. افتح <b>إعدادات الموبايل ← التطبيقات ← WALI CORE ← الإشعارات</b> وفعّلها، وبعدين ارجع للتطبيق.</div>
      ) : state === 'denied' ? (
        <div className="text-[14px] leading-6">الإشعارات مقفولة. دوس على علامة القفل جنب الرابط فوق ← <b>الأذونات ← الإشعارات</b> وخليها «سماح»، أو من <b>إعدادات الموبايل ← التطبيقات ← والي بلازا ← الإشعارات</b>.</div>
      ) : state === 'unsupported' ? (
        <div className="text-[14px] leading-6">المتصفح ده مش بيدعم الإشعارات. افتح الرابط من <b>Google Chrome</b>.</div>
      ) : (
        <>
          <div className="flex items-center gap-2 font-black text-lg"><BellRing size={20} className="text-brand-400" /> شغّل الإشعارات</div>
          <p className="text-[14px] text-zinc-300 mt-1">عشان يوصلك كل حاجة بتحصل حتى والتطبيق مقفول.</p>
          <button className="btn-primary w-full mt-4" disabled={busy} onClick={enable}>{busy ? <Loader2 className="animate-spin" size={18} /> : 'تفعيل الإشعارات'}</button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// الشاشة الرئيسية
// ---------------------------------------------------------------------
function Home({ sb, me, onOut }: { sb: SupabaseClient; me: Row; onOut: () => void }) {
  const [list, setList] = useState<Row[]>([])
  const [stats, setStats] = useState<Row | null>(null)
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const f = FILTERS.find((x) => x.key === filter)!
    let q = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(150)
    if (filter === 'unread') q = q.is('read_at', null)
    if (f.types) q = q.in('entity_type', f.types)
    const [{ data }, dash] = await Promise.all([q, sb.rpc('dashboard', { p_from: todayStr(), p_to: todayStr() })])
    setList(data ?? [])
    setStats(dash.data ?? null)
    setLoading(false)
  }, [sb, filter])

  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => {
    const ch = sb.channel('admin-n').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => load()).subscribe()
    const onMsg = () => load()
    navigator.serviceWorker?.addEventListener('message', onMsg)
    window.addEventListener('wali-push', onMsg)
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    return () => { sb.removeChannel(ch); navigator.serviceWorker?.removeEventListener('message', onMsg); window.removeEventListener('wali-push', onMsg); document.removeEventListener('visibilitychange', onVis) }
  }, [sb, load])

  // فتح إشعار من اللينك (#/n/<id>) لما يدوس على الإشعار
  useEffect(() => {
    const fromHash = async () => {
      const m = location.hash.match(/#\/n\/([\w-]+)/)
      if (!m) return
      const { data } = await sb.from('notifications').select('*').eq('id', m[1]).maybeSingle()
      if (data) openN(data)
      history.replaceState(null, '', location.pathname)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb])

  const unread = list.filter((n) => !n.read_at).length
  useEffect(() => { (navigator as any).setAppBadge?.(unread).catch?.(() => {}) }, [unread])

  const openN = async (n: Row) => {
    setOpen(n)
    if (!n.read_at) {
      await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      setList((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
    }
  }
  const readAll = async () => {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    load()
  }

  const groups: [string, Row[]][] = []
  for (const n of list) {
    const d = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(n.created_at))
    const g = groups.find((x) => x[0] === d)
    if (g) g[1].push(n); else groups.push([d, [n]])
  }

  return (
    <Shell>
      <header className="flex items-center gap-3 pt-2">
        <Logo size={42} />
        <div className="flex-1">
          <div className="font-display font-black text-[15px]" dir="ltr">WALI<span className="text-brand-500">CORE</span></div>
          <div className="text-[12px] text-zinc-400">أهلاً {me.full_name || me.username}</div>
        </div>
        {unread > 0 && <button onClick={readAll} className="w-11 h-11 rounded-2xl bg-ink-800 border border-ink-600 flex items-center justify-center text-zinc-300"><CheckCheck size={18} /></button>}
        <button onClick={onOut} className="w-11 h-11 rounded-2xl bg-ink-800 border border-ink-600 flex items-center justify-center text-zinc-400"><LogOut size={18} /></button>
      </header>

      {stats && (
        <div className="grid grid-cols-3 gap-2.5 mt-5">
          <StatBox icon={<TrendingUp size={16} />} label="مبيعات النهارده" value={short(stats.sales)} accent />
          <StatBox icon={<FileClock size={16} />} label="مبدئيات مفتوحة" value={stats.open_proformas} />
          <StatBox icon={<DollarSign size={16} />} label="الريت" value={stats.rate_today ? fmt(stats.rate_today) : '—'} warn={!stats.rate_today} />
        </div>
      )}

      <InstallCard />
      <PushCard sb={sb} me={me} />

      <div className="flex gap-2 overflow-x-auto mt-5 -mx-5 px-5 pb-1 no-scrollbar">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`h-9 px-4 rounded-full text-[13px] font-bold whitespace-nowrap border transition ${filter === f.key ? 'bg-brand-500 border-brand-500 text-ink-950' : 'bg-ink-850 border-ink-600 text-zinc-300'}`}>
            {f.label}{f.key === 'unread' && unread > 0 && <span className="num mr-1">({unread})</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 pb-8">
        {loading ? <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-brand-500" /></div>
          : !list.length ? <div className="py-20 text-center text-zinc-500"><Bell className="mx-auto mb-3" size={36} />مفيش إشعارات</div>
          : groups.map(([day, items]) => (
            <div key={day} className="mb-5">
              <div className="text-[12px] font-bold text-zinc-500 mb-2 px-1">{day}</div>
              <div className="rounded-3xl bg-ink-850 border border-ink-700 overflow-hidden divide-y divide-ink-700/70">
                {items.map((n) => {
                  const Icon = ICON[n.entity_type] ?? Bell
                  return (
                    <button key={n.id} onClick={() => openN(n)} className={`w-full text-right flex items-start gap-3 px-4 py-3.5 active:bg-ink-800 ${!n.read_at ? 'bg-brand-500/[.05]' : ''}`}>
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${LEVEL[n.level]}`}><Icon size={18} /></div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[14px] leading-5 ${!n.read_at ? 'font-bold' : 'text-zinc-300'}`}>{n.title}</div>
                        {n.body && <div className="text-[12.5px] text-zinc-400 mt-0.5 truncate">{n.body}</div>}
                        <div className="text-[11px] text-zinc-500 mt-1">{n.actor_name} · {ago(n.created_at)}</div>
                      </div>
                      {!n.read_at && <span className="w-2.5 h-2.5 rounded-full bg-brand-500 mt-2 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
      </div>
      {open && <Detail sb={sb} n={open} onClose={() => setOpen(null)} />}
    </Shell>
  )
}

function StatBox({ icon, label, value, accent, warn }: { icon: any; label: string; value: any; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 border ${accent ? 'bg-gradient-to-br from-brand-500/25 to-ink-850 border-brand-500/30' : warn ? 'bg-amber-500/10 border-amber-500/40' : 'bg-ink-850 border-ink-700'}`}>
      <div className="text-zinc-400 flex items-center gap-1 text-[11px]">{icon}{label}</div>
      <div className="num text-[19px] font-black mt-1 truncate">{value}</div>
    </div>
  )
}

function Detail({ sb, n, onClose }: { sb: SupabaseClient; n: Row; onClose: () => void }) {
  const [inv, setInv] = useState<{ inv: Row; items: Row[] } | null>(null)
  useEffect(() => {
    if (n.entity_type !== 'invoices' || !n.entity_id) return
    Promise.all([
      sb.from('v_invoices').select('*').eq('id', n.entity_id).maybeSingle(),
      sb.from('invoice_items').select('*').eq('invoice_id', n.entity_id).order('sort'),
    ]).then(([a, b]) => a.data && setInv({ inv: a.data, items: b.data ?? [] }))
  }, [sb, n])
  const Icon = ICON[n.entity_type] ?? Bell
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end" onClick={onClose}>
      <div className="w-full max-h-[85vh] overflow-auto rounded-t-[28px] bg-ink-900 border-t border-ink-600 p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1.5 rounded-full bg-ink-600 mx-auto mb-4" />
        <div className="flex items-start gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${LEVEL[n.level]}`}><Icon size={22} /></div>
          <div className="flex-1">
            <div className="text-lg font-black leading-7">{n.title}</div>
            <div className="text-[12px] text-zinc-500">{n.actor_name} · {timeStr(n.created_at)}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-ink-800 flex items-center justify-center"><X size={17} /></button>
        </div>
        {n.body && <div className="mt-4 rounded-2xl bg-ink-850 border border-ink-700 p-4 text-[15px] leading-7">{n.body}</div>}
        {inv && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-zinc-400">العميل</span><span>{inv.inv.customer_name ?? 'عميل نقدي'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-400">الريت</span><span className="num">{fmt(inv.inv.rate)}</span></div>
            <div className="rounded-2xl border border-ink-700 divide-y divide-ink-700 mt-3">
              {inv.items.map((i) => (
                <div key={i.id} className="flex justify-between gap-3 px-4 py-3 text-[13px]">
                  <span className="truncate">{i.name} <span className="text-zinc-500 num">× {Number(i.qty)}</span></span>
                  <span className="num font-bold shrink-0">{fmt(i.total_sdg)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-end pt-2"><span className="font-bold">الإجمالي</span><span className="num text-2xl font-black text-brand-400">{fmt(inv.inv.total_sdg)} <span className="text-xs text-zinc-500">ج.س</span></span></div>
            {inv.inv.kind === 'final' && Number(inv.inv.remaining_sdg) > 0 && <div className="flex justify-between text-sm text-red-300"><span>المتبقي على العميل</span><span className="num">{fmt(inv.inv.remaining_sdg)}</span></div>}
          </div>
        )}
        <button className="btn-ghost w-full mt-5" onClick={onClose}>تمام <ChevronLeft size={16} /></button>
      </div>
    </div>
  )
}
