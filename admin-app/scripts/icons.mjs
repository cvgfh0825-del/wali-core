// يحوّل اللوجو SVG لصور PNG بالمقاسات اللي الآيفون وويندوز محتاجينها
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
const svg = readFileSync('../desktop/public/icon.svg', 'utf8')
// نسخة مربعة من غير زوايا شفافة للآيفون (iOS بيدوّر الزوايا لوحده)
const full = svg.replace('<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>', '<rect width="256" height="256" fill="url(#bg)"/>')
  .replace(/<rect x="8\.5"[^>]*\/>/, '')
const out = (s, w, path) => writeFileSync(path, new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng())
out(full, 180, 'public/icons/apple-touch-icon.png')
out(full, 192, 'public/icons/icon-192.png')
out(full, 512, 'public/icons/icon-512.png')
out(svg, 512, '../desktop/build/icon.png')
writeFileSync('public/icons/icon.svg', svg)
console.log('icons ok')
