import { ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import { Row } from '../lib/backend'
import invoiceTemplate from '../assets/invoice-template.jpg'
import { sdg, date, num, usd, qty, METHOD } from '../lib/format'

// بنرسم المستند جوه #print-root ونطبع؛ في Electron ممكن يتحفظ PDF كمان
let setPrintNode: ((n: ReactNode) => void) | null = null

export function PrintHost() {
  const [node, setNode] = useState<ReactNode>(null)
  useEffect(() => { setPrintNode = setNode; return () => { setPrintNode = null } }, [])
  return createPortal(<div id="print-root">{node}</div>, document.body)
}

// bare: المستند نفسه مقاس A4 كامل (زي الفاتورة) فمن غير هوامش
export async function printDoc(node: ReactNode, opts: { pdf?: string; bare?: boolean } = {}) {
  setPrintNode?.(node)
  await new Promise((r) => setTimeout(r, 250))
  const w = (window as any).wali
  try {
    if (opts.pdf && w?.savePDF) await w.savePDF(opts.pdf, opts.bare)
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

// الفاتورة بتتطبع على تصميم والي بلازا نفسه (الصورة 1054×1492) والبيانات بتتحط فوق أماكنها
const TPL_W = 1054, TPL_H = 1492
const ROWS = 14, ROW_TOP = 618, ROW_H = 46
const TPL_TAX = '300000599652', TPL_OKASH = '2055534'   // المطبوع في التصميم نفسه
const COLS = { desc: [612, 1006], qty: [500, 605], unit: [364, 493], vat: [235, 357], total: [55, 228] } as const
const at = (x1: number, x2: number, y1: number, y2: number): React.CSSProperties => ({
  position: 'absolute', left: `${(x1 / TPL_W) * 100}%`, width: `${((x2 - x1) / TPL_W) * 100}%`,
  top: `${(y1 / TPL_H) * 100}%`, height: `${((y2 - y1) / TPL_H) * 100}%`,
  display: 'flex', alignItems: 'center', overflow: 'hidden',
})

type Line = { name: string; qty?: any; unit?: any; total: any; bold?: boolean; red?: boolean }

export function InvoiceDoc({ inv, items, settings: _settings }: { inv: Row; items: Row[]; settings: Row }) {
  const isPF = inv.kind === 'proforma'
  const pf: Row = inv.print_fields ?? {}
  const total = Number(inv.total_sdg), paid = Number(inv.paid_sdg)
  const summary: Line[] = Number(inv.discount_sdg) > 0
    ? [{ name: 'الإجمالي', total: inv.subtotal_sdg }, { name: 'الخصم', total: -Number(inv.discount_sdg) }, { name: 'الصافي', total, bold: true }]
    : [{ name: 'الإجمالي', total, bold: true }]
  if (!isPF && paid > 0) summary.push({ name: 'المدفوع', total: paid })
  if (!isPF && total - paid > 0.5) summary.push({ name: 'المتبقي', total: total - paid, red: true })

  const lines: Line[] = items.map((it) => ({ name: it.name, qty: it.qty, unit: it.unit_price_sdg, total: it.total_sdg }))
  const pages: Line[][] = []
  for (let i = 0; i < lines.length; i += ROWS) pages.push(lines.slice(i, i + ROWS))
  if (!pages.length) pages.push([])
  const last = pages[pages.length - 1]
  if (last.length + summary.length > ROWS) pages.push(summary)
  else last.push(...summary)

  const text = (size: number, extra: React.CSSProperties = {}): React.CSSProperties => ({ fontSize: `${size}mm`, fontWeight: 700, color: '#111', ...extra })
  return (
    <>
      <style>{'@page { size: A4; margin: 0 } #print-root { inset: 0 auto auto 0 !important }'}</style>
      {pages.map((rows, pi) => (
        <div key={pi} style={{ position: 'relative', width: '210mm', height: '296.5mm', overflow: 'hidden', direction: 'rtl', fontFamily: 'Cairo, "IBM Plex Sans Arabic", sans-serif', breakAfter: pi < pages.length - 1 ? 'page' : 'auto' }}>
          <img src={invoiceTemplate} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          {/* خانات اتكتبت في شاشة الفاتورة: لو اتغيرت عن المطبوع في التصميم بنغطيه ونكتب الجديد */}
          {pf.company_tax_id != null && pf.company_tax_id !== TPL_TAX && (
            <div style={{ ...at(677, 990, 388, 418), background: '#fff', display: 'flex', direction: 'ltr', border: '1.5px solid #222' }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: '100%', borderLeft: i ? '1px solid #555' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', ...text(4.2) }}>{String(pf.company_tax_id)[i] ?? ''}</div>
              ))}
            </div>
          )}
          {pf.okash != null && pf.okash !== TPL_OKASH && (
            <div style={{ ...at(640, 790, 1300, 1340), background: '#fff', ...text(5, { fontWeight: 900, justifyContent: 'center' }) }} dir="ltr">{pf.okash}</div>
          )}
          {pf.bank_khartoum && <div style={{ ...at(80, 305, 1300, 1326), ...text(3.8, { justifyContent: 'center' }) }} dir="ltr">{pf.bank_khartoum}</div>}
          {/* خانة الرقم الضريبي التانية (الشمال) مش مستخدمة — بتتغطى في الطباعة */}
          <div style={{ ...at(55, 405, 335, 424), background: '#fcfcfc' }} />
          <div style={{ ...at(70, 386, 450, 478), ...text(4) }}>{inv.customer_name || 'عميل نقدي'}</div>
          <div style={{ ...at(708, 914, 450, 478), ...text(3.8), justifyContent: 'center' }}>{date(inv.invoice_date)}</div>
          <div style={{ ...at(560, 1000, 486, 514), ...text(3, { fontWeight: 600, color: '#444', gap: '1.5mm' }) }}>
            <span>{isPF ? 'عرض سعر رقم' : 'فاتورة رقم'}</span><span dir="ltr">{inv.number}</span>
            {inv.status === 'cancelled' && <span style={{ color: '#c00', fontWeight: 900 }}>— ملغية</span>}
            {pages.length > 1 && <span>(الصفحة {pi + 1} من {pages.length})</span>}
          </div>
          {rows.map((l, i) => {
            const y1 = ROW_TOP + i * ROW_H, y2 = y1 + ROW_H
            const cell = (c: readonly [number, number], v: any) => <div style={{ ...at(c[0] + 6, c[1] - 6, y1, y2), ...text(3.6, { justifyContent: 'center', color: l.red ? '#c00' : '#111', fontWeight: l.bold ? 900 : 700 }) }} dir="ltr">{v}</div>
            return (
              <div key={i}>
                <div style={{ ...at(COLS.desc[0] + 10, COLS.desc[1] - 12, y1, y2), ...text(l.name.length > 38 ? 3 : 3.6, { lineHeight: 1.25, fontWeight: l.bold ? 900 : 700, color: l.red ? '#c00' : '#111' }) }}>{l.name}</div>
                {l.qty != null && cell(COLS.qty, qty(l.qty))}
                {l.unit != null && cell(COLS.unit, sdg(l.unit))}
                {cell(COLS.total, Number(l.total) < 0 ? `− ${sdg(-Number(l.total))}` : sdg(l.total))}
              </div>
            )
          })}
          {pi === pages.length - 1 && (
            <div style={{ ...at(62, 812, 1349, 1395), ...text(3.4, { lineHeight: 1.3 }) }}>فقط {tafqeet(total)} جنيه سوداني لا غير</div>
          )}
        </div>
      ))}
    </>
  )
}

// المبلغ بالحروف
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']
const SCALES = [['', '', ''], ['ألف', 'ألفان', 'آلاف'], ['مليون', 'مليونان', 'ملايين'], ['مليار', 'ملياران', 'مليارات']]

function under1000(n: number) {
  const r = n % 100, t = Math.floor(r / 10), o = r % 10
  const rest = r < 20 ? ONES[r] : o ? `${ONES[o]} و${TENS[t]}` : TENS[t]
  return [HUNDREDS[Math.floor(n / 100)], rest].filter(Boolean).join(' و')
}

export function tafqeet(v: number) {
  let n = Math.round(Math.abs(v))
  if (!n) return 'صفر'
  const parts: string[] = []
  for (let s = 0; n > 0 && s < SCALES.length; s++, n = Math.floor(n / 1000)) {
    const g = n % 1000
    if (!g) continue
    const [one, two, many] = SCALES[s]
    parts.unshift(!s ? under1000(g) : g === 1 ? one : g === 2 ? two : g <= 10 ? `${under1000(g)} ${many}` : `${under1000(g)} ${one}`)
  }
  return parts.join(' و')
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
        <div>المحاسب: ....................</div><div>أمين المخزن: ....................</div><div>المستلم: ....................</div>
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
