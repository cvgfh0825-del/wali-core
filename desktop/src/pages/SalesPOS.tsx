import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ScanBarcode, Plus, Minus, Trash2, FileClock, CheckCircle2, User, Phone, Printer, ShoppingCart, X, AlertTriangle, PackageSearch } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { Money, Field, Modal, Empty, Segmented, NoAccess } from '../components/ui'
import { ProductImage } from '../components/ProductImage'
import { printDoc, InvoiceDoc } from '../components/Print'
import { num, qty, usd, sdg } from '../lib/format'
import type { Row } from '../lib/backend'

type Line = { product: Row; qty: number; price_sdg?: number }

export default function SalesPOS() {
  const { db, can, rate, settings, toast } = useApp()
  const { id } = useParams()
  const nav = useNavigate()
  const [term, setTerm] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [customer, setCustomer] = useState<{ id?: string; name: string; phone: string }>({ name: '', phone: '' })
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')
  const [payMode, setPayMode] = useState<'full' | 'partial' | 'credit'>('full')
  const [method, setMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState<Row | null>(null)
  const { busy, run } = useAction()
  const scanRef = useRef<HTMLInputElement>(null)
  const canPrice = can('sales', 'approve')

  const products = useLoad(() => db.list('v_products', {
    eq: { is_active: true },
    search: term.trim() ? { cols: ['name', 'code', 'barcode', 'model'], term } : undefined,
    order: [{ col: 'code' }], limit: 60,
  }), [term], ['products', 'invoices'])
  const customers = useLoad(() => db.list('customers', { order: [{ col: 'name' }] }), [], ['customers'])

  // تعديل فاتورة مبدئية موجودة
  useEffect(() => {
    if (!id) return
    ;(async () => {
      const inv = await db.get('invoices', id)
      if (!inv || inv.kind !== 'proforma' || inv.status !== 'open') { toast('الفاتورة دي مينفعش تتعدل', 'err'); nav('/invoices'); return }
      const items = await db.list('invoice_items', { eq: { invoice_id: id }, order: [{ col: 'sort' }] })
      const prods = await db.list('v_products', { in: { id: items.map((i: any) => i.product_id) } })
      setLines(items.map((i: any) => ({ product: prods.find((p: any) => p.id === i.product_id)!, qty: Number(i.qty) })).filter((l) => l.product))
      setCustomer({ id: inv.customer_id ?? undefined, name: inv.customer_name ?? '', phone: inv.customer_phone ?? '' })
      setDiscount(Number(inv.discount_sdg) ? String(inv.discount_sdg) : '')
      setNotes(inv.notes ?? '')
    })()
  }, [id, db, nav, toast])

  const priceOf = (l: Line) => l.price_sdg ?? Math.round(Number(l.product.price_usd) * (rate ?? 0) * 100) / 100
  const subtotal = lines.reduce((s, l) => s + priceOf(l) * l.qty, 0)
  const total = Math.max(0, subtotal - (Number(discount) || 0))
  const paidVal = payMode === 'full' ? total : payMode === 'credit' ? 0 : Math.min(Number(paid) || 0, total)

  const add = (p: Row, n = 1) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id)
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], qty: c[i].qty + n }; return c }
      return [...ls, { product: p, qty: n }]
    })
  }
  const setQty = (pid: string, q: number) => setLines((ls) => ls.map((l) => (l.product.id === pid ? { ...l, qty: Math.max(1, q) } : l)))
  const removeLine = (pid: string) => setLines((ls) => ls.filter((l) => l.product.id !== pid))

  // الباركود ريدر بيكتب الكود ويدوس Enter
  const onScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const code = term.trim()
    if (!code) return
    const hit = (await db.list('v_products', { eq: { code } }))[0] ?? (await db.list('v_products', { eq: { barcode: code } }))[0]
    if (hit) { add(hit); setTerm(''); toast(`اتضاف: ${hit.name}`, 'info') }
    else if ((products.data ?? []).length === 1) { add(products.data![0]); setTerm('') }
    else toast('مفيش صنف بالكود ده', 'err')
  }

  const save = async (kind: 'proforma' | 'final') => {
    const inv = await run(() => db.rpc<Row>('save_invoice', { p: {
      id: id ?? null, kind,
      customer_id: customer.id ?? null, customer_name: customer.name || null, customer_phone: customer.phone || null,
      discount_sdg: Number(discount) || 0, paid_sdg: kind === 'final' ? paidVal : 0, method, notes: notes || null,
      items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, ...(l.price_sdg != null && canPrice ? { unit_price_sdg: l.price_sdg } : {}) })),
    } }))
    if (inv) {
      setDone(inv)
      setLines([]); setCustomer({ name: '', phone: '' }); setDiscount(''); setPaid(''); setNotes(''); setPayMode('full')
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
    return (customers.data ?? []).filter((c: any) => c.name.includes(t) || (c.phone ?? '').includes(t)).slice(0, 5)
  }, [customer, customers.data])

  if (!can('sales', 'create')) return <NoAccess />

  return (
    <div className="grid grid-cols-[1fr_400px] gap-4 h-[calc(100vh-56px-56px)]">
      {/* الأصناف */}
      <div className="card flex flex-col min-h-0 overflow-hidden">
        <div className="p-4 border-b border-ink-700 flex items-center gap-3">
          <div className="relative flex-1">
            <ScanBarcode size={20} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-500" />
            <input ref={scanRef} autoFocus className="input h-12 pr-11 text-[15px]" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onScan}
              placeholder="امسح الباركود أو اكتب الكود / الاسم / الموديل ودوس Enter" />
          </div>
          {!rate && <div className="chip h-12 px-3 rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/30"><AlertTriangle size={15} /> اكتب ريت النهارده الأول</div>}
        </div>
        <div className="flex-1 overflow-auto">
          <table className="tbl text-[13px] [&_td]:px-2 [&_th]:px-2">
            <thead><tr>
              <th className="w-12"></th><th>الموديل</th><th>الاسم</th><th>الكود</th>
              <th title="كل اللي دخل المخزن">الكمية</th><th title="اللي اتسلم للعملاء فعلاً">المسحوب</th>
              <th>المباع</th><th title="محجوز في فواتير مبدئية مفتوحة">محجوز</th><th>الباقي</th><th>السعر ج.س</th><th></th>
            </tr></thead>
            <tbody>
              {(products.data ?? []).map((p: any) => {
                const left = Number(p.qty_on_hand)
                const inCart = lines.find((l) => l.product.id === p.id)?.qty ?? 0
                return (
                  <tr key={p.id} className="cursor-pointer" onDoubleClick={() => add(p)}>
                    <td className="py-2"><ProductImage p={p} className="w-9 h-9 rounded-lg object-cover" /></td>
                    <td className="text-zinc-400 num whitespace-nowrap text-[12px]" dir="ltr">{p.model}</td>
                    <td className="font-semibold max-w-[210px] truncate" title={p.name}>{p.name}</td>
                    <td className="num text-zinc-400">{p.code}</td>
                    <td className="num">{qty(p.total_in)}</td>
                    <td className="num text-sky-300">{qty(p.withdrawn_qty)}</td>
                    <td className="num text-zinc-300">{qty(p.sold_qty)}</td>
                    <td className="num text-amber-300">{Number(p.reserved_qty) ? qty(p.reserved_qty) : '—'}</td>
                    <td><span className={`num font-bold ${left <= 0 ? 'text-red-400' : left <= Number(p.min_qty) ? 'text-amber-300' : 'text-emerald-300'}`}>{qty(left)}</span></td>
                    <td><Money v={p.price_sdg} cur={false} className="font-semibold" /></td>
                    <td>
                      <button onClick={() => add(p)} disabled={!rate} className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${inCart ? 'bg-brand-500 text-ink-950' : 'bg-ink-700 text-zinc-300 hover:bg-brand-500 hover:text-ink-950'}`}>
                        {inCart ? <span className="num font-black">{inCart}</span> : <Plus size={17} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {products.data && !products.data.length && <Empty title="مفيش أصناف بالبحث ده" />}
        </div>
      </div>

      {/* الفاتورة */}
      <div className="card flex flex-col min-h-0 overflow-hidden border-ink-600">
        <div className="px-5 py-4 border-b border-ink-700 bg-gradient-to-l from-brand-500/10 to-transparent flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg"><ShoppingCart size={20} className="text-brand-500" /> {id ? 'تعديل فاتورة مبدئية' : 'الفاتورة'}</div>
          {rate && <div className="text-[12px] text-zinc-400">1$ = <span className="num text-zinc-200">{num(rate, 2)}</span> ج.س</div>}
        </div>

        <div className="p-4 space-y-3 border-b border-ink-700 relative">
          <div className="grid grid-cols-[1fr_150px] gap-2">
            <div className="relative">
              <User size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input className="input pr-9" placeholder="اسم العميل (اختياري للكاش)" value={customer.name}
                onChange={(e) => setCustomer({ name: e.target.value, phone: customer.phone })} />
              {customer.id && <button onClick={() => setCustomer({ name: '', phone: '' })} className="absolute left-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white"><X size={15} /></button>}
            </div>
            <div className="relative">
              <Phone size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input className="input pr-9 num" dir="ltr" placeholder="الموبايل" value={customer.phone} disabled={!!customer.id}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </div>
          </div>
          {custMatches.length > 0 && (
            <div className="absolute z-20 right-4 left-4 top-[64px] card border-ink-600 p-1">
              {custMatches.map((c: any) => (
                <button key={c.id} onClick={() => setCustomer({ id: c.id, name: c.name, phone: c.phone ?? '' })} className="w-full text-right px-3 py-2 rounded-lg hover:bg-ink-700 flex justify-between text-sm">
                  <span>{c.name}</span><span className="num text-zinc-500">{c.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {!lines.length && (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 gap-3 py-10">
              <PackageSearch size={44} className="text-ink-500" />
              <div>امسح باركود أو دوس <span className="text-brand-400">+</span> قدام الصنف</div>
            </div>
          )}
          {lines.map((l) => {
            const over = l.qty > Number(l.product.qty_on_hand)
            return (
              <div key={l.product.id} className={`rounded-xl border p-3 bg-ink-900/60 animate-rise ${over ? 'border-amber-500/40' : 'border-ink-700'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{l.product.name}</div>
                    <div className="text-[11px] text-zinc-500 num">{l.product.code} · {l.product.model} · {usd(l.product.price_usd)}</div>
                  </div>
                  <button onClick={() => removeLine(l.product.id)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 size={15} /></button>
                </div>
                <div className="flex items-center justify-between mt-2.5 gap-2">
                  <div className="flex items-center bg-ink-800 rounded-lg border border-ink-600">
                    <button onClick={() => setQty(l.product.id, l.qty + 1)} className="w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-brand-400"><Plus size={14} /></button>
                    <input className="w-12 bg-transparent text-center num font-bold outline-none" value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value.replace(/\D/g, '')) || 1)} />
                    <button onClick={() => setQty(l.product.id, l.qty - 1)} className="w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-brand-400"><Minus size={14} /></button>
                  </div>
                  {canPrice ? (
                    <input className="input h-8 w-28 text-[13px] num text-center" value={l.price_sdg ?? priceOf(l)} title="سعر الوحدة بالجنيه (صلاحية اعتماد)"
                      onChange={(e) => setLines((ls) => ls.map((x) => x.product.id === l.product.id ? { ...x, price_sdg: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } : x))} />
                  ) : <span className="text-[12px] text-zinc-400 num">× {sdg(priceOf(l))}</span>}
                  <Money v={priceOf(l) * l.qty} className="font-bold" />
                </div>
                {over && <div className="text-[11px] text-amber-300 mt-2 flex items-center gap-1"><AlertTriangle size={12} /> الباقي في المخزن {qty(l.product.qty_on_hand)} بس — ينفع مبدئية، النهائية هترفض</div>}
              </div>
            )
          })}
        </div>

        <div className="border-t border-ink-700 p-4 space-y-3 bg-ink-900/40">
          <div className="grid grid-cols-2 gap-2">
            <Field label="خصم (ج.س)"><input className="input h-10 num" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></Field>
            <Field label="ملاحظات"><input className="input h-10" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <Segmented value={payMode} onChange={setPayMode} items={[{ key: 'full', label: 'كاش كامل' }, { key: 'partial', label: 'دفع جزئي' }, { key: 'credit', label: 'آجل' }]} />
          {payMode !== 'credit' && (
            <div className="grid grid-cols-2 gap-2">
              {payMode === 'partial' && <input className="input h-10 num" placeholder="المبلغ المدفوع" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ''))} />}
              <select className={`input h-10 ${payMode === 'full' ? 'col-span-2' : ''}`} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">كاش</option><option value="bank">بنك</option><option value="transfer">تحويل بنكي / بنكك</option><option value="cheque">شيك</option>
              </select>
            </div>
          )}
          <div className="rounded-xl bg-ink-950 border border-ink-700 p-4 space-y-1.5">
            <div className="flex justify-between text-sm text-zinc-400"><span>{lines.length} صنف · {lines.reduce((s, l) => s + l.qty, 0)} قطعة</span><Money v={subtotal} /></div>
            {Number(discount) > 0 && <div className="flex justify-between text-sm text-zinc-400"><span>الخصم</span><span className="num">− {sdg(discount)}</span></div>}
            <div className="flex justify-between items-end pt-1"><span className="font-bold">الصافي</span><span className="num text-[28px] font-black text-brand-400 leading-none">{sdg(total)} <span className="text-sm text-zinc-500 font-sans">ج.س</span></span></div>
            {payMode !== 'full' && <div className="flex justify-between text-[13px] text-red-300"><span>المتبقي على العميل</span><span className="num">{sdg(total - paidVal)}</span></div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost h-12" disabled={busy || !lines.length || !rate} onClick={() => save('proforma')}><FileClock size={18} /> {id ? 'حفظ التعديل' : 'فاتورة مبدئية'}</button>
            <button className="btn-primary h-12" disabled={busy || !lines.length || !rate || !!id} onClick={() => save('final')}><CheckCircle2 size={18} /> فاتورة نهائية</button>
          </div>
        </div>
      </div>

      <Modal open={!!done} onClose={() => { setDone(null); scanRef.current?.focus() }} width="max-w-md" title="">
        {done && (
          <div className="text-center -mt-4">
            <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${done.kind === 'final' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
              {done.kind === 'final' ? <CheckCircle2 size={40} /> : <FileClock size={40} />}
            </div>
            <div className="font-display text-2xl font-black mt-4">{done.kind === 'final' ? 'الفاتورة اتسجلت' : 'المبدئية اتسجلت'}</div>
            <div className="num text-zinc-400 mt-1" dir="ltr">{done.number}</div>
            <div className="num text-3xl font-black text-brand-400 mt-3">{sdg(done.total_sdg)} <span className="text-sm text-zinc-500 font-sans">ج.س</span></div>
            {done.kind === 'proforma' && <p className="text-[13px] text-zinc-400 mt-3">اتبعت إشعار للأدمن بالفاتورة دي.</p>}
            <div className="flex gap-2 mt-6">
              <button className="btn-primary flex-1" onClick={printDone}><Printer size={18} /> طباعة</button>
              <button className="btn-ghost flex-1" onClick={() => { setDone(null); scanRef.current?.focus() }}>فاتورة جديدة</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
