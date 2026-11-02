import { useState } from 'react'
import { Factory, Plus, Pencil } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, SearchBox, Money, Empty, Loading, Modal, Field, NoAccess } from '../components/ui'
import type { Row } from '../lib/backend'

export default function Suppliers() {
  const { db, can } = useApp()
  const [term, setTerm] = useState('')
  const [edit, setEdit] = useState<Row | null>(null)
  const { data, loading } = useLoad(() => db.list('v_supplier_balances', {
    search: term ? { cols: ['name', 'phone', 'country'], term } : undefined, order: [{ col: 'name' }],
  }), [term], ['suppliers', 'purchases', 'payments'])
  if (!can('suppliers')) return <NoAccess />
  const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.balance), 0)
  return (
    <>
      <PageHeader title="الموردون" subtitle={<>إجمالي المستحق للموردين: <Money v={total} className="text-red-300 font-bold" /></>} icon={<Factory size={22} />}
        actions={can('suppliers', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> مورد جديد</button>} />
      <SearchBox value={term} onChange={setTerm} className="w-96 mb-4" />
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !data?.length ? <Empty /> : (
          <table className="tbl">
            <thead><tr><th>المورد</th><th>البلد</th><th>الهاتف</th><th>إجمالي المشتريات</th><th>المستحق له</th><th></th></tr></thead>
            <tbody>{data.map((s: any) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.name}</td><td className="text-zinc-400">{s.country}</td><td className="num" dir="ltr">{s.phone}</td>
                <td><Money v={s.total_purchases} /></td>
                <td><Money v={s.balance} className={Number(s.balance) > 0 ? 'text-red-300 font-bold' : 'text-emerald-300'} /></td>
                <td>{can('suppliers', 'edit') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" onClick={() => setEdit(s)}><Pencil size={16} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <PartyForm table="suppliers" row={edit} onClose={() => setEdit(null)} extra />}
    </>
  )
}

export function PartyForm({ table, row, onClose, extra }: { table: 'suppliers' | 'customers'; row: Row; onClose: () => void; extra?: boolean }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<Row>({ name: '', phone: '', address: '', notes: '', ...(extra ? { country: '', opening_balance: 0 } : {}), ...row })
  const save = async () => {
    const body: Row = { name: f.name.trim(), phone: f.phone || null, address: f.address || null, notes: f.notes || null }
    if (extra) { body.country = f.country || null; body.opening_balance = Number(f.opening_balance) || 0 }
    const ok = await run(() => (row.id ? db.update(table, row.id, body) : db.insert(table, body)), 'تم الحفظ')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-lg" title={row.id ? `تعديل: ${row.name}` : table === 'suppliers' ? 'مورد جديد' : 'عميل جديد'}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.name?.trim()} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاسم *" className="col-span-2"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الهاتف"><input className="input num" dir="ltr" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {extra ? <Field label="البلد"><input className="input" value={f.country ?? ''} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
          : <Field label="العنوان"><input className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>}
        {extra && <Field label="رصيد سابق مستحق له (ج.س)" className="col-span-2"><input className="input num" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} /></Field>}
        <Field label="ملاحظات" className="col-span-2"><input className="input" value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
