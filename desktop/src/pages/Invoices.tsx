import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Printer, FileDown, ArrowLeftRight, Pencil, Ban, HandCoins, Truck, Plus, Download, Undo2 } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, SearchBox, Tabs, Money, Badge, Empty, Loading, Modal, Field, useConfirm, Segmented, NoAccess } from '../components/ui'
import { printDoc, InvoiceDoc } from '../components/Print'
import { STATUS, PAY, date, dateTime, sdg, num, qty, usd, daysAgo, today, downloadCSV, METHOD } from '../lib/format'
import type { Row } from '../lib/backend'
import { AdminDelete } from '../components/AdminDelete'

type TabKey = 'all' | 'final' | 'proforma' | 'cancelled'

export default function Invoices() {
  const { db, can } = useApp()
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState<TabKey>((sp.get('tab') as TabKey) || 'all')
  const [term, setTerm] = useState('')
  const [from, setFrom] = useState(daysAgo(60))
  const [to, setTo] = useState(today())
  const [openId, setOpenId] = useState<string | null>(sp.get('open'))

  const { data, loading } = useLoad(() => {
    const eq: Row = {}
    if (tab === 'final') { eq.kind = 'final'; eq.status = 'posted' }
    if (tab === 'proforma') { eq.kind = 'proforma'; eq.status = 'open' }
    if (tab === 'cancelled') eq.status = 'cancelled'
    return db.list('v_invoices', {
      eq, gte: { invoice_date: from }, lte: { invoice_date: to },
      search: term ? { cols: ['number', 'customer_name', 'customer_phone'], term } : undefined,
      order: [{ col: 'created_at', asc: false }], limit: 500,
    })
  }, [tab, term, from, to], ['invoices', 'payments'])

  useEffect(() => { if (sp.get('open')) { setOpenId(sp.get('open')); sp.delete('open'); setSp(sp, { replace: true }) } }, [sp, setSp])

  if (!can('sales')) return <NoAccess />
  const rows = data ?? []
  const total = rows.filter((r: any) => r.status !== 'cancelled').reduce((s: number, r: any) => s + Number(r.total_sdg), 0)

  return (
    <>
      <PageHeader title="الفواتير" icon={<FileText size={22} />}
        actions={<>
          <button className="btn-ghost" onClick={() => downloadCSV('الفواتير', rows, [
            { key: 'number', label: 'الرقم' }, { key: 'invoice_date', label: 'التاريخ' }, { key: 'customer_name', label: 'العميل' },
            { key: 'total_sdg', label: 'الإجمالي' }, { key: 'paid_sdg', label: 'المدفوع' }, { key: 'remaining_sdg', label: 'المتبقي' },
            { key: 'salesperson_name', label: 'البائع' }, { key: 'status', label: 'الحالة' }])}><Download size={17} /> CSV</button>
          {can('sales', 'create') && <Link to="/sales" className="btn-primary"><Plus size={18} /> فاتورة جديدة</Link>}
        </>} />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'all', label: 'الكل' }, { key: 'final', label: 'نهائية' }, { key: 'proforma', label: 'مبدئية مفتوحة' },
          { key: 'cancelled', label: 'ملغية' }]} />
        <SearchBox value={term} onChange={setTerm} placeholder="رقم الفاتورة أو العميل أو الهاتف" className="w-80" />
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          من <input type="date" className="input h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          إلى <input type="date" className="input h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="mr-auto text-sm text-zinc-400">{rows.length} فاتورة · <Money v={total} className="text-zinc-100 font-bold" /></div>
      </div>

      <div className="card overflow-hidden">
        {loading ? <Loading /> : !rows.length ? <Empty /> : (
          <div className="max-h-[calc(100vh-290px)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>الرقم</th><th>التاريخ</th><th>العميل</th><th>البائع</th><th>الأصناف</th><th>الإجمالي</th><th>المدفوع</th><th>الحالة</th><th>الدفع</th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <td className="num font-semibold" dir="ltr">{r.number}</td>
                    <td className="text-zinc-400">{date(r.invoice_date)}</td>
                    <td>{r.customer_name ?? <span className="text-zinc-500">عميل نقدي</span>}</td>
                    <td className="text-zinc-400">{r.salesperson_name}</td>
                    <td className="num">{r.items_count}</td>
                    <td><Money v={r.total_sdg} className="font-bold" /></td>
                    <td><Money v={r.paid_sdg} cur={false} className="text-zinc-400" /></td>
                    <td><Badge cls={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></td>
                    <td>{r.kind === 'final' && r.status === 'posted' && <Badge cls={PAY[r.payment_type].cls}>{PAY[r.payment_type].label}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
    </>
  )
}

export function InvoiceDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { db, can, settings, rate } = useApp()
  const nav = useNavigate()
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const [convert, setConvert] = useState(false)
  const [collect, setCollect] = useState(false)
  const [giveBack, setGiveBack] = useState(false)
  const { data, reload } = useLoad(async () => {
    const [inv, items, pays, permits, returns] = await Promise.all([
      db.get('v_invoices', id),
      db.list('invoice_items', { eq: { invoice_id: id }, order: [{ col: 'sort' }] }),
      can('accounting') || can('sales') ? db.list('v_payments', { eq: { invoice_id: id }, order: [{ col: 'created_at' }] }).catch(() => []) : Promise.resolve([]),
      can('delivery') ? db.list('v_delivery_permits', { eq: { invoice_id: id }, order: [{ col: 'created_at' }] }).catch(() => []) : Promise.resolve([]),
      db.list('v_sales_returns', { eq: { invoice_id: id }, order: [{ col: 'created_at' }] }).catch(() => []),
    ])
    return { inv, items, pays, permits, returns }
  }, [id], ['invoices', 'payments', 'delivery_permits', 'sales_returns'])

  const inv = data?.inv
  const returned = Number(inv?.returned_sdg ?? 0)
  const canReturn = inv?.kind === 'final' && inv?.status === 'posted' && can('sales', 'cancel')
    && (data?.items ?? []).some((i: any) => Number(i.qty) > Number(i.returned_qty ?? 0))
  const print = (pdf = false) => inv && printDoc(<InvoiceDoc inv={inv} items={data!.items} settings={settings} />, pdf ? { pdf: inv.number, bare: true } : {})

  const cancel = async () => {
    const reason = await confirm.ask(`إلغاء الفاتورة ${inv!.number}؟`, { danger: true, reason: true, text: inv!.kind === 'final' ? 'ستعود البضاعة إلى المخزن، وإن كانت هناك مبالغ مدفوعة فستُسجَّل مردودًا للعميل.' : undefined })
    if (reason) await run(() => db.rpc('cancel_invoice', { p_id: id, p_reason: reason }), 'أُلغيت الفاتورة')
    reload()
  }
  const delivery = async () => {
    const r = await run(() => db.rpc<Row>('create_delivery_permit', { p_invoice: id }), 'أُنشئ إذن التسليم وأُرسل إلى المخزن')
    if (r) reload()
  }

  return (
    <Modal open onClose={onClose} width="max-w-4xl"
      title={inv ? <span className="flex items-center gap-3"><span dir="ltr" className="num">{inv.number}</span><Badge cls={STATUS[inv.status].cls}>{STATUS[inv.status].label}</Badge>
        {inv.kind === 'final' && inv.status === 'posted' && <Badge cls={PAY[inv.payment_type].cls}>{PAY[inv.payment_type].label}</Badge>}</span> : '...'}
      subtitle={inv ? `${dateTime(inv.created_at)} · البائع: ${inv.salesperson_name ?? ''}${inv.created_by_name !== inv.salesperson_name ? ` · سجّلها: ${inv.created_by_name}` : ''}` : ''}
      footer={inv && <>
        {can('sales', 'print') && <button className="btn-ghost" onClick={() => print()}><Printer size={17} /> طباعة</button>}
        {can('sales', 'print') && (window as any).wali && <button className="btn-ghost" onClick={() => print(true)}><FileDown size={17} /> PDF</button>}
        <div className="flex-1" />
        <AdminDelete table="invoices" id={inv.id} label={`الفاتورة ${inv.number}`} onDone={onClose} />
        {inv.status !== 'cancelled' && inv.status !== 'converted' && !returned && can('sales', 'cancel') && <button className="btn-danger" onClick={cancel}><Ban size={17} /> إلغاء</button>}
        {canReturn && <button className="btn-ghost" onClick={() => setGiveBack(true)}><Undo2 size={17} /> مرتجع</button>}
        {inv.kind === 'proforma' && inv.status === 'open' && can('sales', 'edit') && <button className="btn-ghost" onClick={() => nav(`/sales/${inv.id}`)}><Pencil size={17} /> تعديل</button>}
        {inv.kind === 'final' && inv.status === 'posted' && Number(inv.undelivered_qty) > 0 && can('delivery', 'create') && <button className="btn-ghost" disabled={busy} onClick={delivery}><Truck size={17} /> إذن تسليم</button>}
        {inv.kind === 'final' && inv.status === 'posted' && Number(inv.remaining_sdg) > 0 && can('accounting', 'create') && <button className="btn-primary" onClick={() => setCollect(true)}><HandCoins size={17} /> تحصيل</button>}
        {inv.kind === 'proforma' && inv.status === 'open' && can('sales', 'create') && <button className="btn-primary" onClick={() => setConvert(true)}><ArrowLeftRight size={17} /> تحويل إلى نهائية</button>}
      </>}>
      {!data || !inv ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-3">
            <Info label="العميل" value={inv.customer_name ?? 'عميل نقدي'} sub={inv.customer_phone} />
            <Info label="سعر الصرف" value={<span className="num">{num(inv.rate, 2)}</span>} sub="ج.س للدولار" />
            <Info label="الإجمالي" value={<Money v={Number(inv.total_sdg) - returned} />}
              sub={[Number(inv.discount_sdg) ? `بعد خصم ${sdg(inv.discount_sdg)}` : '', returned ? `مرتجع ${sdg(returned)}` : ''].filter(Boolean).join(' · ') || undefined} />
            {inv.kind === 'final' ? <Info label="المتبقي" value={<Money v={inv.remaining_sdg} className={Number(inv.remaining_sdg) > 0 ? 'text-red-300' : 'text-emerald-300'} />} sub={`المدفوع ${sdg(inv.paid_sdg)}`} />
              : <Info label="بالأسعار الحالية" value={rate ? <span className="num text-brand-300">{sdg(data.items.reduce((s: number, i: any) => s + Number(i.unit_price_usd) * rate * Number(i.qty), 0) - Number(inv.discount_sdg))}</span> : '—'} sub="إذا حُوِّلت اليوم" />}
          </div>
          {inv.cancel_reason && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">سبب الإلغاء: {inv.cancel_reason}</div>}
          {inv.source_proforma_id && <button onClick={() => onOpen(inv.source_proforma_id)} className="text-sm text-brand-400">← الفاتورة المبدئية الأصلية</button>}
          {inv.converted_invoice_id && <button onClick={() => onOpen(inv.converted_invoice_id)} className="text-sm text-brand-400">← الفاتورة النهائية</button>}

          <div className="rounded-xl border border-ink-700 overflow-hidden">
            <table className="tbl">
              <thead><tr><th>الكود</th><th>الصنف</th><th>الموديل</th><th>الكمية</th><th>السعر $</th><th>السعر ج.س</th><th>الإجمالي</th>{inv.kind === 'final' && <th>المُسلَّم</th>}{returned > 0 && <th>المرتجع</th>}</tr></thead>
              <tbody>{data.items.map((i: any) => {
                const net = Number(i.qty) - Number(i.returned_qty ?? 0)
                return (
                  <tr key={i.id}>
                    <td className="num text-zinc-400">{i.code}</td><td className="font-semibold">{i.name}</td><td className="text-zinc-400" dir="ltr">{i.model}</td>
                    <td className="num">{qty(i.qty)}</td><td className="num text-zinc-400">{usd(i.unit_price_usd)}</td>
                    <td><Money v={i.unit_price_sdg} cur={false} /></td><td><Money v={i.total_sdg} className="font-bold" /></td>
                    {inv.kind === 'final' && <td className={`num ${Number(i.delivered_qty) >= net ? 'text-emerald-300' : 'text-amber-300'}`}>{qty(i.delivered_qty)} / {qty(net)}</td>}
                    {returned > 0 && <td className="num text-red-300">{Number(i.returned_qty) ? qty(i.returned_qty) : ''}</td>}
                  </tr>
                )
              })}</tbody>
            </table>
          </div>

          {(data.pays.length > 0 || data.permits.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {data.pays.length > 0 && <div>
                <div className="font-bold text-sm mb-2">المدفوعات</div>
                {data.pays.map((p: any) => (
                  <div key={p.id} className="flex justify-between text-sm py-2 border-b border-ink-700">
                    <span className="text-zinc-400">{date(p.pay_date)} · {METHOD[p.method]} {p.direction === 'out' && <Badge cls="bg-red-500/15 text-red-300">مرتجع</Badge>}</span>
                    <Money v={p.amount_sdg} className={p.direction === 'out' ? 'text-red-300' : ''} />
                  </div>
                ))}
              </div>}
              {data.permits.length > 0 && <div>
                <div className="font-bold text-sm mb-2">أذونات التسليم</div>
                {data.permits.map((p: any) => (
                  <div key={p.id} className="flex justify-between text-sm py-2 border-b border-ink-700">
                    <span className="num" dir="ltr">{p.number}</span><Badge cls={STATUS[p.status].cls}>{STATUS[p.status].label}</Badge>
                  </div>
                ))}
              </div>}
            </div>
          )}
          {data.returns.length > 0 && <div>
            <div className="font-bold text-sm mb-2">المرتجعات</div>
            {data.returns.map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 text-sm py-2 border-b border-ink-700">
                <span className="num" dir="ltr">{r.number}</span>
                <span className="text-zinc-400">{date(r.return_date)} · {qty(r.total_qty)} قطعة · {r.reason}</span>
                {Number(r.refund_sdg) > 0 && <Badge cls="bg-red-500/15 text-red-300">المردود {sdg(r.refund_sdg)}</Badge>}
                <Money v={r.total_sdg} className="mr-auto text-red-300" />
              </div>
            ))}
          </div>}
          {inv.notes && <div className="text-sm text-zinc-400">ملاحظات: {inv.notes}</div>}
        </div>
      )}
      {confirm.node}
      {inv && data && <ReturnModal open={giveBack} inv={inv} items={data.items} onClose={() => setGiveBack(false)} onDone={() => { setGiveBack(false); reload() }} />}
      {inv && <ConvertModal open={convert} inv={inv} onClose={() => setConvert(false)} onDone={(fid) => { setConvert(false); onOpen(fid) }} />}
      {inv && <CollectModal open={collect} inv={inv} onClose={() => setCollect(false)} onDone={() => { setCollect(false); reload() }} />}
    </Modal>
  )
}

