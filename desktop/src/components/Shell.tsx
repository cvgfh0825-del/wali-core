import { ReactNode, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, FileText, Users, Package, Warehouse, Truck, ShoppingBag, Factory,
  Wallet, Receipt, UserCog, Clock, Banknote, PieChart, BarChart3, ShieldCheck, Settings as Cog, Bell as BellIcon,
  LogOut, DollarSign, LogIn as InIcon, LogOut as OutIcon, AlertTriangle, ChevronLeft, FlaskConical,
} from 'lucide-react'
import { useApp, useLoad } from '../lib/app'
import { Logo, Modal, Field } from './ui'
import { num, time } from '../lib/format'
import { ROLE_PRESETS } from '../lib/perms'
import { PrintHost } from './Print'

const isElectron = !!(window as any).wali

const NAV: { group: string; items: { to: string; label: string; icon: any; mod: string; act?: string }[] }[] = [
  { group: 'الرئيسية', items: [
    { to: '/', label: 'لوحة التحكم', icon: LayoutDashboard, mod: 'dashboard' },
  ] },
  { group: 'المعرض والمبيعات', items: [
    { to: '/sales', label: 'فاتورة جديدة', icon: ShoppingCart, mod: 'sales', act: 'create' },
    { to: '/invoices', label: 'الفواتير', icon: FileText, mod: 'sales' },
    { to: '/customers', label: 'العملاء', icon: Users, mod: 'customers' },
  ] },
  { group: 'المخزن', items: [
    { to: '/products', label: 'الأصناف', icon: Package, mod: 'products' },
    { to: '/stock', label: 'حركة المخزن والجرد', icon: Warehouse, mod: 'stock' },
    { to: '/deliveries', label: 'أذونات التسليم', icon: Truck, mod: 'delivery' },
    { to: '/purchases', label: 'المشتريات', icon: ShoppingBag, mod: 'purchases' },
    { to: '/suppliers', label: 'الموردون', icon: Factory, mod: 'suppliers' },
  ] },
  { group: 'الحسابات', items: [
    { to: '/accounting', label: 'المقبوضات والمدفوعات', icon: Wallet, mod: 'accounting' },
    { to: '/expenses', label: 'المصروفات', icon: Receipt, mod: 'expenses' },
    { to: '/rates', label: 'سعر الدولار', icon: DollarSign, mod: 'rates' },
    { to: '/reports', label: 'التقارير والأرباح', icon: BarChart3, mod: 'reports' },
  ] },
  { group: 'الموظفون والشركاء', items: [
    { to: '/employees', label: 'الموظفون', icon: UserCog, mod: 'hr' },
    { to: '/attendance', label: 'الحضور والانصراف', icon: Clock, mod: 'attendance' },
    { to: '/payroll', label: 'المرتبات والسلفيات', icon: Banknote, mod: 'payroll' },
    { to: '/shareholders', label: 'المساهمون', icon: PieChart, mod: 'shareholders' },
  ] },
  { group: 'النظام', items: [
    { to: '/users', label: 'المستخدمون والصلاحيات', icon: ShieldCheck, mod: 'users' },
    { to: '/settings', label: 'الإعدادات', icon: Cog, mod: 'settings' },
  ] },
]

