import { useState } from 'react'
import { short, sdg } from '../lib/format'

// منحنى مساحة بسيط بالـ SVG (من اليمين للشمال عشان العربي)
export function AreaChart({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 800, H = height, P = { t: 16, b: 28, l: 8, r: 8 }
  const max = Math.max(1, ...data.map((d) => d.value)) * 1.15
  const n = data.length
  const x = (i: number) => W - P.r - (i * (W - P.l - P.r)) / Math.max(1, n - 1)
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b)
  const pts = data.map((d, i) => [x(i), y(d.value)] as const)
  const line = pts.map((p, i) => {
    if (i === 0) return `M${p[0]},${p[1]}`
    const [px, py] = pts[i - 1]
    const cx = (px + p[0]) / 2
    return `C${cx},${py} ${cx},${p[1]} ${p[0]},${p[1]}`
  }).join(' ')
  const area = `${line} L${pts[n - 1]?.[0] ?? 0},${H - P.b} L${pts[0]?.[0] ?? 0},${H - P.b} Z`
  const h = hover != null ? data[hover] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((W - P.r - px) / (W - P.l - P.r)) * (n - 1))
          setHover(Math.max(0, Math.min(n - 1, i)))
        }}>
        <defs>
          <linearGradient id="ac-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF7A1A" stopOpacity=".35" />
            <stop offset="1" stopColor="#FF7A1A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={y(max * f / 1.15)} y2={y(max * f / 1.15)} stroke="#24242A" strokeDasharray="4 6" />
        ))}
        {n > 1 && <path d={area} fill="url(#ac-fill)" />}
        {n > 1 && <path d={line} fill="none" stroke="#FF7A1A" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
        {hover != null && pts[hover] && (
          <>
            <line x1={pts[hover][0]} x2={pts[hover][0]} y1={P.t} y2={H - P.b} stroke="#FF7A1A" strokeOpacity=".4" vectorEffect="non-scaling-stroke" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="5" fill="#070708" stroke="#FF7A1A" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="flex justify-between text-[11px] text-zinc-500 mt-1 num px-1">
        {data.filter((_, i) => i % Math.ceil(n / 7) === 0).map((d) => <span key={d.label}>{d.label}</span>)}
      </div>
      {h && (
        <div className="absolute top-2 left-2 card px-3 py-2 text-[12px] pointer-events-none border-brand-500/30">
          <div className="text-zinc-400">{h.label}</div>
          <div className="num font-bold text-[15px]">{sdg(h.value)} <span className="text-zinc-500 text-[11px] font-sans">ج.س</span></div>
        </div>
      )}
    </div>
  )
}

export function BarList({ items, money = true }: { items: { label: string; sub?: string; value: number }[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-[13px] mb-1.5 gap-3">
            <span className="truncate text-zinc-200">{it.label} {it.sub && <span className="text-zinc-500 text-[11px]">· {it.sub}</span>}</span>
            <span className="num font-bold shrink-0">{money ? short(it.value) : it.value}</span>
          </div>
          <div className="h-2 rounded-full bg-ink-700 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-l from-brand-400 to-brand-600" style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// أعمدة شهرية (مبيعات/مصروفات/ربح)
export function MonthBars({ data }: { data: { label: string; sales: number; cost: number; profit: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.sales, d.cost)))
  return (
    <div>
      <div className="flex items-end gap-2 h-56">
        {data.map((d) => (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-1 group h-full justify-end" title={`مبيعات ${sdg(d.sales)} — ربح ${sdg(d.profit)}`}>
            <div className="w-full flex items-end justify-center gap-[3px] h-full">
              <div className="w-1/3 rounded-t bg-gradient-to-t from-brand-700 to-brand-400 transition group-hover:brightness-125" style={{ height: `${(d.sales / max) * 100}%` }} />
              <div className="w-1/3 rounded-t bg-ink-500 transition group-hover:brightness-125" style={{ height: `${(d.cost / max) * 100}%` }} />
              <div className={`w-1/3 rounded-t transition group-hover:brightness-125 ${d.profit >= 0 ? 'bg-emerald-500/80' : 'bg-red-500/80'}`} style={{ height: `${(Math.abs(d.profit) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        {data.map((d) => <div key={d.label} className="flex-1 text-center text-[11px] text-zinc-500">{d.label}</div>)}
      </div>
      <div className="flex gap-5 mt-4 text-[12px] text-zinc-400 justify-center">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-brand-500" /> المبيعات</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-ink-500" /> التكلفة + المصروفات</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded bg-emerald-500" /> صافي الربح</span>
      </div>
    </div>
  )
}

export function Donut({ parts, size = 160 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  let acc = 0
  const R = 60, C = 2 * Math.PI * R
  return (
    <svg viewBox="0 0 160 160" width={size} height={size}>
      <circle cx="80" cy="80" r={R} fill="none" stroke="#24242A" strokeWidth="18" />
      {parts.map((p) => {
        const len = (p.value / total) * C
        const el = <circle key={p.label} cx="80" cy="80" r={R} fill="none" stroke={p.color} strokeWidth="18"
          strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)" />
        acc += len
        return el
      })}
    </svg>
  )
}
