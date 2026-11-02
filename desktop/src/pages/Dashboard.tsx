import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Wallet, Package, AlertTriangle, FileClock, Truck, ShoppingCart, Plus, ArrowLeft, Coins, HandCoins, Receipt,
} from 'lucide-react'
import { useApp, useLoad } from '../lib/app'
import { Stat, Money, Loading, Tabs, Badge, Empty } from '../components/ui'
import { AreaChart, BarList } from '../components/charts'
import { ProductImage } from '../components/ProductImage'
import { daysAgo, today, short, ago, qty, date } from '../lib/format'

const RANGES = { '7': 'أسبوع', '30': 'شهر', '90': '3 شهور' } as const

export default function Dashboard() {
  const { db, me, can, isAdmin, settings } = useApp()
  const [range, setRange] = useState<keyof typeof RANGES>('30')
  const { data, loading } = useLoad(() => db.rpc<any>('dashboard', { p_from: daysAgo(Number(range) - 1), p_to: today() }), [range], ['invoices', 'products', 'exchange_rates'])
  const low = useLoad(() => can('products') ? db.list('v_products', { eq: { is_active: true }, order: [{ col: 'qty_on_hand' }], limit: 6 }) : Promise.resolve([]), [], ['products'])
  const proformas = useLoad(() => can('sales') ? db.list('v_invoices', { eq: { kind: 'proforma', status: 'open' }, order: [{ col: 'created_at', asc: false }], limit: 5 }) : Promise.resolve([]), [], ['invoices'])
  const notes = useLoad(() => isAdmin ? db.list('notifications', { order: [{ col: 'created_at', asc: false }], limit: 7 }) : Promise.resolve([]), [], ['notifications'])

  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Khartoum', hour: 'numeric', hour12: false }).format(new Date()))
  const greet = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء النور' : 'مساء الخير'
  const d = data
  const profit = d ? d.sales - d.cogs - d.expenses : 0

  return (
    <div className="space-y-6">
      {/* ترحيب */}
      <div className="relative overflow-hidden card p-7 bg-gradient-to-l from-ink-850 via-ink-850 to-brand-500/10 animate-rise">
        <div className="absolute inset-0 grid-lines opacity-40" />
        <div className="absolute -left-20 -bottom-24 w-80 h-80 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative flex items-center justify-between gap-6">
          <div>
            <div className="text-zinc-400 text-sm">{new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Khartoum', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</div>
            <h1 className="font-display text-3xl font-black mt-1">{greet}، {firstName(me.full_name || me.username)}</h1>
            <p className="text-zinc-400 mt-2">ده ملخص شغل {settings.company_name ?? 'والي بلازا'} — {RANGES[range]} آخر.</p>
          </div>
          <div className="flex items-center gap-2">
            {can('sales', 'create') && <Link to="/sales" className="btn-primary h-12 px-5"><ShoppingCart size={18} /> فاتورة جديدة</Link>}
            {can('purchases', 'create') && <Link to="/purchases?new=1" className="btn-ghost h-12"><Plus size={18} /> مشتريات</Link>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">الأرقام</h2>
        <Tabs value={range} onChange={setRange} items={Object.entries(RANGES).map(([k, v]) => ({ key: k as keyof typeof RANGES, label: v }))} />
      </div>

      {loading || !d ? <Loading /> : (
        <>
          {d.limited ? (
          <div className="grid grid-cols-4 gap-4">
            <Stat accent label="مبيعاتك" value={short(d.sales)} sub={`${d.sales_count} فاتورة نهائية${d.returns ? ` · مرتجع ${short(d.returns)}` : ''}`} icon={<TrendingUp size={20} />} />
            <Stat label="مبدئيات مفتوحة في المعرض" value={d.open_proformas} icon={<FileClock size={20} />} tone="amber" />
            <Stat label="أصناف قربت تخلص" value={d.low_stock} icon={<AlertTriangle size={20} />} tone={d.low_stock ? 'red' : 'green'} />
            <Stat label="الأصناف المتاحة" value={d.products_count} sub={`${qty(d.stock_units)} قطعة`} icon={<Package size={20} />} />
          </div>
          ) : (
          <div className="grid grid-cols-4 gap-4">
            <Stat accent label="المبيعات" value={short(d.sales)} sub={`${d.sales_count} فاتورة نهائية${d.returns ? ` · مرتجع ${short(d.returns)}` : ''}`} icon={<TrendingUp size={20} />} />
            <Stat label="صافي الربح التقريبي" value={short(profit)} sub="المبيعات − التكلفة − المصروفات" icon={<Coins size={20} />} tone={profit >= 0 ? 'green' : 'red'} />
            <Stat label="قيمة المخزون" value={short(d.stock_value_sdg)} sub={`${qty(d.stock_units)} قطعة · ${d.products_count} صنف`} icon={<Package size={20} />} />
            <Stat label="مستحقات على العملاء" value={short(d.receivables)} sub={`علينا للموردين ${short(d.payables)}`} icon={<HandCoins size={20} />} tone="amber" />
          </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="card p-6 col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-bold">حركة المبيعات اليومية</div>
                  <div className="text-[13px] text-zinc-500">بالجنيه السوداني</div>
                </div>
                {!d.limited && <div className="text-left">
                  <div className="text-[12px] text-zinc-500">اتحصّل فعلاً</div>
                  <Money v={d.collected} className="font-bold" />
                </div>}
              </div>
              <AreaChart data={(d.daily ?? []).map((x: any) => ({ label: x.day.slice(5).split('-').reverse().join('/'), value: Number(x.sales) }))} />
            </div>
            <div className="card p-6">
              <div className="font-bold mb-4">الأكثر مبيعاً</div>
              {d.top_products?.length ? (
                <BarList items={d.top_products.map((p: any) => ({ label: p.name, sub: `${qty(p.qty)} قطعة`, value: Number(p.total) }))} />
              ) : <Empty title="لسه مفيش مبيعات" />}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <MiniStat to="/invoices?tab=proforma" icon={<FileClock size={18} />} label="فواتير مبدئية مفتوحة" value={d.open_proformas} sub={<Money v={d.open_proformas_total} />} />
            <MiniStat to="/deliveries" icon={<Truck size={18} />} label="أذونات منتظرة التسليم" value={d.pending_deliveries} />
            <MiniStat to="/products?low=1" icon={<AlertTriangle size={18} />} label="أصناف قربت تخلص" value={d.low_stock} warn={d.low_stock > 0} />
            {!d.limited && <MiniStat to="/expenses" icon={<Receipt size={18} />} label="المصروفات" value={short(d.expenses)} sub={`مشتريات ${short(d.purchases)}`} />}
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-4">
        {can('products') && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4"><div className="font-bold">المخزون الأقل</div><Link to="/products" className="text-[13px] text-brand-400 flex items-center gap-1">الكل <ArrowLeft size={14} /></Link></div>
            <div className="space-y-2">
              {(low.data ?? []).map((p: any) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-ink-800">
                  <ProductImage p={p} className="w-10 h-10 rounded-lg object-cover" />
                  <div className="flex-1 min-w-0"><div className="text-sm truncate">{p.name}</div><div className="text-[11px] text-zinc-500 num">{p.code}</div></div>
                  <Badge cls={Number(p.qty_on_hand) <= Number(p.min_qty) ? 'bg-red-500/15 text-red-300' : 'bg-ink-700 text-zinc-300'}>{qty(p.qty_on_hand)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
        {can('sales') && (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4"><div className="font-bold">مبدئيات مستنية</div><Link to="/invoices?tab=proforma" className="text-[13px] text-brand-400 flex items-center gap-1">الكل <ArrowLeft size={14} /></Link></div>
            {(proformas.data ?? []).length ? (proformas.data ?? []).map((i: any) => (
              <Link to={`/invoices?open=${i.id}`} key={i.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-ink-800">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-300 flex items-center justify-center"><FileClock size={18} /></div>
                <div className="flex-1 min-w-0"><div className="text-sm truncate">{i.customer_name ?? 'عميل نقدي'}</div><div className="text-[11px] text-zinc-500 num">{i.number} · {i.salesperson_name}</div></div>
                <Money v={i.total_sdg} className="text-sm font-bold" />
              </Link>
            )) : <Empty title="مفيش مبدئيات مفتوحة" />}
          </div>
        )}
        {isAdmin ? (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4"><div className="font-bold">آخر اللي حصل</div><Link to="/notifications" className="text-[13px] text-brand-400 flex items-center gap-1">الكل <ArrowLeft size={14} /></Link></div>
            <div className="relative space-y-3 before:absolute before:right-[7px] before:top-2 before:bottom-2 before:w-px before:bg-ink-600">
              {(notes.data ?? []).map((n: any) => (
                <div key={n.id} className="relative pr-6">
                  <span className={`absolute right-0 top-1.5 w-[15px] h-[15px] rounded-full border-[3px] border-ink-850 ${n.level === 'danger' ? 'bg-red-500' : n.level === 'warning' ? 'bg-amber-400' : n.level === 'success' ? 'bg-emerald-500' : 'bg-brand-500'}`} />
                  <div className="text-[13px] font-semibold leading-5">{n.title}</div>
                  <div className="text-[11px] text-zinc-500">{n.actor_name} · {ago(n.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : d && (
          <div className="card p-6">
            <div className="font-bold mb-4">أفضل البائعين</div>
            <BarList items={(d.top_sellers ?? []).map((s: any) => ({ label: s.name, sub: `${s.invoices} فاتورة`, value: Number(s.total) }))} />
            <div className="text-[11px] text-zinc-500 mt-4">آخر تحديث {date(today())}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// أول اسم من غير الألقاب (أ. / م. / د.) ومن غير اللي بعد الشرطة
const firstName = (n: string) => n.split(/[—(]/)[0].trim().split(/\s+/).find((w) => !/\.$/.test(w)) ?? n

function MiniStat({ to, icon, label, value, sub, warn }: { to: string; icon: any; label: string; value: any; sub?: any; warn?: boolean }) {
  return (
    <Link to={to} className={`card p-4 flex items-center gap-4 hover:border-brand-500/40 transition ${warn ? 'border-amber-500/40' : ''}`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${warn ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-700 text-zinc-300'}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-zinc-400">{label}</div>
        <div className="num text-xl font-extrabold">{value}</div>
        {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
      </div>
    </Link>
  )
}
