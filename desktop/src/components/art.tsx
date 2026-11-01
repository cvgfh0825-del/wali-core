// رسومات خطية بهوية والي بلازا (أسود وبرتقالي)
type P = { className?: string }

export function DeskScene({ className = '' }: P) {
  return (
    <svg viewBox="0 0 520 420" className={className} fill="none">
      <defs>
        <linearGradient id="ds-o" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFB066" /><stop offset="1" stopColor="#E8530A" /></linearGradient>
        <radialGradient id="ds-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#FF7A1A" stopOpacity=".35" /><stop offset="1" stopColor="#FF7A1A" stopOpacity="0" /></radialGradient>
        <linearGradient id="ds-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E2E35" /><stop offset="1" stopColor="#16161A" /></linearGradient>
      </defs>
      <ellipse cx="260" cy="330" rx="250" ry="60" fill="url(#ds-glow)" />
      {/* رف خلفي */}
      <g stroke="#3D3D46" strokeWidth="2">
        <rect x="70" y="40" width="380" height="150" rx="10" fill="#111114" />
        <line x1="70" y1="90" x2="450" y2="90" /><line x1="70" y1="140" x2="450" y2="140" />
        <line x1="196" y1="40" x2="196" y2="190" /><line x1="323" y1="40" x2="323" y2="190" />
      </g>
      <g fill="#FF7A1A" opacity=".85">
        <rect x="88" y="56" width="10" height="30" rx="2" /><rect x="102" y="62" width="10" height="24" rx="2" opacity=".6" /><rect x="116" y="52" width="10" height="34" rx="2" opacity=".4" />
      </g>
      <circle cx="390" cy="115" r="16" stroke="url(#ds-o)" strokeWidth="3" />
      <path d="M380 165 q10 -30 20 0" stroke="#FF7A1A" strokeWidth="3" />
      <rect x="215" y="150" width="40" height="34" rx="3" stroke="#FFB066" strokeWidth="2" />
      {/* المكتب */}
      <path d="M40 240 H480 L470 262 H50 Z" fill="url(#ds-top)" stroke="#FF7A1A" strokeWidth="2.5" />
      <rect x="62" y="262" width="150" height="100" rx="6" fill="#16161A" stroke="#3D3D46" strokeWidth="2" />
      <line x1="62" y1="295" x2="212" y2="295" stroke="#3D3D46" strokeWidth="2" />
      <line x1="62" y1="328" x2="212" y2="328" stroke="#3D3D46" strokeWidth="2" />
      <rect x="122" y="276" width="30" height="5" rx="2.5" fill="#FF7A1A" />
      <rect x="122" y="309" width="30" height="5" rx="2.5" fill="#FF7A1A" opacity=".7" />
      <rect x="122" y="342" width="30" height="5" rx="2.5" fill="#FF7A1A" opacity=".5" />
      <path d="M440 262 V362" stroke="#FF7A1A" strokeWidth="5" strokeLinecap="round" />
      {/* شاشة */}
      <rect x="300" y="168" width="110" height="68" rx="6" fill="#0C0C0E" stroke="#3D3D46" strokeWidth="2" />
      <path d="M314 220 L334 204 L350 212 L372 190 L396 198" stroke="url(#ds-o)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M345 236 L340 240 H370 L365 236" stroke="#3D3D46" strokeWidth="2" />
      {/* كرسي */}
      <g transform="translate(250 200)">
        <path d="M-40 -60 Q-44 10 -30 40 H30 Q44 10 40 -60 Q0 -78 -40 -60Z" fill="#1C1C21" stroke="url(#ds-o)" strokeWidth="3" />
        <path d="M-26 -44 Q0 -54 26 -44" stroke="#FF7A1A" strokeWidth="2" opacity=".5" />
      </g>
    </svg>
  )
}

export function EmptyArt({ className = '' }: P) {
  return (
    <svg viewBox="0 0 200 140" className={className} fill="none">
      <ellipse cx="100" cy="122" rx="80" ry="10" fill="#FF7A1A" opacity=".08" />
      <path d="M40 60 L100 36 L160 60 L100 84 Z" fill="#1C1C21" stroke="#3D3D46" strokeWidth="2" />
      <path d="M40 60 V100 L100 124 V84" fill="#16161A" stroke="#3D3D46" strokeWidth="2" />
      <path d="M160 60 V100 L100 124" fill="#111114" stroke="#3D3D46" strokeWidth="2" />
      <path d="M70 48 L130 72" stroke="#FF7A1A" strokeWidth="3" strokeLinecap="round" />
      <circle cx="150" cy="30" r="5" fill="#FF7A1A" />
      <circle cx="40" cy="26" r="3" fill="#FF7A1A" opacity=".5" />
      <circle cx="172" cy="44" r="2" fill="#FF7A1A" opacity=".5" />
    </svg>
  )
}

// صورة افتراضية للأصناف حسب نوعها
export function ProductArt({ name = '', className = '' }: { name?: string; className?: string }) {
  const kind = /كرسي|فوتيه/.test(name) ? 'chair' : /كنب|جلوس/.test(name) ? 'sofa' : /خزن|كابين|دولاب|لوكر/.test(name) ? 'cabinet' : /صوت|ميكروفون/.test(name) ? 'sound' : 'desk'
  return (
    <svg viewBox="0 0 80 80" className={className} fill="none">
      <rect width="80" height="80" rx="16" fill="#16161A" />
      <g stroke="#FF7A1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'desk' && <><path d="M14 36 H66" /><path d="M18 36 V60 M62 36 V60" /><rect x="22" y="40" width="16" height="14" rx="2" stroke="#FFB066" /><rect x="44" y="22" width="16" height="12" rx="2" opacity=".6" /></>}
        {kind === 'chair' && <><path d="M28 18 Q26 40 30 46 H50 Q54 40 52 18 Q40 12 28 18Z" /><path d="M30 46 V52 H50 V46 M40 52 V60 M30 64 L40 60 L50 64" stroke="#FFB066" /></>}
        {kind === 'sofa' && <><path d="M14 38 Q14 30 22 30 H58 Q66 30 66 38 V52 H14Z" /><path d="M10 40 V56 H70 V40" stroke="#FFB066" /><path d="M18 56 V62 M62 56 V62" /></>}
        {kind === 'cabinet' && <><rect x="22" y="14" width="36" height="52" rx="3" /><path d="M22 31 H58 M22 48 H58" stroke="#FFB066" /><path d="M36 22 H44 M36 39 H44 M36 56 H44" /></>}
        {kind === 'sound' && <><path d="M34 20 a6 6 0 0 1 12 0 V36 a6 6 0 0 1 -12 0Z" /><path d="M28 34 a12 12 0 0 0 24 0 M40 46 V58 M32 60 H48" stroke="#FFB066" /></>}
      </g>
    </svg>
  )
}
