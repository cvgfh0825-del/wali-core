import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import { Row } from '../lib/backend'
import { sdg, date, num, usd, qty, METHOD } from '../lib/format'

// بنرسم المستند جوه #print-root ونطبع؛ في Electron ممكن يتحفظ PDF كمان
let setPrintNode: ((n: ReactNode) => void) | null = null

export function PrintHost() {
  const [node, setNode] = useState<ReactNode>(null)
  useEffect(() => { setPrintNode = setNode; return () => { setPrintNode = null } }, [])
  return createPortal(<div id="print-root">{node}</div>, document.body)
}

export async function printDoc(node: ReactNode, opts: { pdf?: string } = {}) {
  setPrintNode?.(node)
  await new Promise((r) => setTimeout(r, 250))
  const w = (window as any).wali
  try {
    if (opts.pdf && w?.savePDF) await w.savePDF(opts.pdf)
    else window.print()
  } finally {
    setTimeout(() => setPrintNode?.(null), 500)
  }
}

const brand = '#E8620A'

function Header({ settings, title, number, dateStr, extra }: { settings: Row; title: string; number?: string; dateStr?: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `3px solid ${brand}`, paddingBottom: 14, marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {settings.logo ? <img src={settings.logo} style={{ width: 64, height: 64, objectFit: 'contain' }} /> : (
          <svg width="60" height="60" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="56" fill="#111" />
            <path d="M52 78 L88 186 L128 104 L168 186 L204 78" fill="none" stroke={brand} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" /><circle cx="128" cy="56" r="13" fill={brand} /></svg>
        )}
        <div>
          <div style={{ fontFamily: 'Cairo', fontWeight: 900, fontSize: 22 }}>{settings.company_name} <span style={{ color: '#888', fontSize: 14, fontWeight: 700 }}>{settings.company_name_en}</span></div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 4, lineHeight: 1.7 }}>
            {settings.address && <div>{settings.address}</div>}
            <div dir="ltr" style={{ textAlign: 'right' }}>{[settings.phone1, settings.phone2, settings.email].filter(Boolean).join('  ·  ')}</div>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontFamily: 'Cairo', fontWeight: 900, fontSize: 22, color: brand }}>{title}</div>
        {number && <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }} dir="ltr">{number}</div>}
        {dateStr && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{dateStr}</div>}
        {extra}
      </div>
    </div>
  )
}

const th: React.CSSProperties = { background: '#111', color: '#fff', padding: '8px 10px', fontSize: 12, textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, borderBottom: '1px solid #e5e5e5' }

export function InvoiceDoc({ inv, items, settings }: { inv: Row; items: Row[]; settings: Row }) {
  const isPF = inv.kind === 'proforma'
  return (
    <div style={{ fontFamily: '"IBM Plex Sans Arabic", sans-serif', direction: 'rtl', padding: 4, color: '#111' }}>
      <Header settings={settings} title={isPF ? 'فاتورة مبدئية / عرض سعر' : 'فاتورة مبيعات'} number={inv.number} dateStr={date(inv.invoice_date)}
        extra={inv.status === 'cancelled' ? <div style={{ color: '#c00', fontWeight: 900, marginTop: 4 }}>ملغية</div> : null} />
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1, background: '#f6f6f6', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.9 }}>
          <div><b>العميل:</b> {inv.customer_name || 'عميل نقدي'}</div>
          {inv.customer_phone && <div><b>الهاتف:</b> <span dir="ltr">{inv.customer_phone}</span></div>}
        </div>
        <div style={{ flex: 1, background: '#f6f6f6', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.9 }}>
          <div><b>سعر الصرف:</b> 1$ = {num(inv.rate, 2)} ج.س</div>
          <div><b>البائع:</b> {inv.salesperson_name ?? inv.created_by_name ?? ''}</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...th, width: 30 }}>#</th><th style={th}>الكود</th><th style={th}>الصنف</th><th style={th}>الموديل</th>
          <th style={th}>الكمية</th><th style={th}>سعر الوحدة</th><th style={th}>الإجمالي</th>
        </tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id ?? i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
              <td style={td}>{i + 1}</td><td style={td} dir="ltr">{it.code}</td><td style={{ ...td, fontWeight: 600 }}>{it.name}</td>
              <td style={td}>{it.model}</td><td style={td}>{qty(it.qty)}</td>
              <td style={td}>{sdg(it.unit_price_sdg)}</td><td style={{ ...td, fontWeight: 700 }}>{sdg(it.total_sdg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <table style={{ width: 300, fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ padding: 6 }}>الإجمالي</td><td style={{ padding: 6, textAlign: 'left' }}>{sdg(inv.subtotal_sdg)} ج.س</td></tr>
            {Number(inv.discount_sdg) > 0 && <tr><td style={{ padding: 6 }}>الخصم</td><td style={{ padding: 6, textAlign: 'left' }}>− {sdg(inv.discount_sdg)}</td></tr>}
            <tr style={{ background: '#111', color: '#fff', fontWeight: 900 }}><td style={{ padding: 8 }}>الصافي</td><td style={{ padding: 8, textAlign: 'left' }}>{sdg(inv.total_sdg)} ج.س</td></tr>
            {!isPF && <tr><td style={{ padding: 6 }}>المدفوع</td><td style={{ padding: 6, textAlign: 'left' }}>{sdg(inv.paid_sdg)}</td></tr>}
            {!isPF && Number(inv.total_sdg) - Number(inv.paid_sdg) > 0 && <tr style={{ color: '#c00', fontWeight: 700 }}><td style={{ padding: 6 }}>المتبقي</td><td style={{ padding: 6, textAlign: 'left' }}>{sdg(Number(inv.total_sdg) - Number(inv.paid_sdg))}</td></tr>}
          </tbody>
        </table>
      </div>
      {isPF && <div style={{ marginTop: 16, fontSize: 11, color: '#555', border: '1px dashed #bbb', borderRadius: 8, padding: 10 }}>
        الأسعار بالجنيه محسوبة على سعر الدولار يوم إصدار العرض، وممكن تتغير بتغيّر سعر الصرف لحد تأكيد الطلب.</div>}
      {inv.notes && <div style={{ marginTop: 12, fontSize: 12 }}><b>ملاحظات:</b> {inv.notes}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, fontSize: 12 }}>
        <div>توقيع المستلم: ..............................</div><div>ختم الشركة: ..............................</div>
      </div>
      <div style={{ marginTop: 30, textAlign: 'center', fontSize: 11, color: '#777', borderTop: '1px solid #eee', paddingTop: 10 }}>{settings.invoice_footer}</div>
    </div>
  )
}

