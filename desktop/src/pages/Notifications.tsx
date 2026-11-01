import { useState } from 'react'
import { Bell, CheckCheck, FileText, Package, DollarSign, Users, Wallet, Clock, ShieldAlert, Truck, PieChart } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Tabs, Empty, Loading, NoAccess } from '../components/ui'
import { InvoiceDrawer } from './Invoices'
import { ago, dateTime } from '../lib/format'

const ICON: Record<string, any> = {
  invoices: FileText, products: Package, stock_movements: Package, exchange_rates: DollarSign, payments: Wallet, expenses: Wallet,
  attendance: Clock, employees: Users, profiles: ShieldAlert, delivery_permits: Truck, shareholders: PieChart, shareholder_terms: PieChart,
  shareholder_payouts: PieChart, payrolls: Wallet, salary_advances: Wallet, salary_deductions: Wallet,
}
const LEVEL: Record<string, string> = {
  info: 'bg-brand-500/15 text-brand-300', success: 'bg-emerald-500/15 text-emerald-300', warning: 'bg-amber-500/15 text-amber-300', danger: 'bg-red-500/15 text-red-300',
}
const GROUPS: Record<string, string[]> = {
  sales: ['invoices', 'payments'], stock: ['products', 'stock_movements', 'delivery_permits', 'purchases'],
  people: ['attendance', 'employees', 'salary_advances', 'salary_deductions', 'payrolls', 'shareholders', 'shareholder_terms', 'shareholder_payouts', 'profiles'],
}

export default function Notifications() {
  const { db, isAdmin } = useApp()
  const [tab, setTab] = useState<'all' | 'unread' | 'sales' | 'stock' | 'people'>('all')
  const [inv, setInv] = useState<string | null>(null)
  const { run } = useAction()
  const { data, loading } = useLoad(() => db.list('notifications', {
    isNull: tab === 'unread' ? ['read_at'] : [], in: GROUPS[tab] ? { entity_type: GROUPS[tab] } : {},
    order: [{ col: 'created_at', asc: false }], limit: 300,
  }), [tab], ['notifications'])
  if (!isAdmin) return <NoAccess />
  const rows = data ?? []
  const unread = rows.filter((n: any) => !n.read_at)

  const markAll = () => run(async () => { for (const n of unread) await db.update('notifications', n.id, { read_at: new Date().toISOString() }) }, 'اتعلّم الكل كمقروء')
  const open = async (n: any) => {
    if (!n.read_at) await db.update('notifications', n.id, { read_at: new Date().toISOString() })
    if (n.entity_type === 'invoices' && n.entity_id) setInv(n.entity_id)
  }

  // تجميع حسب اليوم
  const groups: Record<string, any[]> = {}
  for (const n of rows) {
    const d = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Khartoum', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(n.created_at))
    ;(groups[d] ??= []).push(n)
  }

  return (
    <>
      <PageHeader title="الإشعارات" subtitle="كل اللي بيحصل في السيستم — بيوصلك برضه على الموبايل" icon={<Bell size={22} />}
        actions={unread.length > 0 && <button className="btn-ghost" onClick={markAll}><CheckCheck size={17} /> علّم الكل كمقروء</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'all', label: 'الكل' }, { key: 'unread', label: 'غير مقروء' }, { key: 'sales', label: 'المبيعات والفلوس' }, { key: 'stock', label: 'المخزن' }, { key: 'people', label: 'الموظفين والشركاء' }]} />
      <div className="mt-5 max-w-4xl">
        {loading ? <Loading /> : !rows.length ? <div className="card"><Empty title="مفيش إشعارات" /></div> : Object.entries(groups).map(([day, list]) => (
          <div key={day} className="mb-6">
            <div className="text-[13px] font-bold text-zinc-500 mb-2">{day}</div>
            <div className="card divide-y divide-ink-700/70 overflow-hidden">
              {list.map((n: any) => {
                const Icon = ICON[n.entity_type] ?? Bell
                return (
                  <button key={n.id} onClick={() => open(n)} className={`w-full text-right flex items-start gap-4 px-5 py-4 transition hover:bg-ink-800 ${!n.read_at ? 'bg-brand-500/[.04]' : ''}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${LEVEL[n.level]}`}><Icon size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14px] ${!n.read_at ? 'font-bold' : 'font-medium text-zinc-300'}`}>{n.title}</div>
                      {n.body && <div className="text-[13px] text-zinc-400 mt-0.5">{n.body}</div>}
                      <div className="text-[11px] text-zinc-500 mt-1">{n.actor_name} · <span title={dateTime(n.created_at)}>{ago(n.created_at)}</span></div>
                    </div>
                    {!n.read_at && <span className="w-2.5 h-2.5 rounded-full bg-brand-500 mt-2 animate-ring" />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {inv && <InvoiceDrawer id={inv} onClose={() => setInv(null)} onOpen={setInv} />}
    </>
  )
}