export default function Shell({ children }: { children: ReactNode }) {
  const { can, me, isAdmin, rate, latestRate, db, signOut } = useApp()
  const nav = useNavigate()
  const [rateOpen, setRateOpen] = useState(false)
  const canSetRate = can('rates', 'create')

  // أول ما البرنامج يفتح: لو ريت النهارده مش مكتوب، اطلبه
  useEffect(() => { if (rate == null && canSetRate) setRateOpen(true) }, [rate, canSetRate])

  return (
    <div className="h-full flex flex-col">
      {/* الشريط العلوي */}
      <header className="h-14 shrink-0 flex items-center gap-3 border-b border-ink-700/70 bg-ink-950/90 backdrop-blur drag relative z-20">
        {isElectron && <div className="w-[138px] shrink-0" />}
        <div className={`flex items-center gap-3 ${isElectron ? '' : 'pr-5'} w-[248px] shrink-0`}>
          <Logo size={30} />
          <div className="font-display font-black text-[17px] tracking-wide" dir="ltr">WALI<span className="text-brand-500">CORE</span></div>
          {db.mode === 'demo' && <span className="chip bg-amber-500/15 text-amber-300 no-drag" title="بيانات تجريبية على هذا الجهاز فقط"><FlaskConical size={12} /> تجربة</span>}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 pl-4 no-drag">
          <button onClick={() => (canSetRate ? setRateOpen(true) : nav('/rates'))}
            className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-[13px] font-semibold transition ${rate ? 'border-ink-600 bg-ink-850 hover:border-brand-500/50' : 'border-amber-500/50 bg-amber-500/10 text-amber-300 animate-ring'}`}>
            <DollarSign size={15} className="text-brand-500" />
            {rate ? <><span className="text-zinc-400">سعر الصرف</span><span className="num text-[15px]">{num(rate, 2)}</span><span className="text-zinc-500 text-[11px]">ج.س</span></>
              : <><AlertTriangle size={14} /> لم يُسجَّل سعر صرف اليوم</>}
          </button>
          <AttendanceButton />
          {isAdmin && <NotifBell />}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* القائمة الجانبية */}
        <aside className="w-[264px] shrink-0 border-l border-ink-700/70 bg-ink-950 flex flex-col">
          <nav className="flex-1 overflow-auto px-3 py-4 space-y-5">
            {NAV.map((g) => {
              const items = g.items.filter((i) => can(i.mod, i.act ?? 'view'))
              if (!items.length) return null
              return (
                <div key={g.group}>
                  <div className="px-3 mb-1.5 text-[11px] font-bold text-zinc-500 tracking-wide">{g.group}</div>
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'}
                      className={({ isActive }) => `group relative flex items-center gap-3 h-10 px-3 rounded-xl text-[14px] font-medium transition ${isActive ? 'bg-gradient-to-l from-brand-500/20 to-brand-500/5 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-ink-800'}`}>
                      {({ isActive }) => (<>
                        {isActive && <span className="absolute right-0 top-2 bottom-2 w-1 rounded-l bg-brand-500" />}
                        <i.icon size={18} className={isActive ? 'text-brand-400' : 'text-zinc-500 group-hover:text-zinc-300'} />
                        {i.label}
                      </>)}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </nav>
          <div className="p-3 border-t border-ink-700/70">
            <div className="flex items-center gap-3 p-2 rounded-xl bg-ink-850 border border-ink-700">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-ink-950 font-black flex items-center justify-center text-lg">
                {(me.full_name || me.username).trim().charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{me.full_name || me.username}</div>
                <div className="text-[11px] text-zinc-500">{ROLE_PRESETS[me.role]?.label}</div>
              </div>
              <button title="تسجيل خروج" onClick={signOut} className="p-2 rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-500/10"><LogOut size={17} /></button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-auto dots">
          <div className="max-w-[1500px] mx-auto px-8 py-7">{children}</div>
        </main>
      </div>

      <PrintHost />
      <RateModal open={rateOpen} onClose={() => setRateOpen(false)} mustSet={rate == null} suggested={latestRate} />
    </div>
  )
}

function RateModal({ open, onClose, mustSet, suggested }: { open: boolean; onClose: () => void; mustSet: boolean; suggested: number | null }) {
  const { db, reloadRate, toast, rate } = useApp()
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setV(String(rate ?? suggested ?? '')) }, [open, rate, suggested])
  const save = async () => {
    setBusy(true)
    try {
      await db.rpc('set_exchange_rate', { p_rate: Number(v) })
      await reloadRate()
      toast('سُجِّل سعر الدولار، وحُدِّثت جميع الأسعار بالجنيه')
      onClose()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} width="max-w-md"
      title={mustSet ? 'صباح الخير — أدخل سعر الدولار لهذا اليوم' : 'تعديل سعر الدولار'}
      subtitle="ستُحسب جميع أسعار الأصناف بالجنيه وفق هذا السعر، ولن تتأثر الفواتير السابقة.">
      <div className="flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-br from-brand-500/15 to-transparent border border-brand-500/25">
        <div className="text-center">
          <div className="num text-3xl font-black">1$</div>
          <div className="text-[11px] text-zinc-400">دولار</div>
        </div>
        <ChevronLeft className="text-brand-500" />
        <div className="flex-1">
          <input className="input h-14 text-2xl num font-bold text-center" autoFocus inputMode="decimal" value={v}
            onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && Number(v) > 0 && save()} />
          <div className="text-[11px] text-zinc-400 text-center mt-1">جنيه سوداني</div>
        </div>
      </div>
      {suggested != null && <p className="text-[13px] text-zinc-500 mt-3">آخر سعر مسجَّل: <span className="num text-zinc-300">{num(suggested, 2)}</span></p>}
      <div className="flex gap-2 mt-5">
        <button className="btn-primary flex-1" disabled={busy || !(Number(v) > 0)} onClick={save}>حفظ السعر</button>
        <button className="btn-ghost" onClick={onClose}>{mustSet ? 'لاحقًا' : 'إلغاء'}</button>
      </div>
    </Modal>
  )
}

function AttendanceButton() {
  const { db, toast } = useApp()
  const { data, reload } = useLoad(async () => {
    const emp = await db.rpc<any>('my_employee')
    if (!emp?.id) return null
    const rows = await db.list('attendance', { eq: { employee_id: emp.id }, order: [{ col: 'work_date', asc: false }], limit: 1 })
    return { emp, today: rows[0] && rows[0].work_date === new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum' }).format(new Date()) ? rows[0] : null }
  }, [])
  if (!data) return null
  const t = data.today
  const act = async (fn: 'check_in' | 'check_out') => {
    try { await db.rpc(fn); toast(fn === 'check_in' ? 'سُجِّل حضورك — يومًا موفقًا' : 'سُجِّل انصرافك — في أمان الله'); reload() }
    catch (e: any) { toast(e.message, 'err') }
  }
  if (!t) return <button onClick={() => act('check_in')} className="btn-sm btn bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"><InIcon size={15} /> تسجيل حضور</button>
  if (!t.check_out) return <button onClick={() => act('check_out')} className="btn-sm btn-ghost" title={`وقت الحضور ${time(t.check_in)}`}><OutIcon size={15} /> انصراف <span className="text-zinc-500 num text-[11px]">({time(t.check_in)})</span></button>
  return <span className="chip bg-ink-800 text-zinc-400 h-9 px-3 rounded-lg">انصرفتَ {time(t.check_out)}</span>
}

function NotifBell() {
  const { db } = useApp()
  const nav = useNavigate()
  const { data } = useLoad(() => db.list('notifications', { isNull: ['read_at'], select: 'id', limit: 100 }), [], ['notifications'])
  const n = data?.length ?? 0
  return (
    <button onClick={() => nav('/notifications')} className="relative w-9 h-9 rounded-xl border border-ink-600 bg-ink-850 flex items-center justify-center hover:border-brand-500/50">
      <BellIcon size={17} />
      {n > 0 && <span className="absolute -top-1.5 -left-1.5 min-w-5 h-5 px-1 rounded-full bg-brand-500 text-ink-950 text-[11px] font-black num flex items-center justify-center">{n > 99 ? '99+' : n}</span>}
    </button>
  )
}
