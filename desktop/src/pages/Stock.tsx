import { useState } from 'react'
import { Warehouse, ClipboardCheck, ArrowDownLeft, ArrowUpRight, Printer } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, SearchBox, Badge, Empty, Loading, Modal, Field, Tabs, NoAccess } from '../components/ui'
import { printDoc, TableDoc } from '../components/Print'
import { dateTime, qty, usd, daysAgo, today } from '../lib/format'
import type { Row } from '../lib/backend'

const KIND: Record<string, { label: string; cls: string }> = {
  purchase_in: { label: 'مشتريات', cls: 'bg-emerald-500/15 text-emerald-300' },
  sale_out: { label: 'بيع', cls: 'bg-brand-500/15 text-brand-300' },
  cancel_in: { label: 'إلغاء بيع', cls: 'bg-sky-500/15 text-sky-300' },
  adjust_in: { label: 'تسوية +', cls: 'bg-violet-500/15 text-violet-300' },
  adjust_out: { label: 'تسوية −', cls: 'bg-red-500/15 text-red-300' },
  opening: { label: 'رصيد افتتاحي', cls: 'bg-zinc-500/15 text-zinc-300' },
  return_in: { label: 'مرتجع بيع', cls: 'bg-amber-500/15 text-amber-300' },
  purchase_cancel: { label: 'إلغاء مشتريات', cls: 'bg-red-500/15 text-red-300' },
}

export default function Stock() {
  const { db, can, settings } = useApp()
  const [tab, setTab] = useState<'moves' | 'count'>('moves')
  const [term, setTerm] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [adjust, setAdjust] = useState<Row | null>(null)

  const moves = useLoad(() => db.list('v_stock_movements', {
    gte: { created_at: from }, lte: { created_at: to + 'T23:59:59' },
    search: term ? { cols: ['product_name', 'code', 'ref_number', 'note'], term } : undefined,
    order: [{ col: 'created_at', asc: false }], limit: 400,
  }), [term, from, to], ['products'])
  const products = useLoad(() => db.list('v_products', {
    eq: { is_active: true }, search: term ? { cols: ['name', 'code', 'barcode', 'model'], term } : undefined, order: [{ col: 'code' }],
  }), [term], ['products'])

  if (!can('stock')) return <NoAccess />

  const printCount = () => printDoc(<TableDoc title="كشف جرد المخزن" settings={settings} rows={products.data ?? []} cols={[
    { key: 'code', label: 'الكود' }, { key: 'name', label: 'الصنف' }, { key: 'model', label: 'الموديل' },
    { key: 'qty_on_hand', label: 'رصيد النظام', fmt: qty }, { key: 'x', label: 'الجرد الفعلي', fmt: () => '' }, { key: 'y', label: 'الفرق', fmt: () => '' }]} />)

  return (
    <>
      <PageHeader title="حركة المخزن والجرد" icon={<Warehouse size={22} />}
        actions={tab === 'count' && can('stock', 'print') && <button className="btn-ghost" onClick={printCount}><Printer size={17} /> طباعة كشف جرد</button>} />
      <div className="flex items-center gap-3 mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'moves', label: 'سجل الحركات' }, { key: 'count', label: 'الجرد والتسوية' }]} />
        <SearchBox value={term} onChange={setTerm} placeholder="صنف أو كود أو رقم مستند" className="w-80" />
        {tab === 'moves' && <div className="flex items-center gap-2 text-sm text-zinc-400">
          من <input type="date" className="input h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          إلى <input type="date" className="input h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>}
      </div>

      <div className="card overflow-hidden">
        {tab === 'moves' ? (moves.loading ? <Loading /> : !moves.data?.length ? <Empty /> : (
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>الوقت</th><th>النوع</th><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>المستند</th><th>بواسطة</th><th>ملاحظة</th></tr></thead>
              <tbody>{moves.data.map((m: any) => (
                <tr key={m.id}>
                  <td className="text-zinc-400 text-[13px]">{dateTime(m.created_at)}</td>
                  <td><Badge cls={KIND[m.kind].cls}>{KIND[m.kind].label}</Badge></td>
                  <td><span className="num text-zinc-500 ml-2">{m.code}</span>{m.product_name}</td>
                  <td className={`num font-bold ${Number(m.qty) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    <span className="inline-flex items-center gap-1">{Number(m.qty) > 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{qty(Math.abs(m.qty))}</span></td>
                  <td className="num text-zinc-400">{m.unit_cost_usd ? usd(m.unit_cost_usd) : '—'}</td>
                  <td className="num" dir="ltr">{m.ref_number ?? '—'}</td>
                  <td className="text-zinc-400">{m.created_by_name}</td>
                  <td className="text-zinc-500 text-[13px]">{m.note}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )) : (products.loading ? <Loading /> : (
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>الكود</th><th>الصنف</th><th>الموديل</th><th>رصيد النظام</th><th>محجوز</th><th>أقل كمية</th><th></th></tr></thead>
              <tbody>{(products.data ?? []).map((p: any) => (
                <tr key={p.id}>
                  <td className="num">{p.code}</td><td className="font-semibold">{p.name}</td><td className="text-zinc-400" dir="ltr">{p.model}</td>
                  <td className="num font-bold">{qty(p.qty_on_hand)}</td><td className="num text-amber-300">{Number(p.reserved_qty) ? qty(p.reserved_qty) : '—'}</td>
                  <td className="num text-zinc-500">{qty(p.min_qty)}</td>
                  <td>{can('stock', 'edit') && <button className="btn-ghost btn-sm" onClick={() => setAdjust(p)}><ClipboardCheck size={15} /> تسوية</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ))}
      </div>
      {adjust && <AdjustModal p={adjust} onClose={() => setAdjust(null)} />}
    </>
  )
}

function AdjustModal({ p, onClose }: { p: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [v, setV] = useState(String(Number(p.qty_on_hand)))
  const [note, setNote] = useState('')
  const diff = Number(v) - Number(p.qty_on_hand)
  return (
    <Modal open onClose={onClose} width="max-w-md" title={`تسوية جرد: ${p.name}`} subtitle="أدخل الكمية الفعلية التي جُردت في المخزن">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="رصيد النظام"><input className="input num" disabled value={qty(p.qty_on_hand)} /></Field>
          <Field label="الكمية الفعلية"><input className="input num" autoFocus value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        </div>
        {diff !== 0 && <div className={`rounded-xl px-4 py-3 text-sm ${diff > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>الفرق: <b className="num">{diff > 0 ? '+' : ''}{qty(diff)}</b> — سيُرسل إشعار إلى مدير النظام</div>}
        <Field label="السبب"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="جرد شهري / كسر / ..." /></Field>
        <button className="btn-primary w-full" disabled={busy || diff === 0 || !note.trim()} onClick={async () => {
          if (await run(() => db.rpc('adjust_stock', { p_product: p.id, p_new_qty: Number(v), p_note: note }), 'سُجِّلت التسوية') !== undefined) onClose()
        }}>حفظ التسوية</button>
      </div>
    </Modal>
  )
}
