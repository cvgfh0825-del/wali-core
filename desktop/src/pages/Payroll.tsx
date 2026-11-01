import { useState } from 'react'
import { Banknote, RefreshCw, CheckCircle2, Printer, MinusCircle, HandCoins } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Money, Empty, Loading, Modal, Field, Badge, Tabs, Stat, useConfirm, NoAccess } from '../components/ui'
import { printDoc, TableDoc } from '../components/Print'
import { STATUS, monthNow, monthName, short, date, sdg, num } from '../lib/format'

export default function Payroll() {
  const { db, can, settings } = useApp()
  const [tab, setTab] = useState<'payroll' | 'advances' | 'deductions'>('payroll')
  const [period, setPeriod] = useState(monthNow())
  const [add, setAdd] = useState<null | 'advance' | 'deduction'>(null)
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const pr = useLoad(() => db.list('v_payrolls', { eq: { period }, order: [{ col: 'employee_name' }] }), [period], ['employees'])
  const adv = useLoad(() => db.list('salary_advances', { order: [{ col: 'advance_date', asc: false }], limit: 200 }), [tab])
  const ded = useLoad(() => db.list('salary_deductions', { order: [{ col: 'deduction_date', asc: false }], limit: 200 }), [tab])
  const emps = useLoad(() => db.list('employees', { order: [{ col: 'full_name' }] }), [])
  const empName = (id: string) => emps.data?.find((e: any) => e.id === id)?.full_name ?? ''

  if (!can('payroll')) return <NoAccess />
  const rows = pr.data ?? []
  const totalNet = rows.reduce((s: number, r: any) => s + Number(r.net), 0)

  const generate = async () => { await run(() => db.rpc('generate_payroll', { p_period: period }), 'اتحسبت المرتبات'); pr.reload() }
  const pay = async (r: any) => {
    if (await confirm.ask(`صرف مرتب ${r.employee_name}؟`, { text: `الصافي ${sdg(r.net)} ج.س — هيتسجل مصروف رواتب وهتتقفل السلف والخصومات.` })) {
      await run(() => db.rpc('pay_payroll', { p_id: r.id }), 'المرتب اتصرف'); pr.reload()
    }
  }
  const printSheet = () => printDoc(<TableDoc title={`كشف مرتبات ${monthName(period)}`} settings={settings} rows={rows} cols={[
    { key: 'employee_name', label: 'الموظف' }, { key: 'base_salary', label: 'الأساسي', fmt: sdg }, { key: 'commission', label: 'نسبة المبيعات', fmt: sdg },
    { key: 'deductions', label: 'خصومات', fmt: sdg }, { key: 'advances', label: 'سلف', fmt: sdg }, { key: 'late_deduction', label: 'تأخير', fmt: sdg },
    { key: 'net', label: 'الصافي', fmt: sdg }, { key: 'sign', label: 'التوقيع', fmt: () => '' }]} />)

  return (
    <>
      <PageHeader title="المرتبات والسلف" subtitle="المرتب + نسبة المبيعات − الخصومات − السلف − التأخير" icon={<Banknote size={22} />}
        actions={<>
          {can('payroll', 'create') && <button className="btn-ghost" onClick={() => setAdd('deduction')}><MinusCircle size={17} /> خصم</button>}
          {can('payroll', 'create') && <button className="btn-ghost" onClick={() => setAdd('advance')}><HandCoins size={17} /> سلفة</button>}
        </>} />
      <div className="flex items-center gap-3 mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'payroll', label: 'كشف المرتبات' }, { key: 'advances', label: 'السلف' }, { key: 'deductions', label: 'الخصومات' }]} />
        {tab === 'payroll' && <>
          <input type="month" className="input h-10 w-44" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {can('payroll', 'create') && <button className="btn-primary h-10" disabled={busy} onClick={generate}><RefreshCw size={16} /> احسب مرتبات {monthName(period)}</button>}
          {rows.length > 0 && <button className="btn-ghost h-10" onClick={printSheet}><Printer size={16} /> طباعة الكشف</button>}
        </>}
      </div>

      {tab === 'payroll' && (
        <>
          {rows.length > 0 && <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat accent label="إجمالي الصافي" value={short(totalNet)} />
            <Stat label="إجمالي نسب المبيعات" value={short(rows.reduce((s: number, r: any) => s + Number(r.commission), 0))} tone="green" />
            <Stat label="اتصرف" value={`${rows.filter((r: any) => r.status === 'paid').length} / ${rows.length}`} />
          </div>}
          <div className="card overflow-hidden">
            {pr.loading ? <Loading /> : !rows.length ? <Empty title="لسه محسبتش مرتبات الشهر ده" text="دوس «احسب المرتبات» وهتتجمع المبيعات والسلف والخصومات والتأخير لوحدها" /> : (
              <table className="tbl">
                <thead><tr><th>الموظف</th><th>الأساسي</th><th>مبيعاته</th><th>النسبة</th><th>خصومات</th><th>سلف</th><th>تأخير</th><th>الصافي</th><th>الحالة</th><th></th></tr></thead>
                <tbody>{rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{r.employee_name}<div className="text-[11px] text-zinc-500">{r.job_title}</div></td>
                    <td><Money v={r.base_salary} cur={false} /></td>
                    <td className="text-zinc-400"><Money v={r.sales_base} cur={false} /></td>
                    <td className="text-emerald-300"><Money v={r.commission} cur={false} /></td>
                    <td className="text-red-300"><Money v={r.deductions} cur={false} /></td>
                    <td className="text-red-300"><Money v={r.advances} cur={false} /></td>
                    <td className="text-amber-300"><Money v={r.late_deduction} cur={false} /> <span className="text-[10px] text-zinc-500 num">({r.late_minutes}د)</span></td>
                    <td><Money v={r.net} className="font-black text-brand-300" /></td>
                    <td><Badge cls={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></td>
                    <td>{r.status === 'draft' && can('payroll', 'approve') && <button className="btn-primary btn-sm" disabled={busy} onClick={() => pay(r)}><CheckCircle2 size={14} /> صرف</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab !== 'payroll' && (
        <div className="card overflow-hidden">
          {(() => {
            const list = (tab === 'advances' ? adv.data : ded.data) ?? []
            return !list.length ? <Empty /> : (
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>الموظف</th><th>المبلغ</th><th>{tab === 'advances' ? 'ملاحظة' : 'السبب'}</th><th>الحالة</th></tr></thead>
                <tbody>{list.map((r: any) => (
                  <tr key={r.id}>
                    <td className="text-zinc-400">{date(r.advance_date ?? r.deduction_date)}</td><td className="font-semibold">{empName(r.employee_id)}</td>
                    <td><Money v={r.amount_sdg} className="font-bold" /></td><td className="text-zinc-400">{r.notes ?? r.reason}</td>
                    <td>{r.payroll_id ? <Badge cls="bg-emerald-500/15 text-emerald-300">اتخصمت من المرتب</Badge> : <Badge cls="bg-amber-500/15 text-amber-300">هتتخصم الشهر ده</Badge>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )
          })()}
        </div>
      )}
      {add && <AddModal kind={add} emps={(emps.data ?? []).filter((e: any) => e.is_active)} onClose={() => { setAdd(null); adv.reload(); ded.reload() }} />}
      {confirm.node}
    </>
  )
}

function AddModal({ kind, emps, onClose }: { kind: 'advance' | 'deduction'; emps: any[]; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState({ employee_id: '', amount: '', note: '', d: new Date().toISOString().slice(0, 10) })
  const save = async () => {
    const ok = await run(() => kind === 'advance'
      ? db.insert('salary_advances', { employee_id: f.employee_id, amount_sdg: Number(f.amount), notes: f.note || null, advance_date: f.d })
      : db.insert('salary_deductions', { employee_id: f.employee_id, amount_sdg: Number(f.amount), reason: f.note || null, deduction_date: f.d }), 'اتسجل')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-md" title={kind === 'advance' ? 'سلفة لموظف' : 'خصم على موظف'} subtitle="هتتخصم تلقائياً من مرتب الشهر"
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.employee_id || !(Number(f.amount) > 0)} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الموظف" className="col-span-2"><select className="input" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
          <option value="">—</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} — مرتب {num(e.base_salary)}</option>)}</select></Field>
        <Field label="المبلغ (ج.س)"><input className="input num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={f.d} onChange={(e) => setF({ ...f, d: e.target.value })} /></Field>
        <Field label={kind === 'advance' ? 'ملاحظة' : 'السبب'} className="col-span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