function Info({ label, value, sub }: { label: string; value: any; sub?: any }) {
  return (
    <div className="rounded-xl bg-ink-900 border border-ink-700 p-3">
      <div className="text-[12px] text-zinc-500">{label}</div>
      <div className="font-bold mt-1 truncate">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5 num">{sub}</div>}
    </div>
  )
}

function ConvertModal({ open, inv, onClose, onDone }: { open: boolean; inv: Row; onClose: () => void; onDone: (id: string) => void }) {
  const { db, can } = useApp()
  const { busy, run } = useAction()
  const [mode, setMode] = useState<'full' | 'partial' | 'credit'>('full')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState('cash')
  const [keep, setKeep] = useState(false)
  const go = async () => {
    const r = await run(() => db.rpc<Row>('convert_proforma', {
      p_id: inv.id, p_paid: mode === 'full' ? 999999999999 : mode === 'credit' ? 0 : Number(paid) || 0, p_method: method, p_keep_sdg: keep,
    }), 'حُوِّلت إلى فاتورة نهائية وخُصمت الكميات من المخزن')
    if (r) onDone(r.id)
  }
  return (
    <Modal open={open} onClose={onClose} width="max-w-md" title="تحويل إلى فاتورة نهائية" subtitle="ستُخصم الكميات من المخزن ويُسجَّل البيع">
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} items={[{ key: 'full', label: 'نقدًا بالكامل' }, { key: 'partial', label: 'دفع جزئي' }, { key: 'credit', label: 'آجل' }]} />
        {mode === 'partial' && <Field label="المبلغ المدفوع"><input className="input num" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        {mode !== 'credit' && <Field label="طريقة الدفع"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">نقدًا</option><option value="bank">بنك</option><option value="transfer">تحويل</option><option value="cheque">شيك</option></select></Field>}
        {can('sales', 'approve') && (
          <label className="flex items-start gap-3 p-3 rounded-xl border border-ink-600 cursor-pointer">
            <input type="checkbox" className="mt-1 accent-orange-500" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span className="text-sm"><b>تثبيت أسعار الفاتورة المبدئية بالجنيه</b><br /><span className="text-zinc-400">دون التثبيت، يُحسب السعر وفق سعر صرف اليوم.</span></span>
          </label>
        )}
        <button className="btn-primary w-full" disabled={busy} onClick={go}>تأكيد التحويل</button>
      </div>
    </Modal>
  )
}

// مرتجع جزئي: تختار الكمية الراجعة من كل صنف
function ReturnModal({ open, inv, items, onClose, onDone }: { open: boolean; inv: Row; items: Row[]; onClose: () => void; onDone: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [q, setQ] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) { setQ({}); setReason('') } }, [open])
  const left = (i: Row) => Number(i.qty) - Number(i.returned_qty ?? 0)
  const discRatio = Number(inv.subtotal_sdg) > 0 ? Number(inv.discount_sdg) / Number(inv.subtotal_sdg) : 0
  const value = items.reduce((s, i) => s + Number(i.unit_price_sdg) * (Number(q[i.id]) || 0), 0) * (1 - discRatio)
  const remainingAfter = Number(inv.total_sdg) - Number(inv.returned_sdg ?? 0) - value
  const refund = Math.max(0, Number(inv.paid_sdg) - remainingAfter)
  const go = async () => {
    const p_items = items.filter((i) => Number(q[i.id]) > 0).map((i) => ({ invoice_item_id: i.id, qty: Number(q[i.id]) }))
    const r = await run(() => db.rpc('create_sales_return', { p_invoice: inv.id, p_items: p_items, p_reason: reason }), 'سُجِّل المرتجع وعادت البضاعة إلى المخزن')
    if (r) onDone()
  }
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title={`مرتجع من ${inv.number}`} subtitle="أدخل الكمية المرتجعة من كل صنف، وستعود البضاعة إلى المخزن">
      <div className="space-y-4">
        <div className="rounded-xl border border-ink-700 overflow-hidden">
          <table className="tbl">
            <thead><tr><th>الصنف</th><th>المباع</th><th>أُرجع سابقًا</th><th>السعر</th><th className="w-32">الكمية المرتجعة</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}>
                <td className="font-semibold">{i.name} <span className="num text-zinc-500 text-xs">{i.code}</span></td>
                <td className="num">{qty(i.qty)}</td>
                <td className="num text-zinc-400">{Number(i.returned_qty) ? qty(i.returned_qty) : '—'}</td>
                <td><Money v={i.unit_price_sdg} cur={false} /></td>
                <td>{left(i) > 0
                  ? <input className="input h-9 num" placeholder={`حتى ${qty(left(i))}`} value={q[i.id] ?? ''}
                      onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setQ({ ...q, [i.id]: Number(v) > left(i) ? String(left(i)) : v }) }} />
                  : <span className="text-zinc-500 text-sm">إرجاع الكل</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Field label="سبب المرتجع"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلًا: عيب في الصنف" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-ink-900 border border-ink-700 p-3"><div className="text-[12px] text-zinc-500">قيمة المرتجع</div><Money v={value} className="font-bold text-red-300" /></div>
          <div className="rounded-xl bg-ink-900 border border-ink-700 p-3"><div className="text-[12px] text-zinc-500">سيُرد للعميل نقدًا</div><Money v={refund} className="font-bold" /></div>
        </div>
        {Number(inv.discount_sdg) > 0 && <div className="text-xs text-zinc-500">القيمة محسوبة بعد نصيب الأصناف من خصم الفاتورة.</div>}
        <button className="btn-primary w-full" disabled={busy || value <= 0 || !reason.trim()} onClick={go}>تأكيد المرتجع</button>
      </div>
    </Modal>
  )
}

