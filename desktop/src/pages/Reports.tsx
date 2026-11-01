import { useState } from 'react'
import { BarChart3, Printer, TrendingUp, Coins, Receipt, Package, PieChart } from 'lucide-react'
import { useApp, useLoad } from '../lib/app'
import { PageHeader, Money, Loading, Stat, Empty, Tabs, NoAccess } from '../components/ui'
import { MonthBars, BarList } from '../components/charts'
import { printDoc, TableDoc } from '../components/Print'
import { short, sdg, num, monthName, daysAgo, today, qty, downloadCSV } from '../lib/format'

export default function Reports() {
  const { db, can, settings } = useApp()
  const [tab, setTab] = useState<'annual' | 'sales' | 'stock'>('annual')
  const thisYear = Number(today().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const rep = useLoad(() => db.rpc<any>('annual_report', { p_year: year }), [year], ['invoices', 'expenses'])
  const sales = useLoad(() => tab === 'sales' ? db.list('v_invoices', { eq: { kind: 'final', status: 'posted' }, gte: { invoice_date: from }, lte: { invoice_date: to } }) : Promise.resolve([]), [tab, from, to])
  const items = useLoad(() => tab === 'sales' ? db.list('invoice_items', { in: { invoice_id: (sales.data ?? []).map((i: any) => i.id) } }) : Promise.resolve([]), [tab, sales.data])
  const stock = useLoad(() => tab === 'stock' ? db.list('v_products', { eq: { is_active: true }, order: [{ col: 'category_name' }, { col: 'code' }] }) : Promise.resolve([]), [tab])

  if (!can('reports')) return <NoAccess />
  const r = rep.data

  const printAnnual = () => r && printDoc(<TableDoc title={`تقرير الأرباح السنوية ${year}`} settings={settings}
    summary={<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14, fontSize: 12 }}>
      {[['المبيعات', r.sales], ['تكلفة البضاعة', r.cogs], ['المصروفات', r.expenses], ['صافي الربح', r.net_profit]].map(([a, b]) => (
        <div key={a as string} style={{ background: '#f4f4f4', borderRadius: 8, padding: 10 }}><div style={{ color: '#666' }}>{a}</div><div style={{ fontWeight: 900, fontSize: 16 }}>{sdg(b)}</div></div>))}
    </div>}
    rows={r.shareholders} cols={[{ key: 'name', label: 'المساهم' }, { key: 'profit_pct', label: 'النسبة %', fmt: (v) => num(v, 2) },
      { key: 'profit_share', label: 'نصيبه من الربح', fmt: sdg }, { key: 'received', label: 'استلم خلال السنة', fmt: sdg }, { key: 'remaining', label: 'الباقي له', fmt: sdg }]} />)

  // تحليل المبيعات حسب الموظف والصنف
  const bySeller = Object.values((sales.data ?? []).reduce((m: any, i: any) => { const k = i.salesperson_name ?? '—'; m[k] = m[k] ?? { label: k, value: 0, n: 0 }; m[k].value += Number(i.total_sdg); m[k].n++; return m }, {})) as any[]
  const byItem = Object.values((items.data ?? []).reduce((m: any, i: any) => { m[i.code] = m[i.code] ?? { label: i.name, sub: '', value: 0, q: 0 }; m[i.code].value += Number(i.total_sdg); m[i.code].q += Number(i.qty); return m }, {})) as any[]
  const salesTotal = (sales.data ?? []).reduce((s: number, i: any) => s + Number(i.total_sdg), 0)
  const salesCost = (sales.data ?? []).reduce((s: number, i: any) => s + Number(i.cost_sdg), 0)

  return (
    <>
      <PageHeader title="التقارير والأرباح" icon={<BarChart3 size={22} />} actions={tab === 'annual' && r && <button className="btn-ghost" onClick={printAnnual}><Printer size={17} /> طباعة</button>} />
      <div className="flex items-center gap-3 mb-5">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'annual', label: 'الأرباح السنوية' }, { key: 'sales', label: 'تحليل المبيعات' }, { key: 'stock', label: 'قيمة المخزون' }]} />
        {tab === 'annual' && <select className="input h-10 w-32" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y}>{y}</option>)}</select>}
        {tab === 'sales' && <><input type="date" className="input h-10 w-44" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input h-10 w-44" value={to} onChange={(e) => setTo(e.target.value)} /></>}
      </div>

      {tab === 'annual' && (rep.loading || !r ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <Stat label="المبيعات" value={short(r.sales)} sub={`خصومات ${short(r.discounts)}${r.returns ? ` · مرتجعات ${short(r.returns)}` : ''}`} icon={<TrendingUp size={20} />} />
            <Stat label="مجمل الربح" value={short(r.gross_profit)} sub={`بعد تكلفة البضاعة ${short(r.cogs)}`} icon={<Coins size={20} />} tone="green" />
            <Stat label="المصروفات" value={short(r.expenses)} sub="شاملة المرتبات والمساهمات الاجتماعية" icon={<Receipt size={20} />} tone="red" />
            <Stat accent label={`صافي ربح ${year}`} value={short(r.net_profit)} sub={`هامش ${r.sales ? num((r.net_profit / r.sales) * 100, 1) : 0}%`} icon={<PieChart size={20} />} />
          </div>
          <div className="grid grid-cols-[1fr_360px] gap-5">
            <div className="card p-6">
              <div className="font-bold mb-4">شهر بشهر</div>
              <MonthBars data={(r.months ?? []).map((m: any) => ({ label: monthName(m.month).split(' ')[0], sales: Number(m.sales), cost: Number(m.cogs) + Number(m.expenses), profit: Number(m.sales) - Number(m.cogs) - Number(m.expenses) }))} />
            </div>
            <div className="card p-6">
              <div className="font-bold mb-4">المصروفات حسب البند</div>
              {r.expense_categories?.length ? <BarList items={r.expense_categories.map((c: any) => ({ label: c.name, value: Number(c.total) }))} /> : <Empty />}
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-ink-700 flex items-center justify-between">
              <div><div className="font-bold">نصيب المساهمين من أرباح {year}</div><div className="text-[13px] text-zinc-500">النصيب = صافي الربح × نسبته — وبيتخصم منه اللي استلمه شهرياً</div></div>
              <div className="text-sm">اتصرف للمساهمين خلال السنة: <Money v={r.shareholder_paid} className="font-bold" /></div>
            </div>
            {!r.shareholders?.length ? <Empty /> : (
              <table className="tbl">
                <thead><tr><th>المساهم</th><th>نسبته من الأرباح</th><th>نصيبه</th><th>استلم (مرتب + نسبة مبيعات)</th><th>الباقي له / عليه</th></tr></thead>
                <tbody>{r.shareholders.map((s: any) => (
                  <tr key={s.id}><td className="font-semibold">{s.name}</td><td className="num">{num(s.profit_pct, 2)}%</td><td><Money v={s.profit_share} className="font-bold" /></td>
                    <td><Money v={s.received} /></td><td><Money v={s.remaining} className={`font-black ${s.remaining >= 0 ? 'text-emerald-300' : 'text-red-300'}`} /></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      ))}

      {tab === 'sales' && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <Stat accent label="المبيعات" value={short(salesTotal)} sub={`${sales.data?.length ?? 0} فاتورة`} />
            <Stat label="تكلفة البضاعة" value={short(salesCost)} />
            <Stat label="مجمل الربح" value={short(salesTotal - salesCost)} tone="green" sub={`هامش ${salesTotal ? num(((salesTotal - salesCost) / salesTotal) * 100, 1) : 0}%`} />
            <Stat label="متوسط الفاتورة" value={short(salesTotal / Math.max(1, sales.data?.length ?? 0))} />
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div className="card p-6"><div className="font-bold mb-4">حسب الموظف</div>{bySeller.length ? <BarList items={bySeller.sort((a, b) => b.value - a.value).map((s) => ({ ...s, sub: `${s.n} فاتورة` }))} /> : <Empty />}</div>
            <div className="card p-6"><div className="font-bold mb-4">حسب الصنف</div>{byItem.length ? <BarList items={byItem.sort((a, b) => b.value - a.value).slice(0, 12).map((s) => ({ ...s, sub: `${qty(s.q)} قطعة` }))} /> : <Empty />}</div>
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-700 flex items-center justify-between">
            <div className="font-bold flex items-center gap-2"><Package size={18} className="text-brand-500" /> قيمة المخزون بالتكلفة وبسعر البيع</div>
            <button className="btn-ghost btn-sm" onClick={() => downloadCSV('قيمة المخزون', stock.data ?? [], [{ key: 'code', label: 'الكود' }, { key: 'name', label: 'الصنف' }, { key: 'qty_on_hand', label: 'الكمية' }, { key: 'cost_usd', label: 'التكلفة $' }, { key: 'price_sdg', label: 'السعر ج.س' }])}>CSV</button>
          </div>
          {stock.loading ? <Loading /> : (() => {
            const groups = Object.values((stock.data ?? []).reduce((m: any, p: any) => { const k = p.category_name ?? 'بدون قسم'; m[k] = m[k] ?? { name: k, q: 0, cost: 0, sale: 0 }; m[k].q += Number(p.qty_on_hand); m[k].cost += Number(p.qty_on_hand) * Number(p.cost_usd); m[k].sale += Number(p.qty_on_hand) * Number(p.price_sdg); return m }, {})) as any[]
            const rate = (stock.data?.[0] && Number(stock.data[0].price_usd)) ? Number(stock.data[0].price_sdg) / Number(stock.data[0].price_usd) : 0
            return (
              <table className="tbl">
                <thead><tr><th>القسم</th><th>القطع</th><th>التكلفة $</th><th>التكلفة ج.س</th><th>بسعر البيع ج.س</th><th>الربح المتوقع</th></tr></thead>
                <tbody>{groups.map((g) => (
                  <tr key={g.name}><td className="font-semibold">{g.name}</td><td className="num">{qty(g.q)}</td><td className="num">${num(g.cost)}</td><td><Money v={g.cost * rate} cur={false} /></td><td><Money v={g.sale} cur={false} /></td><td className="text-emerald-300"><Money v={g.sale - g.cost * rate} cur={false} /></td></tr>
                ))}
                  <tr className="bg-ink-800 font-black"><td>الإجمالي</td><td className="num">{qty(groups.reduce((s, g) => s + g.q, 0))}</td><td className="num">${num(groups.reduce((s, g) => s + g.cost, 0))}</td>
                    <td><Money v={groups.reduce((s, g) => s + g.cost, 0) * rate} /></td><td><Money v={groups.reduce((s, g) => s + g.sale, 0)} /></td><td className="text-emerald-300"><Money v={groups.reduce((s, g) => s + g.sale - g.cost * rate, 0)} /></td></tr>
                </tbody>
              </table>
            )
          })()}
        </div>
      )}
    </>
  )
}
