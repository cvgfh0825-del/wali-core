import { useEffect, useState } from 'react'
import { useApp } from '../lib/app'
import { productImage, cachedImage } from '../lib/images'
import { ProductArt } from './art'

// صورة الصنف من الكاش، ولو مفيش صورة بنرسم رسمة حسب نوع الصنف
export function ProductImage({ p, className = '', artClassName }: { p: { id: string; name?: string; image_v?: number }; className?: string; artClassName?: string }) {
  const { db } = useApp()
  const [src, setSrc] = useState<string | null>(() => cachedImage(p.id, p.image_v))
  useEffect(() => {
    let live = true
    setSrc(cachedImage(p.id, p.image_v))
    if (p.image_v) productImage(db, p.id, p.image_v).then((s) => live && setSrc(s))
    return () => { live = false }
  }, [db, p.id, p.image_v])
  return src ? <img src={src} className={className} loading="lazy" /> : <ProductArt name={p.name} className={artClassName ?? className} />
}
