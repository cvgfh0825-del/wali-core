import { DollarSign } from 'lucide-react'
import { useApp, useLoad } from '../lib/app'
import { PageHeader, Loading, Empty, NoAccess, Stat } from '../components/ui'
import { AreaChart } from '../components/charts'
import { date, time, num } from '../lib/format'

export default function Rates() {
  const { db, can, rate } = useApp()
  const { data, loading } = useLoad(() => db.list('v_exchange_rates', { order: [{ col: 'created_at', asc: false }], limit: 180 }), [], ['exchange_rates'])
  if (!can('rates')) return <NoAccess />
  const rows = data ?? []
  // آخر ريت لكل يوم
  const daily = Object.values(rows.reduce((m: any, r: any) => { if (!m[r.rate_date]) m[r.rate_date] = r; return m }, {})) as any[]
  const first = daily[daily.length - 1]
  const change = first && rate ? ((rate - Number(first.rate)) / Number(first.rate)) * 100 : 0
  return (
    <>
      <PageHeader title="سعر الدولار" subtitle="سجل الريت اليومي — كل فاتورة بتحفظ الريت بتاع يومها" icon={<DollarSign size={22} />} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Stat accent label="ريت النهارده" value={rate ? num(rate, 2) : '—'} sub="جنيه سوداني للدولار" icon={<DollarSign size={20} />} />
        <Stat label="التغيّر من أول السجل" value={`${change >= 0 ? '+' : ''}${num(change, 1)}%`} tone={change > 0 ? 'red' : 'green'} sub={first ? `من ${date(first.rate_date)}` : ''} />
        <Stat label="أيام متسجلة" value={daily.length} />
      </div>
      <div className="card p-6 mb-5">
        <div className="font-bold mb-4">حركة الريت</div>
        {daily.length > 1 ? <AreaChart data={daily.map((d) => ({ label: d.rate_date.slice(5).split('-').reverse().join('/'), value: Number(d.rate) }))} /> : <Empty />}
      </div>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : (
          <table className="tbl">
            <thead><tr><th>اليوم</th><th>الوقت</th><th>الريت</th><th>كتبه</th><th>ملاحظة</th></tr></thead>
            <tbody>{rows.slice(0, 60).map((r: any) => (
              <tr key={r.id}><td>{date(r.rate_date)}</td><td className="text-zinc-400">{time(r.created_at)}</td><td className="num font-bold text-brand-300">{num(r.rate, 2)}</td><td className="text-zinc-400">{r.created_by_name}</td><td className="text-zinc-500">{r.note}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  )
}
