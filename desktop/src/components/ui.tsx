import { ReactNode, useEffect, useState } from 'react'
import { X, Search, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { useToasts } from '../lib/app'
import { sdg } from '../lib/format'
import { EmptyArt } from './art'

export function Logo({ size = 40, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={glow ? 'drop-shadow-[0_0_18px_rgba(255,122,26,.45)]' : ''}>
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1C1C21" /><stop offset="1" stopColor="#070708" /></linearGradient>
        <linearGradient id="lg-w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFB066" /><stop offset=".55" stopColor="#FF7A1A" /><stop offset="1" stopColor="#E8530A" /></linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#lg-bg)" />
      <rect x="8.5" y="8.5" width="239" height="239" rx="55.5" fill="none" stroke="#FF7A1A" strokeOpacity=".35" />
      <path d="M52 78 L88 186 L128 104 L168 186 L204 78" fill="none" stroke="url(#lg-w)" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="128" cy="56" r="13" fill="#FF7A1A" />
    </svg>
  )
}

export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="leading-none">
      <div className={`font-display font-black tracking-wide ${small ? 'text-lg' : 'text-2xl'}`} dir="ltr">
        WALI<span className="text-brand-500">CORE</span>
      </div>
      <div className={`text-zinc-500 ${small ? 'text-[11px] mt-1' : 'text-xs mt-1.5'}`}>نظام إدارة والي بلازا</div>
    </div>
  )
}

export function Modal({ open, onClose, title, subtitle, children, width = 'max-w-2xl', footer }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string; footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm animate-rise no-drag" onMouseDown={onClose}>
      <div className={`card w-full ${width} max-h-[90vh] flex flex-col overflow-hidden border-ink-600`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-ink-700">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            {subtitle && <p className="text-sm text-zinc-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 -m-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700"><X size={18} /></button>
        </div>
        <div className="p-6 overflow-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-ink-700 bg-ink-900/50 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint, className = '' }: { label: ReactNode; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-zinc-500 mt-1">{hint}</span>}
    </label>
  )
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6 animate-rise">
      <div className="flex items-center gap-4">
        {icon && <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500/25 to-brand-500/5 border border-brand-500/30 text-brand-400 flex items-center justify-center">{icon}</div>}
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-zinc-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, icon, accent = false, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: boolean; tone?: 'green' | 'red' | 'amber'
}) {
  const toneCls = tone === 'green' ? 'text-emerald-400 bg-emerald-500/10' : tone === 'red' ? 'text-red-400 bg-red-500/10' : tone === 'amber' ? 'text-amber-400 bg-amber-500/10' : 'text-brand-400 bg-brand-500/10'
  return (
    <div className={`card p-5 relative overflow-hidden ${accent ? 'bg-gradient-to-br from-brand-500/20 via-ink-850 to-ink-850 border-brand-500/30' : ''}`}>
      {accent && <div className="absolute -left-10 -top-10 w-40 h-40 rounded-full bg-brand-500/20 blur-3xl" />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-zinc-400 font-medium">{label}</div>
          <div className="num text-[26px] font-extrabold mt-1.5 truncate">{value}</div>
          {sub && <div className="text-[12px] text-zinc-500 mt-1">{sub}</div>}
        </div>
        {icon && <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}>{icon}</div>}
      </div>
    </div>
  )
}

export function Money({ v, cur = true, className = '' }: { v: any; cur?: boolean; className?: string }) {
  return (
    <span className={`num whitespace-nowrap ${className}`}>
      {sdg(v)}{cur && <span className="text-zinc-500 text-[0.8em] font-sans mr-1">ج.س</span>}
    </span>
  )
}

export function Badge({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`chip ${cls}`}>{children}</span>
}

export function Empty({ title = 'لا توجد بيانات بعد', text, action }: { title?: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <EmptyArt className="w-40 h-28 mb-4 opacity-90" />
      <div className="font-bold text-zinc-200">{title}</div>
      {text && <div className="text-sm text-zinc-500 mt-1 max-w-sm">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ text = 'جارٍ التحميل...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400">
      <Loader2 className="animate-spin text-brand-500" size={20} /> {text}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'بحث...', autoFocus = false, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input className="input pr-10" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-ink-900 border border-ink-700 gap-1">
      {items.map((it) => (
        <button key={it.key} onClick={() => onChange(it.key)}
          className={`h-9 px-4 rounded-lg text-[13px] font-semibold transition flex items-center gap-2 ${value === it.key ? 'bg-ink-700 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}>
          {it.label}
          {it.count != null && <span className={`num text-[11px] px-1.5 rounded ${value === it.key ? 'bg-brand-500 text-ink-950' : 'bg-ink-700 text-zinc-400'}`}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Toaster() {
  const { toasts } = useToasts()
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[400px] no-drag">
      {toasts.map((t) => (
        <div key={t.id} className={`card px-4 py-3 flex items-start gap-3 animate-rise border ${t.kind === 'err' ? 'border-red-500/40' : t.kind === 'ok' ? 'border-emerald-500/30' : 'border-ink-600'}`}>
          {t.kind === 'err' ? <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" /> : t.kind === 'ok' ? <CheckCircle2 size={18} className="text-emerald-400 mt-0.5 shrink-0" /> : <Info size={18} className="text-brand-400 mt-0.5 shrink-0" />}
          <div className="text-sm leading-6">{t.text}</div>
        </div>
      ))}
    </div>
  )
}

// نافذة تأكيد مع سبب اختياري
export function useConfirm() {
  const [state, setState] = useState<null | { title: string; text?: string; danger?: boolean; reason?: boolean; resolve: (v: string | false) => void }>(null)
  const [reason, setReason] = useState('')
  const ask = (title: string, opts: { text?: string; danger?: boolean; reason?: boolean } = {}) =>
    new Promise<string | false>((resolve) => { setReason(''); setState({ title, ...opts, resolve }) })
  const close = (v: string | false) => { state?.resolve(v); setState(null) }
  const node = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title} width="max-w-md"
      footer={<>
        <button className="btn-ghost" onClick={() => close(false)}>رجوع</button>
        <button className={state?.danger ? 'btn-danger' : 'btn-primary'} disabled={state?.reason && !reason.trim()} onClick={() => close(reason || 'ok')}>تأكيد</button>
      </>}>
      {state?.text && <p className="text-zinc-300 leading-7">{state.text}</p>}
      {state?.reason && <Field label="السبب" className="mt-4"><input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
    </Modal>
  )
  return { ask, node }
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="grid gap-1 p-1 rounded-xl bg-ink-900 border border-ink-600" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it) => (
        <button type="button" key={it.key} onClick={() => onChange(it.key)}
          className={`h-9 rounded-lg text-[13px] font-semibold transition ${value === it.key ? 'bg-brand-500 text-ink-950' : 'text-zinc-400 hover:text-white'}`}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function NoAccess() {
  return <Empty title="غير مسموح لك بالدخول إلى هذه الصفحة" text="هذه الصفحة تتطلب صلاحية خاصة. تواصل مع مدير النظام إذا احتجت إليها." />
}