export function CollectModal({ open, inv, onClose, onDone }: { open: boolean; inv: Row; onClose: () => void; onDone: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [amt, setAmt] = useState('')
  const [method, setMethod] = useState('cash')
  useEffect(() => { if (open) setAmt(String(Math.round(Number(inv.remaining_sdg)))) }, [open, inv])
  const go = async () => {
    const r = await run(() => db.rpc('record_payment', { p: { direction: 'in', party_type: 'customer', invoice_id: inv.id, amount_sdg: Number(amt), method, notes: `تحصيل من فاتورة ${inv.number}` } }), 'سُجِّل التحصيل')
    if (r) onDone()
  }
  return (
    <Modal open={open} onClose={onClose} width="max-w-md" title={`تحصيل — ${inv.number}`} subtitle={`المتبقي ${sdg(inv.remaining_sdg)} ج.س`}>
      <div className="space-y-4">
        <Field label="المبلغ"><input className="input num text-lg" autoFocus value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="طريقة الدفع"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">نقدًا</option><option value="bank">بنك</option><option value="transfer">تحويل</option><option value="cheque">شيك</option></select></Field>
        <button className="btn-primary w-full" disabled={busy || !(Number(amt) > 0)} onClick={go}>تسجيل</button>
      </div>
    </Modal>
  )
}
