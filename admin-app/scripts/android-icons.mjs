// أيقونات تطبيق الأندرويد: أيقونة التطبيق (adaptive) + أيقونة الإشعار الصغيرة (أبيض على شفاف)
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
const res = 'android/app/src/main/res'
const svg = readFileSync('public/icons/icon.svg', 'utf8')
const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)[0]
const W = (stroke, dot) => `<path d="M52 78 L88 186 L128 104 L168 186 L204 78" fill="none" stroke="${stroke}" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/><circle cx="128" cy="56" r="13" fill="${dot}"/>`
// المقدمة في المنطقة الآمنة (66 من 108) — بنصغّر الحرف في النص
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${defs}<g transform="translate(128 128) scale(.58) translate(-128 -122)">${W('url(#w)', '#FF7A1A')}</g></svg>`
const full = svg.replace('<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>', '<rect width="256" height="256" fill="url(#bg)"/>').replace(/<rect x="8\.5"[^>]*\/>/, '')
const round = full.replace('<rect width="256" height="256" fill="url(#bg)"/>', '<circle cx="128" cy="128" r="128" fill="url(#bg)"/>')
const small = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(128 128) scale(.9) translate(-128 -122)">${W('#fff', '#fff')}</g></svg>`
const png = (s, w) => new Resvg(s, { fitTo: { mode: 'width', value: w } }).render().asPng()
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(dens)) {
  mkdirSync(`${res}/mipmap-${d}`, { recursive: true }); mkdirSync(`${res}/drawable-${d}`, { recursive: true })
  writeFileSync(`${res}/mipmap-${d}/ic_launcher.png`, png(full, 48 * k))
  writeFileSync(`${res}/mipmap-${d}/ic_launcher_round.png`, png(round, 48 * k))
  writeFileSync(`${res}/mipmap-${d}/ic_launcher_foreground.png`, png(fg, 108 * k))
  writeFileSync(`${res}/drawable-${d}/ic_stat_wali.png`, png(small, 24 * k))
}
writeFileSync(`${res}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#111114</color>\n    <color name="wali_orange">#FF7A1A</color>\n</resources>\n')
console.log('android icons ok')

// شاشة البداية: اللوجو في النص على خلفية سودا، بنفس مقاسات ملفات Capacitor
import { readdirSync } from 'node:fs'
for (const d of readdirSync(res).filter((x) => x.startsWith('drawable'))) {
  const f = `${res}/${d}/splash.png`
  let b; try { b = readFileSync(f) } catch { continue }
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), s = Math.min(w, h) * 0.28
  const sp = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#070708"/><svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 256 256">${svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')}</svg></svg>`
  writeFileSync(f, new Resvg(sp).render().asPng())
}
console.log('splash ok')
