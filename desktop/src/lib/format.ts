const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export const num = (n: any, d = 0) => (d ? nf2 : nf0).format(Number(n) || 0)
export const sdg = (n: any) => `${nf0.format(Math.round(Number(n) || 0))}`
export const usd = (n: any) => `$${nf2.format(Number(n) || 0)}`
export const qty = (n: any) => nf2.format(Number(n) || 0)

// أرقام كبيرة مختصرة: 12.5 م
export const short = (n: any) => {
  const v = Number(n) || 0
  const a = Math.abs(v)
  if (a >= 1e9) return nf2.format(+(v / 1e9).toFixed(2)) + ' مليار'
  if (a >= 1e6) return nf2.format(+(v / 1e6).toFixed(2)) + ' مليون'
  if (a >= 1e3) return nf2.format(+(v / 1e3).toFixed(1)) + ' ألف'
  return nf0.format(v)
}

const TZ = 'Africa/Khartoum'
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
export const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}
export const monthNow = () => today().slice(0, 7)
// آخر يوم في الشهر: '2026-11' ← '2026-11-30'
export const monthEnd = (p: string) => {
  const [y, m] = p.split('-').map(Number)
  return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

export const date = (s?: string | null) =>
  s ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s.length === 10 ? s + 'T12:00:00' : s)) : '—'
export const time = (s?: string | null) =>
  s ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(s)) : '—'
export const dateTime = (s?: string | null) => (s ? `${date(s)} — ${time(s)}` : '—')
export const monthName = (p: string) =>
  new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' }).format(new Date(p + '-15T12:00:00'))

export const ago = (s: string) => {
  const diff = (Date.now() - new Date(s).getTime()) / 1000
  if (diff < 60) return 'الآن'
  if (diff < 3600) return `من ${Math.floor(diff / 60)} دقيقة`
  if (diff < 86400) return `من ${Math.floor(diff / 3600)} ساعة`
  if (diff < 86400 * 7) return `من ${Math.floor(diff / 86400)} يوم`
  return date(s)
}

export const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'مبدئية مفتوحة', cls: 'bg-amber-500/15 text-amber-300' },
  converted: { label: 'حُوِّلت إلى نهائية', cls: 'bg-sky-500/15 text-sky-300' },
  posted: { label: 'نهائية', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'ملغية', cls: 'bg-red-500/15 text-red-300' },
  pending: { label: 'بانتظار التسليم', cls: 'bg-amber-500/15 text-amber-300' },
  delivered: { label: 'تم التسليم', cls: 'bg-emerald-500/15 text-emerald-300' },
  draft: { label: 'مسودة', cls: 'bg-zinc-500/15 text-zinc-300' },
  paid: { label: 'تم الصرف', cls: 'bg-emerald-500/15 text-emerald-300' },
}
export const PAY: Record<string, { label: string; cls: string }> = {
  cash: { label: 'مدفوعة', cls: 'bg-emerald-500/15 text-emerald-300' },
  credit: { label: 'آجل', cls: 'bg-red-500/15 text-red-300' },
  partial: { label: 'دفع جزئي', cls: 'bg-amber-500/15 text-amber-300' },
}
export const METHOD: Record<string, string> = { cash: 'نقدًا', bank: 'بنك', transfer: 'تحويل', cheque: 'شيك' }

export function downloadCSV(name: string, rows: Record<string, any>[], cols: { key: string; label: string }[]) {
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '﻿' + [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = name + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
