import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, FileClock, CheckCircle2, Printer, X, AlertTriangle, Search, Plus } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { Field, Modal, Segmented, NoAccess } from '../components/ui'
import { printDoc, InvoiceDoc, tafqeet } from '../components/Print'
import { qty, sdg } from '../lib/format'
import type { Row, Backend } from '../lib/backend'
import invoiceHead from '../assets/invoice-head.jpg'

// شاشة الفاتورة على شكل فاتورة والي بلازا المطبوعة: كل سطر فيه بحث منسدل للأصناف
type Line = { key: number; product?: Row; qty: number; price_sdg?: number }
let seq = 0
const blank = (): Line => ({ key: ++seq, qty: 1 })
// قيم الفاتورة المطبوعة؛ آخر قيم اتكتبت بتتحفظ على الجهاز وتطلع تلقائي في الفاتورة الجاية
const FIELD_DEFAULTS = { company_tax_id: '300000599652', okash: '2055534', bank_khartoum: '' }
type Fields = typeof FIELD_DEFAULTS
const loadFields = (): Fields => { try { return { ...FIELD_DEFAULTS, ...JSON.parse(localStorage.getItem('wali-invoice-fields') || '{}') } } catch { return FIELD_DEFAULTS } }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum' }).format(new Date())

export default function SalesPOS() {
  const { db, can, rate, settings, toast } = useApp()
  const { id } = useParams()
  const nav = useNavigate()
  const [lines, setLines] = useState<Line[]>([blank()])
  const [customer, setCustomer] = useState<{ id?: string; name: string; phone: string }>({ name: '', phone: '' })
  const [fields, setFields] = useState<Fields>(loadFields)
  const [invDate, setInvDate] = useState(today())
  const setField = (k: keyof Fields, v: string) => setFields((f) => ({ ...f, [k]: v }))
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')
  const [payMode, setPayMode] = useState<'full' | 'partial' | 'credit'>('full')
  const [method, setMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState<Row | null>(null)
  const { busy, run } = useAction()
  const canPrice = can('sales', 'approve')
  const customers = useLoad(() => db.list('customers', { order: [{ col: 'name' }] }), [], ['customers'])

  // تعديل فاتورة مبدئية موجودة
  useEffect(() => {
    if (!id) return
    ;(async () => {
      const inv = await db.get('invoices', id)
      if (!inv || inv.kind !== 'proforma' || inv.status !== 'open') { toast('لا يمكن تعديل هذه الفاتورة', 'err'); nav('/invoices'); return }
      const items = await db.list('invoice_items', { eq: { invoice_id: id }, order: [{ col: 'sort' }] })
      const prods = await db.list('v_products', { in: { id: items.map((i: any) => i.product_id) } })
      const ls = items.map((i: any) => ({ key: ++seq, product: prods.find((p: any) => p.id === i.product_id)!, qty: Number(i.qty) })).filter((l: Line) => l.product)
      setLines([...ls, blank()])
      setCustomer({ id: inv.customer_id ?? undefined, name: inv.customer_name ?? '', phone: inv.customer_phone ?? '' })
      if (inv.print_fields) setFields({ ...FIELD_DEFAULTS, ...inv.print_fields })
      if (inv.invoice_date) setInvDate(String(inv.invoice_date).slice(0, 10))
      setDiscount(Number(inv.discount_sdg) ? String(inv.discount_sdg) : '')
      setNotes(inv.notes ?? '')
    })()
  }, [id, db, nav, toast])

  const filled = lines.filter((l) => l.product)
  const priceOf = (l: Line) => l.price_sdg ?? Math.round(Number(l.product?.price_usd ?? 0) * (rate ?? 0) * 100) / 100
  const subtotal = filled.reduce((s, l) => s + priceOf(l) * l.qty, 0)
  const total = Math.max(0, subtotal - (Number(discount) || 0))
  const paidVal = payMode === 'full' ? total : payMode === 'credit' ? 0 : Math.min(Number(paid) || 0, total)

  const patch = (key: number, p: Partial<Line>) => setLines((ls) => {
    const next = ls.map((l) => (l.key === key ? { ...l, ...p } : l))
    // دايمًا فيه سطر فاضي في الآخر للصنف الجاي
    return next[next.length - 1].product ? [...next, blank()] : next
  })
  const removeLine = (key: number) => setLines((ls) => { const n = ls.filter((l) => l.key !== key); return n.length && !n[n.length - 1].product ? n : [...n, blank()] })

  const save = async (kind: 'proforma' | 'final') => {
    const inv = await run(() => db.rpc<Row>('save_invoice', { p: {
      id: id ?? null, kind,
      customer_id: customer.id ?? null, customer_name: customer.name || null, customer_phone: customer.phone || null,       print_fields: fields, invoice_date: invDate || null,
      discount_sdg: Number(discount) || 0, paid_sdg: kind === 'final' ? paidVal : 0, method, notes: notes || null,
      items: filled.map((l) => ({ product_id: l.product!.id, qty: l.qty, ...(l.price_sdg != null && canPrice ? { unit_price_sdg: l.price_sdg } : {}) })),
    } }))
    if (inv) {
      try { localStorage.setItem('wali-invoice-fields', JSON.stringify(fields)) } catch { /* */ }
      setDone(inv)
      setLines([blank()]); setCustomer({ name: '', phone: '' }); setInvDate(today()); setDiscount(''); setPaid(''); setNotes(''); setPayMode('full')
      if (id) nav('/sales', { replace: true })
    }
  }

  const printDone = async () => {
    if (!done) return
    const [inv, items] = await Promise.all([db.get('v_invoices', done.id), db.list('invoice_items', { eq: { invoice_id: done.id }, order: [{ col: 'sort' }] })])
    printDoc(<InvoiceDoc inv={inv!} items={items} settings={settings} />)
  }

  const custMatches = useMemo(() => {
    const t = customer.name.trim()
    if (!t || customer.id) return []
    return (customers.data ?? []).filter((c: any) => c.name.includes(t) || (c.phone ?? '').includes(t)).slice(0, 6)
  }, [customer, customers.data])

  if (!can('sales', 'create')) return <NoAccess />

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[1fr_300px] gap-4 items-start">
      {/* الفاتورة نفسها */}
      <div className="bg-white text-[#111] rounded-2xl shadow-2xl overflow-visible max-w-[980px] w-full mx-auto">
        <img src={invoiceHead} className="w-full rounded-t-2xl select-none" draggable={false} />
        <div className="px-8 pb-6">
          {!rate && <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-amber-700 bg-amber-100 rounded-lg px-3 py-2"><AlertTriangle size={15} /> أدخل سعر صرف اليوم أولًا</div>}
          {id && <div className="mb-3 text-[13px] font-bold text-brand-600">تعديل فاتورة مبدئية</div>}

          {/* الرقم الضريبي للشركة */}
          <div className="flex items-end">
            <div className="text-center">
              <div className="font-black text-[15px] mb-1.5">الرقم التعريفي الضريبي</div>
              <TaxBoxes value={fields.company_tax_id} onChange={(v) => setField('company_tax_id', v)} />
            </div>
          </div>

          {/* التاريخ والعميل */}
          <div className="flex justify-between items-end gap-8 mt-6">
            <div className="flex items-end gap-2 shrink-0">
              <span className="font-black text-[16px]">التاريخ :</span>
              <input type="date" className="num font-bold bg-transparent border-b-2 border-dotted border-zinc-400 focus:border-brand-500 outline-none px-2 pb-0.5 min-w-[160px] text-center [color-scheme:light]"
                value={invDate} onChange={(e) => setInvDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2 flex-1 max-w-[460px] relative">
              <span className="font-black text-[16px] shrink-0">السيد /</span>
              <input className="flex-1 bg-transparent border-b-2 border-dotted border-zinc-400 focus:border-brand-500 outline-none px-1 pb-0.5 font-bold text-[15px] placeholder:text-zinc-400 placeholder:font-normal"
                placeholder="اسم العميل (اختياري للنقدي)" value={customer.name} onChange={(e) => setCustomer({ name: e.target.value, phone: customer.phone })} />
              <input className="w-32 bg-transparent border-b-2 border-dotted border-zinc-400 focus:border-brand-500 outline-none px-1 pb-0.5 num text-[14px] placeholder:text-zinc-400 disabled:text-zinc-500" dir="ltr"
                placeholder="الهاتف" value={customer.phone} disabled={!!customer.id} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
              {customer.id && <button onClick={() => setCustomer({ name: '', phone: '' })} title="عميل آخر" className="p-1 text-zinc-400 hover:text-red-600"><X size={15} /></button>}
              {custMatches.length > 0 && (
                <div className="absolute z-30 top-full mt-1 right-14 left-0 bg-white rounded-xl shadow-xl border border-zinc-200 p-1">
                  {custMatches.map((c: any) => (
                    <button key={c.id} onClick={() => setCustomer({ id: c.id, name: c.name, phone: c.phone ?? '' })} className="w-full text-right px-3 py-2 rounded-lg hover:bg-orange-50 flex justify-between text-sm">
                      <span className="font-semibold">{c.name}</span><span className="num text-zinc-500">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* الجدول */}
          <div className="mt-6 border-2 border-zinc-300 rounded-2xl p-1.5">
            <div className="grid grid-cols-[minmax(220px,1fr)_72px_112px_92px_124px_32px] gap-1.5 text-center">
              <Head dark title="البيـــان" en="Description" />
              <Head dark title="الكمية" en="Qty" />
              <Head dark title="سعر الوحدة" en="Unit Price" />
              <Head dark title="القيمة المضافة" en="17 % VAT" white />
              <Head title="الإجمالية" en="Total" />
              <div />
            </div>
            <div className="mt-1.5 space-y-0">
              {lines.map((l, i) => {
                const over = !!l.product && l.qty > Number(l.product.qty_on_hand)
                return (
                  <div key={l.key} className={`grid grid-cols-[minmax(220px,1fr)_72px_112px_92px_124px_32px] gap-1.5 ${i % 2 ? 'bg-zinc-100' : 'bg-white'} ${over ? 'ring-2 ring-amber-400 ring-inset rounded-lg' : ''}`}>
                    <ProductPicker db={db} value={l.product} disabled={!rate} onPick={(p) => patch(l.key, { product: p, price_sdg: undefined })} />
                    <input className="cell num text-center" value={l.product ? l.qty : ''} disabled={!l.product}
                      onChange={(e) => patch(l.key, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
                    {canPrice && l.product ? (
                      <input className="cell num text-center" value={l.price_sdg ?? priceOf(l)} title="سعر الوحدة بالجنيه (صلاحية اعتماد)"
                        onChange={(e) => patch(l.key, { price_sdg: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
                    ) : <div className="cell num text-center">{l.product ? sdg(priceOf(l)) : ''}</div>}
                    <div className="cell" />
                    <div className="cell num text-center font-black">{l.product ? sdg(priceOf(l) * l.qty) : ''}</div>
                    <div className="flex items-center justify-center">
                      {l.product && <button onClick={() => removeLine(l.key)} title="حذف السطر" className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>}
                    </div>
                    {over && <div className="col-span-6 text-[11px] text-amber-700 px-3 pb-1 flex items-center gap-1"><AlertTriangle size={12} /> المتبقي في المخزن {qty(l.product!.qty_on_hand)} فقط — يمكن حفظها مبدئية، أما النهائية فستُرفض</div>}
                  </div>
                )
              })}
            </div>
            {/* الإجماليات في نفس الجدول */}
            <div className="mt-1.5 border-t-2 border-zinc-200 pt-1.5 space-y-1">
              <SumRow label="الإجمالي" value={sdg(subtotal)} />
              <div className="grid grid-cols-[1fr_124px_32px] gap-1.5 items-center">
                <div className="text-left font-bold text-[14px] pl-3">الخصم</div>
                <input className="cell num text-center bg-white border border-zinc-300 rounded-lg" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} />
                <div />
              </div>
              <SumRow label="الصافي" value={sdg(total)} strong />
            </div>
          </div>

          {/* الحسابات والمبلغ كتابة */}
          <div className="grid grid-cols-2 border-2 border-zinc-300 rounded-2xl mt-4 overflow-hidden">
            <div className="px-5 py-3 font-black text-[15px] border-l-4 border-brand-500 flex items-center gap-4">حساب اوكاش
              <input className="flex-1 min-w-0 bg-transparent border-b-2 border-dotted border-zinc-300 focus:border-brand-500 outline-none num text-[18px] font-black" dir="ltr" value={fields.okash} onChange={(e) => setField('okash', e.target.value)} /></div>
            <div className="px-5 py-3 font-black text-[15px] flex items-center gap-3">حساب بنك الخرطوم
              <input className="flex-1 min-w-0 bg-transparent border-b-2 border-zinc-400 focus:border-brand-500 outline-none num text-[16px] font-bold" dir="ltr" value={fields.bank_khartoum} onChange={(e) => setField('bank_khartoum', e.target.value)} /></div>
          </div>
          <div className="flex border-2 border-zinc-300 rounded-2xl mt-3 overflow-hidden min-h-[52px]">
            <div className="bg-brand-500 text-white font-black text-[18px] px-6 flex items-center shrink-0">الجملة كتابة</div>
            <div className="px-4 flex items-center font-bold text-[14px] leading-6">{total > 0 ? `فقط ${tafqeet(total)} جنيه سوداني لا غير` : ''}</div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <span className="font-black text-[15px] shrink-0">ملاحظات :</span>
            <input className="flex-1 bg-transparent border-b-2 border-dotted border-zinc-400 focus:border-brand-500 outline-none px-1 pb-0.5 text-[14px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      {/* الدفع والحفظ */}
      <div className="card p-4 space-y-3 2xl:sticky 2xl:top-0 max-w-[980px] w-full mx-auto">
        <div className="font-bold">الدفع</div>
        <Segmented value={payMode} onChange={setPayMode} items={[{ key: 'full', label: 'نقدًا بالكامل' }, { key: 'partial', label: 'دفع جزئي' }, { key: 'credit', label: 'آجل' }]} />
        {payMode === 'partial' && <Field label="المبلغ المدفوع"><input className="input h-10 num" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
        {payMode !== 'credit' && (
          <Field label="طريقة الدفع"><select className="input h-10" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">نقدًا</option><option value="bank">بنك</option><option value="transfer">تحويل بنكي / بنكك</option><option value="cheque">شيك</option>
          </select></Field>
        )}
        <div className="rounded-xl bg-ink-950 border border-ink-700 p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-zinc-400"><span>{filled.length} صنف · {filled.reduce((s, l) => s + l.qty, 0)} قطعة</span></div>
          <div className="flex justify-between items-end"><span className="font-bold">الصافي</span><span className="num text-[26px] font-black text-brand-400 leading-none">{sdg(total)} <span className="text-sm text-zinc-500 font-sans">ج.س</span></span></div>
          {payMode !== 'full' && <div className="flex justify-between text-[13px] text-red-300"><span>المتبقي على العميل</span><span className="num">{sdg(total - paidVal)}</span></div>}
        </div>
        <button className="btn-primary h-12 w-full" disabled={busy || !filled.length || !rate || !!id} onClick={() => save('final')}><CheckCircle2 size={18} /> فاتورة نهائية</button>
        <button className="btn-ghost h-12 w-full" disabled={busy || !filled.length || !rate} onClick={() => save('proforma')}><FileClock size={18} /> {id ? 'حفظ التعديل' : 'فاتورة مبدئية'}</button>
      </div>

      <Modal open={!!done} onClose={() => setDone(null)} width="max-w-md" title="">
        {done && (
          <div className="text-center -mt-4">
            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${done.kind === 'final' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
              {done.kind === 'final' ? <CheckCircle2 size={40} /> : <FileClock size={40} />}
            </div>
            <div className="font-display text-2xl font-black mt-4">{done.kind === 'final' ? 'سُجِّلت الفاتورة' : 'سُجِّلت الفاتورة المبدئية'}</div>
            <div className="num text-zinc-400 mt-1" dir="ltr">{done.number}</div>
            <div className="num text-3xl font-black text-brand-400 mt-3">{sdg(done.total_sdg)} <span className="text-sm text-zinc-500 font-sans">ج.س</span></div>
            {done.kind === 'proforma' && <p className="text-[13px] text-zinc-400 mt-3">أُرسل إشعار بهذه الفاتورة إلى مدير النظام.</p>}
            <div className="flex gap-2 mt-6">
              <button className="btn-primary flex-1" onClick={printDone}><Printer size={18} /> طباعة</button>
              <button className="btn-ghost flex-1" onClick={() => setDone(null)}><Plus size={18} /> فاتورة جديدة</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Head({ title, en, dark, white }: { title: string; en: string; dark?: boolean; white?: boolean }) {
  return (
    <div className={`rounded-xl py-2 leading-tight ${dark ? 'bg-[#1c1c1e]' : 'bg-brand-500'}`}>
      <div className="font-black text-[14px] text-white">{title}</div>
      <div className={`font-bold text-[12px] ${dark && !white ? 'text-brand-500' : 'text-white'}`} dir="ltr">{en}</div>
    </div>
  )
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_124px_32px] gap-1.5 items-center">
      <div className={`text-left pl-3 ${strong ? 'font-black text-[15px]' : 'font-bold text-[14px]'}`}>{label}</div>
      <div className={`num text-center rounded-lg py-1.5 ${strong ? 'bg-[#1c1c1e] text-white font-black text-[16px]' : 'font-black text-[14px]'}`}>{value}</div>
      <div />
    </div>
  )
}

// خانات الرقم الضريبي (12 خانة زي الفاتورة) — من غير onChange تبقى للعرض بس
function TaxBoxes({ value, onChange }: { value: string; onChange?: (v: string) => void }) {
  const chars = value.split('')
  return (
    <label className={`relative flex border-2 border-zinc-700 rounded-sm ${onChange ? 'cursor-text focus-within:border-brand-500' : ''}`} dir="ltr">
      {Array.from({ length: 12 }).map((_, i) => (
        <span key={i} className={`w-7 h-8 flex items-center justify-center num text-[18px] font-bold ${i ? 'border-l border-zinc-500' : ''}`}>{chars[i] ?? ''}</span>
      ))}
      {onChange && <input className="absolute inset-0 opacity-0" inputMode="numeric" maxLength={12} value={value} title="الرقم الضريبي للعميل"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))} />}
    </label>
  )
}

// خانة البيان: بحث منسدل في الأصناف بالاسم أو الكود أو الباركود أو الموديل
function ProductPicker({ db, value, onPick, disabled }: { db: Backend; value?: Row; onPick: (p: Row) => void; disabled?: boolean }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [list, setList] = useState<Row[]>([])
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      db.list('v_products', {
        eq: { is_active: true },
        search: term.trim() ? { cols: ['name', 'code', 'barcode', 'model'], term: term.trim() } : undefined,
        order: [{ col: 'code' }], limit: 30,
      }).then((r) => { setList(r); setHi(0) }).catch(() => setList([]))
    }, 150)
    return () => clearTimeout(t)
  }, [db, term, open])

  const pick = (p: Row) => { onPick(p); setTerm(''); setOpen(false); ref.current?.blur() }
  const onKey = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Enter') {
      e.preventDefault()
      // قارئ الباركود بيكتب الكود ويضغط Enter
      const code = term.trim()
      const exact = code && ((await db.list('v_products', { eq: { code } }))[0] ?? (await db.list('v_products', { eq: { barcode: code } }))[0])
      if (exact) pick(exact)
      else if (list[hi]) pick(list[hi])
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center">
        <Search size={14} className="absolute right-2.5 text-zinc-400 pointer-events-none" />
        <input ref={ref} disabled={disabled} className="cell w-full pr-8 font-bold text-right placeholder:font-normal placeholder:text-zinc-400"
          placeholder={value ? '' : 'ابحث عن الصنف أو امسح الباركود...'}
          value={open ? term : value ? value.name : ''}
          onFocus={() => { setTerm(''); setOpen(true) }} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setTerm(e.target.value); setOpen(true) }} onKeyDown={onKey} />
      </div>
      {open && (
        <div className="absolute z-40 top-full mt-1 right-0 w-[560px] max-h-80 overflow-auto bg-white rounded-xl shadow-2xl border border-zinc-200 p-1 text-[#111]">
          {!list.length ? <div className="px-3 py-4 text-center text-sm text-zinc-500">لا توجد أصناف مطابقة للبحث</div> : list.map((p, i) => {
            const left = Number(p.qty_on_hand)
            return (
              <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p) }} onMouseEnter={() => setHi(i)}
                className={`w-full text-right px-3 py-2 rounded-lg flex items-center gap-3 ${i === hi ? 'bg-orange-50' : ''}`}>
                <span className="num text-[12px] text-zinc-500 w-10 shrink-0">{p.code}</span>
                <span className="flex-1 min-w-0 truncate font-semibold text-[13px]">{p.name}</span>
                <span className={`num text-[12px] shrink-0 ${left <= 0 ? 'text-red-600' : 'text-emerald-700'}`}>متبقي {qty(left)}</span>
                <span className="num text-[12px] font-bold shrink-0 w-24 text-left">{sdg(p.price_sdg)} ج.س</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