export function DeliveryDoc({ permit, items, settings }: { permit: Row; items: Row[]; settings: Row }) {
  return (
    <div style={{ fontFamily: '"IBM Plex Sans Arabic", sans-serif', direction: 'rtl', color: '#111' }}>
      <Header settings={settings} title="إذن تسليم بضاعة" number={permit.number} dateStr={date(permit.created_at)} />
      <div style={{ background: '#f6f6f6', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.9, marginBottom: 14 }}>
        <div><b>الفاتورة:</b> <span dir="ltr">{permit.invoice_number}</span> — <b>العميل:</b> {permit.customer_name}</div>
        <div><b>المستلم:</b> {permit.receiver_name}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>#</th><th style={th}>الكود</th><th style={th}>الصنف</th><th style={th}>الكمية</th><th style={th}>ملاحظات</th></tr></thead>
        <tbody>{items.map((it, i) => (
          <tr key={i}><td style={td}>{i + 1}</td><td style={td} dir="ltr">{it.code}</td><td style={td}>{it.name}</td><td style={{ ...td, fontWeight: 700 }}>{qty(it.qty)}</td><td style={td}></td></tr>
        ))}</tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 50, fontSize: 12 }}>
        <div>الحسابات: ....................</div><div>أمين المخزن: ....................</div><div>المستلم: ....................</div>
      </div>
    </div>
  )
}

export function ReceiptDoc({ p, settings }: { p: Row; settings: Row }) {
  return (
    <div style={{ fontFamily: '"IBM Plex Sans Arabic", sans-serif', direction: 'rtl', color: '#111' }}>
      <Header settings={settings} title={p.direction === 'in' ? 'إيصال استلام نقدية' : 'إيصال صرف نقدية'} dateStr={date(p.pay_date)} />
      <div style={{ fontSize: 15, lineHeight: 2.4, padding: 10 }}>
        <div>{p.direction === 'in' ? 'استلمنا من' : 'صرفنا إلى'}: <b>{p.customer_name ?? p.supplier_name ?? '—'}</b></div>
        <div>مبلغ وقدره: <b style={{ fontSize: 20 }}>{sdg(p.amount_sdg)} ج.س</b></div>
        <div>طريقة الدفع: {METHOD[p.method]}</div>
        {(p.invoice_number || p.purchase_number) && <div>عن: <span dir="ltr">{p.invoice_number ?? p.purchase_number}</span></div>}
        {p.notes && <div>البيان: {p.notes}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, fontSize: 12 }}>
        <div>المستلم: ....................</div><div>المحاسب: ....................</div>
      </div>
    </div>
  )
}

export function Barcode({ value, height = 40, width = 1.6 }: { value: string; height?: number; width?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    try {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      JsBarcode(el, value, { format: 'CODE128', height, width, displayValue: false, margin: 0 })
      setSvg(el.outerHTML)
    } catch { setSvg('') }
  }, [value, height, width])
  return <span dangerouslySetInnerHTML={{ __html: svg }} />
}

// ملصقات باركود (3 في الصف على A4)
export function LabelsDoc({ items, settings }: { items: { p: Row; count: number }[]; settings: Row }) {
  const all = items.flatMap(({ p, count }) => Array.from({ length: count }, () => p))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, direction: 'rtl', fontFamily: '"IBM Plex Sans Arabic", sans-serif' }}>
      {all.map((p, i) => (
        <div key={i} style={{ border: '1px dashed #bbb', borderRadius: 6, padding: '6px 8px', textAlign: 'center', breakInside: 'avoid', color: '#111' }}>
          <div style={{ fontSize: 9, color: brand, fontWeight: 800 }}>{settings.company_name}</div>
          <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
          <Barcode value={p.barcode || p.code} height={34} width={1.4} />
          <div style={{ fontSize: 10, display: 'flex', justifyContent: 'space-between' }} dir="ltr"><span>{p.barcode || p.code}</span><span>{p.model}</span></div>
        </div>
      ))}
    </div>
  )
}

export function TableDoc({ title, settings, cols, rows, summary }: { title: string; settings: Row; cols: { key: string; label: string; fmt?: (v: any, r: Row) => any }[]; rows: Row[]; summary?: ReactNode }) {
  return (
    <div style={{ fontFamily: '"IBM Plex Sans Arabic", sans-serif', direction: 'rtl', color: '#111' }}>
      <Header settings={settings} title={title} dateStr={date(new Date().toISOString())} />
      {summary}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map((c) => <th key={c.key} style={th}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>{cols.map((c) => <td key={c.key} style={td}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export { usd }
