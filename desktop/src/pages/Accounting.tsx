import { useState } from 'react'
import { Wallet, ArrowDownLeft, ArrowUpRight, Plus, Printer, Download } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Tabs, Money, Badge, Empty, Loading, Modal, Field, Segmented, Stat, NoAccess } from '../components/ui'
import { printDoc, ReceiptDoc } from '../components/Print'
import { date, daysAgo, today, METHOD, short, downloadCSV } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Accounting() {
  const { db, can, settings } = useApp()
  const [tab, setTab] = useState<'all' | 'in' | 'out'>('all')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [adding, setAdding] = useState(false)
  const { data, loading } = useLoad(() => db.list('v_payments', {
    eq: tab === 'all' ? {} : { direction: tab }, gte: { pay_date: from }, lte: { pay_date: to }, order: [{ col: 'created_at', asc: false }],
  }), [tab, from, to], ['payments'])
  const recv = useLoad(() => db.list('v_customer_balances', { order: [{ col: 'balance', asc: false }], limit: 8 }), [], ['payments', 'invoices'])
  const pay = useLoad(() => db.list('v_supplier_balances', { order: [{ col: 'balance', asc: false }], limit: 8 }), [], ['payments', 'purchases'])

  if (!can('accounting')) return <NoAccess />
  const rows = data ?? []
  const tin = rows.filter((r: any) => r.direction === 'in').reduce((s: number, r: any) => s + Number(r.amount_sdg), 0)
  const tout = rows.filter((r: any) => r.direction === 'out').reduce((s: number, r: any) => s + Number(r.amount_sdg), 0)

  return (
    <>
      <PageHeader title="المقبوضات والمدفوعات" icon={<Wallet size={22} />}
        actions={<>
          <button className="btn-ghost" onClick={() => downloadCSV('حركة الخزنة', rows, [{ key: 'pay_date', label: 'التاريخ' }, { key: 'direction', label: 'النوع' }, { key: 'amount_sdg', label: 'المبلغ' }, { key: 'customer_name', label: 'العميل' }, { key: 'supplier_name', label: 'المورد' }, { key: 'notes', label: 'البيان' }])}><Download size={17} /> CSV</button>
          {can('accounting', 'create') && <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={18} /> حركة جديدة</button>}
        </>} />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Stat label="المقبوضات" value={short(tin)} icon={<ArrowDownLeft size={20} />} tone="green" />
        <Stat label="المدفوعات" value={short(tout)} icon={<ArrowUpRight size={20} />} tone="red" />
        <Stat accent label="الصافي" value={short(tin - tout)} sub="خلال الفترة" icon={<Wallet size={20} />} />
      </div>
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Tabs value={tab} onChange={setTab} items={[{ key: 'all', label: 'الكل' }, { key: 'in', label: 'مقبوضات' }, { key: 'out', label: 'مدفوعات' }]} />
            <div className="flex items-center gap-2 text-sm text-zinc-400 mr-auto">
              <input type="date" className="input h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" className="input h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="card overflow-hidden">
            {loading ? <Loading /> : !rows.length ? <Empty /> : (
              <div className="max-h-[calc(100vh-380px)] overflow-auto">
                <table className="tbl">
                  <thead><tr><th>التاريخ</th><th>النوع</th><th>الطرف</th><th>المستند</th><th>الطريقة</th><th>المبلغ</th><th>البيان</th><th></th></tr></thead>
                  <tbody>{rows.map((p: any) => (
                    <tr key={p.id}>
                      <td className="text-zinc-400">{date(p.pay_date)}</td>
                      <td>{p.direction === 'in' ? <Badge cls="bg-emerald-500/15 text-emerald-300">قبض</Badge> : <Badge cls="bg-red-500/15 text-red-300">صرف</Badge>}</td>
                      <td>{p.customer_name ?? p.supplier_name ?? '—'}</td>
                      <td className="num text-zinc-400" dir="ltr">{p.invoice_number ?? p.purchase_number ?? ''}</td>
                      <td className="text-zinc-400">{METHOD[p.method]}</td>
                      <td><Money v={p.amount_sdg} className={`font-bold ${p.direction === 'in' ? 'text-emerald-300' : 'text-red-300'}`} /></td>
                      <td className="text-zinc-500 text-[13px] max-w-[220px] truncate">{p.notes}</td>
                      <td><button className="p-2 text-zinc-500 hover:text-white" title="طباعة إيصال" onClick={() => printDoc(<ReceiptDoc p={p} settings={settings} />)}><Printer size={15} /></button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <div className="font-bold mb-3">أكبر المديونيات على العملاء</div>
            {(recv.data ?? []).filter((c: any) => Number(c.balance) > 0).map((c: any) => (
              <div key={c.id} className="flex justify-between text-sm py-2 border-b border-ink-700 last:border-0"><span className="truncate">{c.name}</span><Money v={c.balance} className="text-amber-300" /></div>
            ))}
          </div>
          <div className="card p-5">
            <div className="font-bold mb-3">المستحق للموردين</div>
            {(pay.data ?? []).filter((c: any) => Number(c.balance) > 0).map((c: any) => (
              <div key={c.id} className="flex justify-between text-sm py-2 border-b border-ink-700 last:border-0"><span className="truncate">{c.name}</span><Money v={c.balance} className="text-red-300" /></div>
            ))}
          </div>
        </div>
      </div>
      {adding && <NewPayment onClose={() => setAdding(false)} />}
    </>
  )
}

function NewPayment({ onClose }: { onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [dir, setDir] = useState<'in' | 'out'>('in')
  const [f, setF] = useState<Row>({ party: '', doc: '', amount: '', method: 'cash', notes: '', pay_date: today() })
  const parties = useLoad(() => db.list(dir === 'in' ? 'v_customer_balances' : 'v_supplier_balances', { order: [{ col: 'name' }] }), [dir])
  const docs = useLoad(() => !f.party ? Promise.resolve([]) : dir === 'in'
    ? db.list('v_invoices', { eq: { customer_id: f.party, kind: 'final', status: 'posted' } }).then((r) => r.filter((x: any) => Number(x.remaining_sdg) > 0))
    : db.list('v_purchases', { eq: { supplier_id: f.party, status: 'posted' } }).then((r) => r.filter((x: any) => Number(x.remaining_sdg) > 0)), [dir, f.party])
  const save = async () => {
    const r = await run(() => db.rpc('record_payment', { p: {
      direction: dir, party_type: dir === 'in' ? 'customer' : 'supplier',
      [dir === 'in' ? 'customer_id' : 'supplier_id']: f.party || null,
      [dir === 'in' ? 'invoice_id' : 'purchase_id']: f.doc || null,
      amount_sdg: Number(f.amount), method: f.method, notes: f.notes || null, pay_date: f.pay_date,
    } }), 'سُجِّلت الحركة')
    if (r) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-lg" title="حركة خزنة جديدة"
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !(Number(f.amount) > 0) || !f.party} onClick={save}>تسجيل</button></>}>
      <div className="space-y-4">
        <Segmented value={dir} onChange={(v) => { setDir(v); setF({ ...f, party: '', doc: '' }) }} items={[{ key: 'in', label: 'تحصيل من عميل' }, { key: 'out', label: 'دفع لمورد' }]} />
        <Field label={dir === 'in' ? 'العميل' : 'المورد'}><select className="input" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value, doc: '' })}>
          <option value="">—</option>{(parties.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name} {Number(p.balance) > 0 ? `(${Math.round(p.balance).toLocaleString('en')})` : ''}</option>)}</select></Field>
        <Field label="عن فاتورة (اختياري)"><select className="input" value={f.doc} onChange={(e) => { const d = docs.data?.find((x: any) => x.id === e.target.value); setF({ ...f, doc: e.target.value, amount: d ? String(Math.round(d.remaining_sdg)) : f.amount }) }}>
          <option value="">دفعة تحت الحساب</option>{(docs.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.number} — المتبقي {Math.round(d.remaining_sdg).toLocaleString('en')}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المبلغ (ج.س)"><input className="input num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="التاريخ"><input type="date" className="input" value={f.pay_date} onChange={(e) => setF({ ...f, pay_date: e.target.value })} /></Field>
          <Field label="الطريقة"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            <option value="cash">نقدًا</option><option value="bank">بنك</option><option value="transfer">تحويل</option><option value="cheque">شيك</option></select></Field>
          <Field label="البيان"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  )
}
