import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, Database, FlaskConical, ArrowLeft, LogIn, User, Lock } from 'lucide-react'
import { Backend, Conn, Profile, openBackend, saveConn, savedConn } from './lib/backend'
import { AppProvider, ToastProvider, useToasts } from './lib/app'
import { Logo, Toaster, Field, Wordmark } from './components/ui'
import { DeskScene } from './components/art'
import Shell from './components/Shell'
import Dashboard from './pages/Dashboard'
import SalesPOS from './pages/SalesPOS'
import Invoices from './pages/Invoices'
import Customers from './pages/Customers'
import Products from './pages/Products'
import Stock from './pages/Stock'
import Purchases from './pages/Purchases'
import Suppliers from './pages/Suppliers'
import Deliveries from './pages/Deliveries'
import Accounting from './pages/Accounting'
import Expenses from './pages/Expenses'
import Employees from './pages/Employees'
import Attendance from './pages/Attendance'
import Payroll from './pages/Payroll'
import Shareholders from './pages/Shareholders'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import Rates from './pages/Rates'

export default function App() {
  return (
    <ToastProvider>
      <Root />
      <Toaster />
    </ToastProvider>
  )
}

function Root() {
  const [conn, setConn] = useState<Conn | null>(savedConn())
  const [db, setDb] = useState<Backend | null>(null)
  const [me, setMe] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [progress, setProgress] = useState('')
  const { push } = useToasts()

  useEffect(() => {
    if (!conn) { setBooting(false); return }
    let alive = true
    setBooting(true)
    openBackend(conn, setProgress)
      .then(async (b) => {
        if (!alive) return
        setDb(b)
        setMe(await b.restore().catch(() => null))
      })
      .catch((e) => { push(e.message, 'err'); setConn(null); saveConn(null) })
      .finally(() => alive && setBooting(false))
    return () => { alive = false }
  }, [conn, push])

  if (booting) return <Splash text={progress} />
  if (!conn || !db) return <Connect onDone={(c) => { saveConn(c); setConn(c) }} />
  if (!me) return <Login db={db} onLogin={setMe} onReset={() => { saveConn(null); setDb(null); setConn(null) }} />

  return (
    <AppProvider db={db} me={me} onSignOut={async () => { await db.signOut(); setMe(null) }}>
      <HashRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={<SalesPOS />} />
            <Route path="/sales/:id" element={<SalesPOS />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/products" element={<Products />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/deliveries" element={<Deliveries />} />
            <Route path="/accounting" element={<Accounting />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/shareholders" element={<Shareholders />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/users" element={<Users />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/rates" element={<Rates />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Shell>
      </HashRouter>
    </AppProvider>
  )
}

function Splash({ text }: { text?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 grid-lines drag">
      <div className="animate-rise"><Logo size={92} glow /></div>
      <Wordmark />
      <div className="flex items-center gap-2 text-sm text-zinc-400 h-6">
        <Loader2 size={16} className="animate-spin text-brand-500" /> {text || 'بنفتح السيستم...'}
      </div>
    </div>
  )
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full grid grid-cols-[1fr_1.1fr] bg-ink-950">
      <div className="flex flex-col justify-center px-16 relative z-10 no-drag">
        <div className="max-w-[420px] w-full mx-auto animate-rise">{children}</div>
      </div>
      <div className="relative overflow-hidden bg-ink-900 border-r border-ink-700 drag">
        <div className="absolute inset-0 grid-lines opacity-70" />
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-brand-500/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-brand-600/10 blur-[100px]" />
        <div className="relative h-full flex flex-col justify-between p-14">
          <div className="flex items-center gap-3"><Logo size={44} /><Wordmark small /></div>
          <DeskScene className="w-full max-w-[560px] mx-auto drop-shadow-[0_30px_60px_rgba(0,0,0,.6)]" />
          <div>
            <div className="font-display text-4xl font-black leading-[1.3]">نجهّز مكتبك <span className="text-brand-500">بالكامل</span></div>
            <p className="text-zinc-400 mt-3 max-w-md leading-7">المخزن والمعرض والفواتير والحسابات والموظفين — كله في مكان واحد، ومتزامن بين كل الأجهزة.</p>
            <div className="flex gap-6 mt-6 text-sm">
              {['24 قسم', 'ضمان سنة', 'تركيب احترافي'].map((t) => (
                <div key={t} className="flex items-center gap-2 text-zinc-300"><span className="w-1.5 h-1.5 rounded-full bg-brand-500" />{t}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Connect({ onDone }: { onDone: (c: Conn) => void }) {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  return (
    <AuthLayout>
      <Logo size={56} glow />
      <h1 className="font-display text-3xl font-black mt-6">أهلاً بيك في <span dir="ltr">WALI CORE</span></h1>
      <p className="text-zinc-400 mt-2 leading-7">أول مرة بتفتح البرنامج على الجهاز ده. اربطه بقاعدة بيانات الشركة.</p>

      <div className="card p-5 mt-8 space-y-4">
        <div className="flex items-center gap-2 font-bold"><Database size={18} className="text-brand-500" /> ربط بـ Supabase</div>
        <Field label="رابط المشروع (Project URL)"><input className="input" dir="ltr" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value.trim())} /></Field>
        <Field label="المفتاح العام (anon key)"><input className="input" dir="ltr" value={key} onChange={(e) => setKey(e.target.value.trim())} /></Field>
        <button className="btn-primary w-full" disabled={!/^https:\/\/.+\.supabase\.co\/?$/.test(url) || key.length < 20}
          onClick={() => onDone({ mode: 'supabase', url: url.replace(/\/$/, ''), key })}>
          اربط وكمّل <ArrowLeft size={18} />
        </button>
      </div>

      <button onClick={() => onDone({ mode: 'demo' })} className="mt-4 w-full card p-4 flex items-center gap-3 text-right hover:border-brand-500/50 transition">
        <div className="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-400 flex items-center justify-center"><FlaskConical size={20} /></div>
        <div className="flex-1">
          <div className="font-bold">جرّب السيستم الأول</div>
          <div className="text-[13px] text-zinc-400">وضع تجربة ببيانات وهمية على الجهاز ده بس</div>
        </div>
        <ArrowLeft size={18} className="text-zinc-500" />
      </button>
    </AuthLayout>
  )
}

function Login({ db, onLogin, onReset }: { db: Backend; onLogin: (p: Profile) => void; onReset: () => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { onLogin(await db.signIn(u, p)) } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <AuthLayout>
      <Logo size={56} glow />
      <h1 className="font-display text-3xl font-black mt-6">تسجيل الدخول</h1>
      <p className="text-zinc-400 mt-2">ادخل باسم المستخدم وكلمة السر اللي الأدمن عملهولك.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="اسم المستخدم">
          <div className="relative"><User size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input pr-10" dir="ltr" autoFocus value={u} onChange={(e) => setU(e.target.value)} /></div>
        </Field>
        <Field label="كلمة السر">
          <div className="relative"><Lock size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input pr-10" dir="ltr" type="password" value={p} onChange={(e) => setP(e.target.value)} /></div>
        </Field>
        {err && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">{err}</div>}
        <button className="btn-primary w-full h-12 text-base" disabled={busy || !u || !p}>
          {busy ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />} دخول
        </button>
      </form>
      {db.mode === 'demo' && (
        <div className="mt-6 card p-4 text-[13px] text-zinc-400 leading-7">
          <div className="font-bold text-brand-400 mb-1">وضع التجربة — حسابات جاهزة:</div>
          <div className="grid grid-cols-2 gap-x-4 num" dir="ltr">
            {[['admin', 'admin123', 'المدير'], ['sara', 'sara123', 'المعرض'], ['mohamed', 'mohamed123', 'المحاسب'], ['khaled', 'khaled123', 'المخزن']].map(([a, b, c]) => (
              <button key={a} type="button" onClick={() => { setU(a); setP(b) }} className="text-left hover:text-white">
                {a} / {b} <span className="font-sans text-zinc-500">· {c}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={onReset} className="mt-6 text-[13px] text-zinc-500 hover:text-zinc-300">
        {db.mode === 'demo' ? 'الخروج من وضع التجربة والربط بـ Supabase' : 'تغيير قاعدة البيانات'}
      </button>
    </AuthLayout>
  )
}
