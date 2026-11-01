import { useState } from 'react'
import { Receipt, Plus, Trash2, HeartHandshake } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Money, Empty, Loading, Modal, Field, Badge, useConfirm, NoAccess } from '../components/ui'
import { BarList } from '../components/charts'
import { date, daysAgo, today } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Expenses() {
  const { db, can, isAdmin } = useApp()
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [cat, setCat] = useState('')
  const [adding, setAdding] = useState(false)
  const { run } = useAction()
  const confirm = useConfirm()
  const cats = useLoad(() => db.list('expense_categories', { order: [{ col: 'sort' }] }), [], ['expense_categories'])
  const { data, loading } = useLoad(() => db.list('v_expenses', {
    eq: cat ? { category_id: cat } : {}, gte: { expense_date: from }, lte: { expense_date: to }, order: [{ col: 'expense_date', asc: false }],
  }), [from, to, cat], ['expenses'])
  if (!can('expenses')) return <NoAccess />
  const rows = data ?? []
  const total = rows.reduce((s: number, r: any) => s + Number(r.amount_sdg), 0)
  const byCat = Object.values(rows.reduce((m: any, r: any) => { m[r.category_name] = m[r.category_name] ?? { label: r.category_name, value: 0 }; m[r.category_name].value += Number(r.amount_sdg); return m }, {})) as any[]

  return (
    <>
      <PageHeader title="المصروفات" subtitle={<>إجمالي الفترة: <Money v={total} className="font-bold text-zinc-100" /></>} icon={<Receipt size={22} />}
        actions={can('expenses', 'create') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={18} /> مصروف</button>} />
      <div className="flex items-center gap-3 mb-4">
        <select className="input w-64 h-11" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">كل البنود</option>{(cats.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input type="date" className="input h-11 w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input h-11 w-44" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="card overflow-hidden">
          {loading ? <Loading /> : !rows.length ? <Empty /> : (
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>البند</th><th>البيان</th><th>المبلغ</th><th>بواسطة</th><th></th></tr></thead>
              <tbody>{rows.map((e: any) => (
                <tr key={e.id}>
                  <td className="text-zinc-400">{date(e.expense_date)}</td>
                  <td><Badge cls={e.category_kind === 'social' ? 'bg-pink-500/15 text-pink-300' : e.category_kind === 'cost' ? 'bg-sky-500/15 text-sky-300' : 'bg-ink-700 text-zinc-300'}>
                    {e.category_kind === 'social' && <HeartHandshake size={12} />}{e.category_name}</Badge></td>
                  <td className="text-zinc-300">{e.description}</td>
                  <td><Money v={e.amount_sdg} className="font-bold" /></td>
                  <td className="text-zinc-500">{e.created_by_name}</td>
                  <td>{isAdmin && !e.ref_type && <button className="p-2 text-zinc-500 hover:text-red-300" onClick={async () => { if (await confirm.ask('حذف المصروف ده؟', { danger: true })) await run(() => db.remove('expenses', e.id), 'اتحذف') }}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card p-5 h-fit">
          <div className="font-bold mb-4">حسب البند</div>
          {byCat.length ? <BarList items={byCat.sort((a, b) => b.value - a.value)} /> : <Empty />}
        </div>
      </div>
      {adding && <NewExpense cats={cats.data ?? []} onClose={() => setAdding(false)} />}
      {confirm.node}
    </>
  )
}

function NewExpense({ cats, onClose }: { cats: Row[]; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Row>({ category_id: '', amount_sdg: '', expense_date: today(), description: '' })
  const [newCat, setNewCat] = useState('')
  const save = async () => {
    const ok = await run(async () => {
      let category_id = f.category_id
      if (category_id === '__new') category_id = (await db.insert('expense_categories', { name: newCat.trim() }))[0].id
      return db.insert('expenses', { category_id, amount_sdg: Number(f.amount_sdg), expense_date: f.expense_date, description: f.description || null })
    }, 'المصروف اتسجل')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-lg" title="مصروف جديد"
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.category_id || !(Number(f.amount_sdg) > 0)} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="البند" className="col-span-2"><select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
          <option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ بند جديد</option></select></Field>
        {f.category_id === '__new' && <Field label="اسم البند الجديد" className="col-span-2"><input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} /></Field>}
        <Field label="المبلغ (ج.س)"><input className="input num" autoFocus value={f.amount_sdg} onChange={(e) => setF({ ...f, amount_sdg: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
        <Field label="البيان" className="col-span-2"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
