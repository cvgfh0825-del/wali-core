import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShoppingBag, Plus, Trash2, Ship, Landmark, Calculator, HandCoins, Ban } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, SearchBox, Money, Empty, Loading, Modal, Field, Badge, NoAccess, useConfirm } from '../components/ui'
import { date, usd, num, qty, sdg, dateTime } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Purchases() {
  const { db, can } = useApp()
  const [sp, setSp] = useSearchParams()
  const [term, setTerm] = useState('')
  const [creating, setCreating] = useState(sp.get('new') === '1')
  const [open, setOpen] = useState<Row | null>(null)
  const { data, loading } = useLoad(() => db.list('v_purchases', {
    search: term ? { cols: ['number', 'supplier_name', 'notes'], term } : undefined, order: [{ col: 'created_at', asc: false }],
  }), [term], ['purchases', 'payments'])

  useEffect(() => { if (sp.get('new')) { sp.delete('new'); setSp(sp, { replace: true }) } }, [sp, setSp])
  if (!can('purchases')) return <NoAccess />

  return (
    <>
      <PageHeader title="المشتريات" icon={<ShoppingBag size={22} />}
        actions={can('purchases', 'create') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={18} /> فاتورة مشتريات</button>} />
      <SearchBox value={term} onChange={setTerm} placeholder="رقم الفاتورة أو المورد" className="w-96 mb-4" />
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !data?.length ? <Empty text="سجّل أول شحنة بضاعة" /> : (
          <table className="tbl">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>المورد</th><th>البضاعة $</th><th>سعر الصرف</th><th>شحن + جمارك + رسوم</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
            <tbody>{data.map((r: any) => (
              <tr key={r.id} className={`cursor-pointer ${r.status === 'cancelled' ? 'opacity-50' : ''}`} onClick={() => setOpen(r)}>
                <td className="num font-semibold" dir="ltr">{r.number}</td><td className="text-zinc-400">{date(r.purchase_date)}</td><td>{r.supplier_name ?? '—'}</td>
                <td className="num">{usd(r.goods_usd)}</td><td className="num text-zinc-400">{num(r.rate, 2)}</td>
                <td><Money v={Number(r.shipping_sdg) + Number(r.customs_sdg) + Number(r.other_sdg)} cur={false} className="text-zinc-400" /></td>
                <td><Money v={r.total_sdg} className="font-bold" /></td><td><Money v={r.paid_sdg} cur={false} /></td>
                <td>{r.status === 'cancelled' ? <Badge cls="bg-red-500/15 text-red-300">ملغية</Badge> : Number(r.remaining_sdg) > 0 ? <Money v={r.remaining_sdg} className="text-red-300" /> : <Badge cls="bg-emerald-500/15 text-emerald-300">مسدَّد</Badge>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && <NewPurchase onClose={() => setCreating(false)} />}
      {open && <PurchaseView p={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function NewPurchase({ onClose }: { onClose: () => void }) {
  const { db, rate } = useApp()
  const { busy, run } = useAction()
  const suppliers = useLoad(() => db.list('suppliers', { order: [{ col: 'name' }] }), [])
  const [term, setTerm] = useState('')
  const found = useLoad(() => term.trim() ? db.list('v_products', { search: { cols: ['name', 'code', 'model'], term }, limit: 8 }) : Promise.resolve([]), [term])
  const [f, setF] = useState<Row>({ supplier_id: '', rate: rate ? String(rate) : '', shipping_sdg: '', customs_sdg: '', other_sdg: '', paid_sdg: '', notes: '' })
  const [items, setItems] = useState<{ p: Row; qty: string; price: string }[]>([])
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }))
  const n = (v: any) => Number(String(v).replace(/,/g, '')) || 0

  const goods = items.reduce((s, i) => s + n(i.qty) * n(i.price), 0)
  const extrasSdg = n(f.shipping_sdg) + n(f.customs_sdg) + n(f.other_sdg)
  const factor = goods > 0 && n(f.rate) > 0 ? extrasSdg / n(f.rate) / goods : 0
  const totalSdg = goods * n(f.rate) + extrasSdg

  const preview = useMemo(() => items.map((i) => {
    const landed = n(i.price) * (1 + factor)
    const oldQ = Math.max(0, Number(i.p.qty_on_hand))
    const avg = (oldQ * Number(i.p.cost_usd) + n(i.qty) * landed) / Math.max(1, oldQ + n(i.qty))
    const newPrice = i.p.auto_price ? avg * (1 + Number(i.p.margin_pct) / 100) : Number(i.p.price_usd)
    return { landed, avg, newPrice }
  }), [items, factor])

  const save = async () => {
    const r = await run(() => db.rpc('save_purchase', { p: {
      supplier_id: f.supplier_id || null, rate: n(f.rate), shipping_sdg: n(f.shipping_sdg), customs_sdg: n(f.customs_sdg), other_sdg: n(f.other_sdg),
      paid_sdg: n(f.paid_sdg), notes: f.notes || null, items: items.map((i) => ({ product_id: i.p.id, qty: n(i.qty), unit_price_usd: n(i.price) })),
    } }), 'سُجِّلت المشتريات وحُدِّث المخزون والأسعار')
    if (r) onClose()
  }

  return (
    <Modal open onClose={onClose} width="max-w-6xl" title="فاتورة مشتريات جديدة" subtitle="تُوزَّع تكاليف الشحن والجمارك والرسوم على الأصناف بحسب قيمتها"
      footer={<>
        <div className="ml-auto flex items-center gap-6 text-sm">
          <span className="text-zinc-400">البضاعة <b className="num text-zinc-100">{usd(goods)}</b></span>
          <span className="text-zinc-400">المصاريف <b className="num text-zinc-100">{sdg(extrasSdg)}</b> <span className="num text-brand-300">(+{num(factor * 100, 1)}%)</span></span>
          <span className="text-zinc-400">الإجمالي <Money v={totalSdg} className="font-black text-brand-300 text-lg" /></span>
        </div>
        <button className="btn-ghost" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" disabled={busy || !items.length || !(n(f.rate) > 0) || items.some((i) => !(n(i.qty) > 0))} onClick={save}>حفظ وتنزيل للمخزن</button>
      </>}>
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Field label="المورد"><select className="input" value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
          <option value="">—</option>{(suppliers.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="سعر الدولار (سعر الصرف)"><input className="input num" value={f.rate} onChange={(e) => set('rate', e.target.value)} /></Field>
        <Field label="المدفوع للمورد (ج.س)"><input className="input num" value={f.paid_sdg} onChange={(e) => set('paid_sdg', e.target.value)} placeholder="0" /></Field>
        <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="رقم الحاوية / البوليصة" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5 p-4 rounded-2xl bg-ink-900/60 border border-ink-700">
        <Field label={<span className="flex items-center gap-1.5"><Ship size={14} /> الشحن (ج.س)</span>}><input className="input num" value={f.shipping_sdg} onChange={(e) => set('shipping_sdg', e.target.value)} placeholder="0" /></Field>
        <Field label={<span className="flex items-center gap-1.5"><Landmark size={14} /> الجمارك (ج.س)</span>}><input className="input num" value={f.customs_sdg} onChange={(e) => set('customs_sdg', e.target.value)} placeholder="0" /></Field>
        <Field label={<span className="flex items-center gap-1.5"><Calculator size={14} /> رسوم إضافية (ج.س)</span>}><input className="input num" value={f.other_sdg} onChange={(e) => set('other_sdg', e.target.value)} placeholder="0" /></Field>
      </div>

      <div className="relative mb-3">
        <SearchBox value={term} onChange={setTerm} placeholder="ابحث عن الصنف بالاسم أو الكود وأضفه" />
        {!!found.data?.length && term && (
          <div className="absolute z-20 inset-x-0 top-12 card border-ink-600 p-1 max-h-72 overflow-auto">
            {found.data.map((p: any) => (
              <button key={p.id} className="w-full text-right px-3 py-2 rounded-lg hover:bg-ink-700 flex justify-between text-sm"
                onClick={() => { if (!items.find((i) => i.p.id === p.id)) setItems([...items, { p, qty: '1', price: String(Number(p.cost_usd) || '') }]); setTerm('') }}>
                <span><span className="num text-zinc-500 ml-2">{p.code}</span>{p.name}</span><span className="text-zinc-500 num">في المخزن {qty(p.qty_on_hand)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!items.length ? <Empty title="أضف الأصناف التي وصلت" /> : (
        <div className="rounded-xl border border-ink-700 overflow-hidden">
          <table className="tbl">
            <thead><tr><th>الصنف</th><th className="w-28">الكمية</th><th className="w-32">سعر الشراء $</th><th>الإجمالي $</th><th>التكلفة بعد المصاريف</th><th>متوسط التكلفة الجديد</th><th>سعر البيع الجديد</th><th></th></tr></thead>
            <tbody>{items.map((i, k) => (
              <tr key={i.p.id}>
                <td><div className="font-semibold">{i.p.name}</div><div className="text-[11px] text-zinc-500 num">{i.p.code} · ربح {num(i.p.margin_pct)}%</div></td>
                <td><input className="input h-9 num" value={i.qty} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, qty: e.target.value } : x))} /></td>
                <td><input className="input h-9 num" value={i.price} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, price: e.target.value } : x))} /></td>
                <td className="num">{usd(n(i.qty) * n(i.price))}</td>
                <td className="num text-brand-300">{usd(preview[k].landed)}</td>
                <td className="num">{usd(preview[k].avg)}</td>
                <td className="num font-bold text-emerald-300">{usd(preview[k].newPrice)} <span className="text-[11px] text-zinc-500">≈ {sdg(preview[k].newPrice * (rate ?? n(f.rate)))}</span></td>
                <td><button className="p-1.5 text-zinc-500 hover:text-red-300" onClick={() => setItems(items.filter((_, j) => j !== k))}><Trash2 size={15} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function PurchaseView({ p, onClose }: { p: Row; onClose: () => void }) {
  const { db, can } = useApp()
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const [amt, setAmt] = useState('')
  const { data, reload } = useLoad(async () => {
    const [items, prods, pays] = await Promise.all([
      db.list('purchase_items', { eq: { purchase_id: p.id } }),
      db.list('products', { select: 'id,name,code' }),
      can('accounting') ? db.list('v_payments', { eq: { purchase_id: p.id } }) : Promise.resolve([]),
    ])
    const pm = Object.fromEntries(prods.map((x: any) => [x.id, x]))
    return { items: items.map((i: any) => ({ ...i, ...pm[i.product_id], id: i.id })), pays }
  }, [p.id], ['payments'])
  const fresh = useLoad(() => db.get('v_purchases', p.id), [p.id], ['payments', 'purchases'])
  const cur = fresh.data ?? p
  const cancel = async () => {
    const reason = await confirm.ask(`إلغاء فاتورة المشتريات ${p.number}؟`, {
      danger: true, reason: true,
      text: 'ستخرج البضاعة من المخزن وتعود التكلفة كما كانت، وإن دُفع للمورد شيء فسيُسجَّل استردادًا. لا يمكن الإلغاء إذا بيع منها شيء.',
    })
    if (reason && await run(() => db.rpc('cancel_purchase', { p_id: p.id, p_reason: reason }), 'أُلغيت فاتورة المشتريات')) fresh.reload()
  }
  return (
    <Modal open onClose={onClose} width="max-w-4xl"
      title={<span className="flex items-center gap-3"><span className="num" dir="ltr">{p.number}</span>{cur.status === 'cancelled' && <Badge cls="bg-red-500/15 text-red-300">ملغية</Badge>}</span>}
      subtitle={`${p.supplier_name ?? ''} · ${dateTime(p.created_at)} · بواسطة ${p.created_by_name ?? ''}`}
      footer={cur.status === 'posted' && can('purchases', 'cancel') ? <button className="btn-danger" disabled={busy} onClick={cancel}><Ban size={17} /> إلغاء الفاتورة</button> : undefined}>
      {cur.cancel_reason && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">سبب الإلغاء: {cur.cancel_reason}</div>}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[['البضاعة', usd(cur.goods_usd)], ['سعر الصرف', num(cur.rate, 2)], ['الشحن', sdg(cur.shipping_sdg)], ['الجمارك + رسوم', sdg(Number(cur.customs_sdg) + Number(cur.other_sdg))]].map(([a, b]) => (
          <div key={a} className="rounded-xl bg-ink-900 border border-ink-700 p-3"><div className="text-[12px] text-zinc-500">{a}</div><div className="num font-bold mt-1">{b}</div></div>
        ))}
      </div>
      <table className="tbl mb-4">
        <thead><tr><th>الكود</th><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th>التكلفة النهائية للوحدة</th></tr></thead>
        <tbody>{(data?.items ?? []).map((i: any) => (
          <tr key={i.id}><td className="num">{i.code}</td><td>{i.name}</td><td className="num">{qty(i.qty)}</td><td className="num">{usd(i.unit_price_usd)}</td><td className="num text-brand-300">{usd(i.landed_usd)}</td></tr>
        ))}</tbody>
      </table>
      <div className="flex items-center justify-between rounded-xl bg-ink-900 border border-ink-700 p-4">
        <div className="text-sm">الإجمالي <Money v={cur.total_sdg} className="font-bold" /> · المدفوع <Money v={cur.paid_sdg} /> · <span className="text-red-300">متبقي <Money v={cur.remaining_sdg} /></span></div>
        {cur.status === 'posted' && Number(cur.remaining_sdg) > 0 && can('accounting', 'create') && (
          <div className="flex gap-2">
            <input className="input h-10 w-40 num" placeholder="مبلغ" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
            <button className="btn-primary h-10" disabled={busy || !(Number(amt) > 0)} onClick={async () => {
              await run(() => db.rpc('record_payment', { p: { direction: 'out', party_type: 'supplier', purchase_id: p.id, amount_sdg: Number(amt), notes: `دفعة للمورد عن ${p.number}` } }), 'سُجِّل الدفع للمورد')
              setAmt(''); reload(); fresh.reload()
            }}><HandCoins size={16} /> دفع</button>
          </div>
        )}
      </div>
      {confirm.node}
    </Modal>
  )
}
