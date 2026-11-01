import { useState } from 'react'
import { Users, Plus, Pencil, FileText } from 'lucide-react'
import { useApp, useLoad } from '../lib/app'
import { PageHeader, SearchBox, Money, Empty, Loading, Modal, Badge, NoAccess } from '../components/ui'
import { PartyForm } from './Suppliers'
import { InvoiceDrawer } from './Invoices'
import { STATUS, date } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Customers() {
  const { db, can } = useApp()
  const [term, setTerm] = useState('')
  const [edit, setEdit] = useState<Row | null>(null)
  const [stmt, setStmt] = useState<Row | null>(null)
  const { data, loading } = useLoad(() => db.list(can('sales') ? 'v_customer_balances' : 'customers', {
    search: term ? { cols: ['name', 'phone'], term } : undefined, order: [{ col: 'name' }],
  }), [term], ['customers', 'invoices', 'payments'])
  if (!can('customers')) return <NoAccess />
  const total = (data ?? []).reduce((s: number, r: any) => s + Number(r.balance ?? 0), 0)
  return (
    <>
      <PageHeader title="العملاء" subtitle={can('sales') ? <>المستحق على العملاء: <Money v={total} className="text-amber-300 font-bold" /></> : undefined} icon={<Users size={22} />}
        actions={can('customers', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> عميل جديد</button>} />
      <SearchBox value={term} onChange={setTerm} placeholder="الاسم أو الموبايل" className="w-96 mb-4" />
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !data?.length ? <Empty /> : (
          <table className="tbl">
            <thead><tr><th>العميل</th><th>الموبايل</th><th>العنوان</th>{can('sales') && <><th>الفواتير</th><th>إجمالي المشتريات</th><th>عليه</th></>}<th></th></tr></thead>
            <tbody>{data.map((c: any) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.name}</td><td className="num" dir="ltr">{c.phone}</td><td className="text-zinc-400">{c.address}</td>
                {can('sales') && <><td className="num">{c.invoices_count}</td><td><Money v={c.total_sales} /></td>
                  <td>{Number(c.balance) > 0 ? <Money v={c.balance} className="text-amber-300 font-bold" /> : <Badge cls="bg-emerald-500/15 text-emerald-300">خالص</Badge>}</td></>}
                <td className="flex gap-1">
                  {can('sales') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" title="كشف حساب" onClick={() => setStmt(c)}><FileText size={16} /></button>}
                  {can('customers', 'edit') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" onClick={() => setEdit(c)}><Pencil size={16} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <PartyForm table="customers" row={edit} onClose={() => setEdit(null)} />}
      {stmt && <Statement c={stmt} onClose={() => setStmt(null)} />}
    </>
  )
}

function Statement({ c, onClose }: { c: Row; onClose: () => void }) {
  const { db } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const { data } = useLoad(() => db.list('v_invoices', { eq: { customer_id: c.id }, order: [{ col: 'created_at', asc: false }] }), [c.id])
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={`كشف حساب: ${c.name}`} subtitle={<>عليه <Money v={c.balance} /> من إجمالي <Money v={c.total_sales} /></>}>
      <table className="tbl">
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>الحالة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
        <tbody>{(data ?? []).map((i: any) => (
          <tr key={i.id} className="cursor-pointer" onClick={() => setOpen(i.id)}>
            <td className="num" dir="ltr">{i.number}</td><td>{date(i.invoice_date)}</td><td><Badge cls={STATUS[i.status].cls}>{STATUS[i.status].label}</Badge></td>
            <td><Money v={i.total_sdg} /></td><td><Money v={i.paid_sdg} cur={false} /></td>
            <td>{i.kind === 'final' && i.status === 'posted' ? <Money v={i.remaining_sdg} className={Number(i.remaining_sdg) > 0 ? 'text-amber-300' : ''} /> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {open && <InvoiceDrawer id={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </Modal>
  )
}
