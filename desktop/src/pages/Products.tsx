import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, Plus, Pencil, Tags, Barcode as BarcodeIcon, ImagePlus, Download, LayoutGrid, List, Printer, Trash2, RefreshCcw } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, SearchBox, Money, Badge, Empty, Loading, Modal, Field, Tabs, NoAccess } from '../components/ui'
import { ProductArt } from '../components/art'
import { printDoc, LabelsDoc, Barcode } from '../components/Print'
import { usd, qty, num, downloadCSV } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Products() {
  const { db, can, rate } = useApp()
  const [sp] = useSearchParams()
  const [term, setTerm] = useState('')
  const [cat, setCat] = useState('')
  const [low, setLow] = useState(sp.get('low') === '1')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [edit, setEdit] = useState<Row | null>(null)
  const [cats, setCatsOpen] = useState(false)
  const [labels, setLabels] = useState(false)

  const categories = useLoad(() => db.list('categories', { order: [{ col: 'sort' }] }), [], ['categories'])
  const { data, loading } = useLoad(() => db.list('v_products', {
    eq: cat ? { category_id: cat } : {},
    search: term ? { cols: ['name', 'code', 'barcode', 'model'], term } : undefined,
    order: [{ col: 'code' }],
  }), [term, cat], ['products'])
  const rows = useMemo(() => (data ?? []).filter((p: any) => !low || Number(p.qty_on_hand) <= Number(p.min_qty)), [data, low])
  const value = rows.reduce((s: number, p: any) => s + Number(p.qty_on_hand) * Number(p.cost_usd), 0)

  if (!can('products')) return <NoAccess />

  return (
    <>
      <PageHeader title="الأصناف" subtitle={`${rows.length} صنف · قيمة المخزون ${usd(value)} ≈ ${num(value * (rate ?? 0))} ج.س`} icon={<Package size={22} />}
        actions={<>
          <button className="btn-ghost" onClick={() => downloadCSV('الأصناف', rows, [
            { key: 'code', label: 'الكود' }, { key: 'barcode', label: 'الباركود' }, { key: 'name', label: 'الاسم' }, { key: 'model', label: 'الموديل' },
            { key: 'category_name', label: 'القسم' }, { key: 'cost_usd', label: 'التكلفة $' }, { key: 'price_usd', label: 'السعر $' },
            { key: 'price_sdg', label: 'السعر ج.س' }, { key: 'qty_on_hand', label: 'الباقي' }, { key: 'sold_qty', label: 'المباع' }])}><Download size={17} /> CSV</button>
          {can('products', 'print') && <button className="btn-ghost" onClick={() => setLabels(true)}><BarcodeIcon size={17} /> طباعة باركود</button>}
          {can('products', 'create') && <button className="btn-ghost" onClick={() => setCatsOpen(true)}><Tags size={17} /> الأقسام</button>}
          {can('products', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> صنف جديد</button>}
        </>} />

      <div className="flex items-center gap-3 mb-4">
        <SearchBox value={term} onChange={setTerm} placeholder="الاسم أو الكود أو الباركود أو الموديل" className="w-96" autoFocus />
        <select className="input w-60 h-11" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">كل الأقسام</option>
          {(categories.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"><input type="checkbox" className="accent-orange-500 w-4 h-4" checked={low} onChange={(e) => setLow(e.target.checked)} /> اللي قربت تخلص بس</label>
        <div className="mr-auto"><Tabs value={view} onChange={setView} items={[{ key: 'list', label: <List size={16} /> }, { key: 'grid', label: <LayoutGrid size={16} /> }]} /></div>
      </div>

      {loading ? <Loading /> : !rows.length ? <div className="card"><Empty text="ضيف أول صنف أو غيّر البحث" /></div> : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {rows.map((p: any) => (
            <button key={p.id} onClick={() => can('products', 'edit') && setEdit(p)} className="card overflow-hidden text-right hover:border-brand-500/40 transition group">
              <div className="aspect-[4/3] bg-ink-900 relative overflow-hidden">
                {p.image ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" /> : <ProductArt name={p.name} className="w-full h-full p-8" />}
                <span className="absolute top-2 left-2 chip bg-ink-950/80 backdrop-blur num">{p.code}</span>
                {Number(p.qty_on_hand) <= Number(p.min_qty) && <span className="absolute top-2 right-2 chip bg-red-500/80 text-white">قرب يخلص</span>}
              </div>
              <div className="p-4">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-[12px] text-zinc-500 truncate">{p.category_name} · {p.model}</div>
                <div className="flex items-end justify-between mt-3">
                  <div><Money v={p.price_sdg} className="font-bold text-brand-300" /><div className="text-[11px] text-zinc-500 num">{usd(p.price_usd)}</div></div>
                  <div className="text-left"><div className="num text-lg font-black">{qty(p.qty_on_hand)}</div><div className="text-[10px] text-zinc-500">في المخزن</div></div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
            <table className="tbl">
              <thead><tr><th className="w-14"></th><th>الكود</th><th>الصنف</th><th>القسم</th><th>التكلفة</th><th>الربح</th><th>السعر $</th><th>السعر ج.س</th><th>الكلي</th><th>المباع</th><th>المسحوب</th><th>الباقي</th><th></th></tr></thead>
              <tbody>
                {rows.map((p: any) => (
                  <tr key={p.id}>
                    <td className="py-2">{p.image ? <img src={p.image} className="w-10 h-10 rounded-lg object-cover" /> : <ProductArt name={p.name} className="w-10 h-10" />}</td>
                    <td className="num"><div>{p.code}</div><div className="text-[10px] text-zinc-500">{p.barcode}</div></td>
                    <td><div className="font-semibold">{p.name}</div><div className="text-[12px] text-zinc-500" dir="ltr">{p.model}</div></td>
                    <td className="text-zinc-400 text-[13px]">{p.category_name}</td>
                    <td className="num text-zinc-400">{usd(p.cost_usd)}</td>
                    <td className="num text-emerald-300">{num(p.margin_pct, 1)}%</td>
                    <td className="num">{usd(p.price_usd)}</td>
                    <td><Money v={p.price_sdg} className="font-bold" /></td>
                    <td className="num">{qty(p.total_in)}</td>
                    <td className="num">{qty(p.sold_qty)}</td>
                    <td className="num text-sky-300">{qty(p.withdrawn_qty)}</td>
                    <td><Badge cls={Number(p.qty_on_hand) <= Number(p.min_qty) ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}>{qty(p.qty_on_hand)}</Badge></td>
                    <td>{can('products', 'edit') && <button onClick={() => setEdit(p)} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700"><Pencil size={16} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && <ProductForm p={edit} cats={categories.data ?? []} onClose={() => setEdit(null)} />}
      <CategoriesModal open={cats} onClose={() => setCatsOpen(false)} />
      <LabelsModal open={labels} onClose={() => setLabels(false)} products={rows} />
    </>
  )
}

// تصغير الصورة قبل الحفظ عشان الداتا بيز تفضل خفيفة
async function resizeImage(file: File, max = 420): Promise<string> {
  const img = new Image()
  img.src = URL.createObjectURL(file)
  await img.decode()
  const s = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(img.src)
  return c.toDataURL('image/jpeg', 0.8)
}

function ProductForm({ p, cats, onClose }: { p: Row; cats: Row[]; onClose: () => void }) {
  const { db, rate, can } = useApp()
  const { busy, run } = useAction()
  const isNew = !p.id
  const [f, setF] = useState<Row>({
    code: '', barcode: '', name: '', model: '', category_id: '', unit: 'قطعة', cost_usd: '', margin_pct: '30', price_usd: '',
    auto_price: true, min_qty: '2', image: null, notes: '', is_active: true, opening: '', ...p,
  })
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }))
  useEffect(() => {
    if (isNew && !f.code) db.list('products', { order: [{ col: 'code', asc: false }], limit: 1 }).then((r) => {
      const last = Number(r[0]?.code)
      if (!isNaN(last)) setF((x) => ({ ...x, code: String(last + 1), barcode: '622' + String(last + 1).padStart(9, '0') }))
    })
  }, [db, isNew, f.code])
  const price = f.auto_price ? Math.round(Number(f.cost_usd || 0) * (1 + Number(f.margin_pct || 0) / 100) * 100) / 100 : Number(f.price_usd || 0)

  const save = async () => {
    const row: Row = {
      code: String(f.code).trim(), barcode: String(f.barcode ?? '').trim() || null, name: f.name.trim(), model: f.model || null,
      category_id: f.category_id || null, unit: f.unit || 'قطعة', cost_usd: Number(f.cost_usd || 0), margin_pct: Number(f.margin_pct || 0),
      price_usd: price, auto_price: !!f.auto_price, min_qty: Number(f.min_qty || 0), image: f.image || null, notes: f.notes || null, is_active: !!f.is_active,
    }
    const ok = await run(async () => {
      if (isNew) {
        const [created] = await db.insert('products', row)
        if (Number(f.opening) > 0) await db.rpc('adjust_stock', { p_product: created.id, p_new_qty: Number(f.opening), p_note: 'رصيد افتتاحي', p_opening: true })
      } else await db.update('products', p.id, row)
      return true
    }, isNew ? 'الصنف اتضاف' : 'اتحفظ التعديل')
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={isNew ? 'صنف جديد' : `تعديل: ${p.name}`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.name || !f.code} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-[200px_1fr] gap-6">
        <div>
          <label className="block aspect-square rounded-2xl border-2 border-dashed border-ink-600 hover:border-brand-500/60 bg-ink-900 overflow-hidden cursor-pointer relative group">
            {f.image ? <img src={f.image} className="w-full h-full object-cover" /> : <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2"><ImagePlus size={30} /><span className="text-sm">صورة الصنف</span></div>}
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) set('image', await resizeImage(file)) }} />
          </label>
          {f.image && <button className="text-[12px] text-red-300 mt-2 flex items-center gap-1" onClick={() => set('image', null)}><Trash2 size={13} /> شيل الصورة</button>}
          {(f.barcode || f.code) && <div className="mt-4 bg-white rounded-xl p-3 text-center"><Barcode value={f.barcode || f.code} height={40} /><div className="text-black text-[11px] num">{f.barcode || f.code}</div></div>}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="الكود *"><input className="input num" value={f.code} onChange={(e) => set('code', e.target.value)} /></Field>
            <Field label="الباركود">
              <div className="flex gap-1"><input className="input num" dir="ltr" value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} />
                <button className="btn-ghost w-11 px-0 shrink-0" title="باركود تلقائي" onClick={() => set('barcode', '622' + String(f.code || Date.now()).padStart(9, '0').slice(-9))}><RefreshCcw size={15} /></button></div>
            </Field>
            <Field label="الموديل"><input className="input" dir="ltr" value={f.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
          </div>
          <Field label="اسم الصنف *"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="القسم" className="col-span-2"><select className="input" value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="الوحدة"><input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></Field>
          </div>
          <div className="rounded-2xl border border-ink-700 p-4 bg-ink-900/50 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm">التسعير بالدولار</div>
              <label className="flex items-center gap-2 text-[13px] text-zinc-300"><input type="checkbox" className="accent-orange-500" checked={f.auto_price} onChange={(e) => set('auto_price', e.target.checked)} /> السعر = التكلفة + نسبة الربح</label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="التكلفة النهائية $" hint="بتتحدث لوحدها مع كل مشتريات"><input className="input num" value={f.cost_usd} onChange={(e) => set('cost_usd', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              <Field label="نسبة الربح %"><input className="input num" value={f.margin_pct} onChange={(e) => set('margin_pct', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              <Field label="سعر البيع $"><input className="input num" disabled={f.auto_price} value={f.auto_price ? price : f.price_usd} onChange={(e) => set('price_usd', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            </div>
            <div className="flex justify-between text-sm"><span className="text-zinc-400">بالجنيه على ريت النهارده</span><Money v={price * (rate ?? 0)} className="font-bold text-brand-300" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="حد التنبيه (أقل كمية)"><input className="input num" value={f.min_qty} onChange={(e) => set('min_qty', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            {isNew && can('stock', 'edit') && <Field label="رصيد افتتاحي"><input className="input num" value={f.opening} onChange={(e) => set('opening', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></Field>}
            {!isNew && <Field label="الحالة"><select className="input" value={f.is_active ? '1' : '0'} onChange={(e) => set('is_active', e.target.value === '1')}><option value="1">نشط</option><option value="0">موقوف</option></select></Field>}
          </div>
          <Field label="ملاحظات"><input className="input" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  )
}

function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, can } = useApp()
  const { run } = useAction()
  const { data, reload } = useLoad(() => db.list('categories', { order: [{ col: 'sort' }] }), [open], ['categories'])
  const [name, setName] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="أقسام المنتجات" width="max-w-lg">
      <div className="flex gap-2 mb-4">
        <input className="input" placeholder="اسم القسم الجديد" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" disabled={!name.trim()} onClick={async () => { await run(() => db.insert('categories', { name: name.trim(), sort: (data?.length ?? 0) + 1 }), 'القسم اتضاف'); setName(''); reload() }}><Plus size={17} /> إضافة</button>
      </div>
      <div className="space-y-1 max-h-96 overflow-auto">
        {(data ?? []).map((c: any) => (
          <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-ink-800">
            <span>{c.name}</span>
            {can('settings', 'edit') && <button className="p-1.5 text-zinc-500 hover:text-red-300" onClick={async () => { await run(() => db.remove('categories', c.id), 'اتحذف'); reload() }}><Trash2 size={15} /></button>}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function LabelsModal({ open, onClose, products }: { open: boolean; onClose: () => void; products: Row[] }) {
  const { settings } = useApp()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [term, setTerm] = useState('')
  const list = products.filter((p) => !term || p.name.includes(term) || String(p.code).includes(term))
  const chosen = products.filter((p) => counts[p.id] > 0).map((p) => ({ p, count: counts[p.id] }))
  return (
    <Modal open={open} onClose={onClose} title="طباعة ملصقات باركود" subtitle="اختار الأصناف وعدد الملصقات لكل صنف (3 في الصف على ورق A4)" width="max-w-2xl"
      footer={<><span className="ml-auto text-sm text-zinc-400 num">{chosen.reduce((s, c) => s + c.count, 0)} ملصق</span>
        <button className="btn-primary" disabled={!chosen.length} onClick={() => printDoc(<LabelsDoc items={chosen} settings={settings} />)}><Printer size={17} /> طباعة</button></>}>
      <SearchBox value={term} onChange={setTerm} className="mb-3" />
      <div className="max-h-96 overflow-auto space-y-1">
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-800">
            <span className="num text-zinc-500 w-14">{p.code}</span><span className="flex-1 truncate">{p.name}</span>
            <button className="text-[12px] text-brand-400" onClick={() => setCounts((c) => ({ ...c, [p.id]: Math.max(1, Number(p.qty_on_hand)) }))}>بعدد المخزن</button>
            <input className="input h-9 w-20 num text-center" value={counts[p.id] ?? ''} placeholder="0" onChange={(e) => setCounts((c) => ({ ...c, [p.id]: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
          </div>
        ))}
      </div>
    </Modal>
  )
}
