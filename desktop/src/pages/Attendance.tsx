import { useState } from 'react'
import { Clock, Pencil, CalendarDays, Plus, Trash2, PlusCircle, MinusCircle, HandCoins, Settings2, Printer } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Empty, Loading, Modal, Field, Badge, Tabs, Stat, Money, NoAccess } from '../components/ui'
import { printDoc, TableDoc } from '../components/Print'
import { date, time, today, monthNow, monthName, sdg, num } from '../lib/format'
import type { Row } from '../lib/backend'

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const hours = (h: any) => num(Number(h) || 0, 1)

export default function Attendance() {
  const { db, can, settings } = useApp()
  const [view, setView] = useState<'day' | 'month' | 'setup'>('day')
  const [day, setDay] = useState(today())
  const [month, setMonth] = useState(monthNow())
  const [edit, setEdit] = useState<Row | null>(null)
  const [money, setMoney] = useState<null | { kind: 'addition' | 'deduction' | 'advance'; emp?: Row }>(null)
  const emps = useLoad(() => db.list('employees', { eq: { is_active: true }, order: [{ col: 'full_name' }] }), [], ['employees'])
  const dayRows = useLoad(() => db.list('v_attendance', { eq: { work_date: day } }), [day], ['attendance'])
  const sheet = useLoad(() => (view === 'month' ? db.rpc<Row[]>('attendance_sheet', { p_period: month }) : Promise.resolve([] as Row[])), [view, month],
    ['attendance', 'employees', 'salary_advances', 'salary_deductions', 'salary_additions', 'holidays', 'invoices'])

  if (!can('attendance')) return <NoAccess />
  const present = (dayRows.data ?? []).filter((r: any) => r.check_in)
  const canMoney = can('payroll', 'create')
  const rows = sheet.data ?? []
  const first = rows[0]

  const printSheet = () => printDoc(<TableDoc title={`كشف الحضور والمرتبات — ${monthName(month)}`} settings={settings} rows={rows} cols={[
    { key: 'employee_name', label: 'الموظف' }, { key: 'present_days', label: 'حضور' }, { key: 'leave_days', label: 'إجازة' }, { key: 'absent_days', label: 'غياب' },
    { key: 'worked_hours', label: 'الساعات', fmt: hours }, { key: 'base_salary', label: 'المرتب', fmt: sdg }, { key: 'hourly_rate', label: 'سعر الساعة', fmt: sdg },
    { key: 'earned', label: 'المستحق', fmt: sdg }, { key: 'additions', label: 'زيادات', fmt: sdg }, { key: 'deductions', label: 'خصومات', fmt: sdg },
    { key: 'advances', label: 'سلفيات', fmt: sdg }, { key: 'net', label: 'الصافي', fmt: sdg }]} />)

  return (
    <>
      <PageHeader title="الحضور والانصراف" subtitle={`مواعيد العمل ${String(settings.work_start ?? '').slice(0, 5)} — ${String(settings.work_end ?? '').slice(0, 5)} بتوقيت السودان · العطلة: ${(settings.weekly_off ?? []).map((d: number) => DAYS[d]).join('، ') || '—'}`} icon={<Clock size={22} />}
        actions={canMoney && <>
          <button className="btn-ghost" onClick={() => setMoney({ kind: 'addition' })}><PlusCircle size={17} /> زيادة</button>
          <button className="btn-ghost" onClick={() => setMoney({ kind: 'deduction' })}><MinusCircle size={17} /> خصم</button>
          <button className="btn-ghost" onClick={() => setMoney({ kind: 'advance' })}><HandCoins size={17} /> سلفة</button>
        </>} />
      <div className="flex items-center gap-3 mb-4">
        <Tabs value={view} onChange={setView} items={[{ key: 'day', label: 'اليوم' }, { key: 'month', label: 'كشف الشهر والمرتبات' }, { key: 'setup', label: 'مواعيد العمل والعطلات' }]} />
        {view === 'day' && <input type="date" className="input h-10 w-44" value={day} onChange={(e) => setDay(e.target.value)} />}
        {view === 'month' && <>
          <input type="month" className="input h-10 w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
          {rows.length > 0 && <button className="btn-ghost h-10" onClick={printSheet}><Printer size={16} /> طباعة الكشف</button>}
        </>}
      </div>

      {view === 'day' && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat label="الحاضرون" value={`${present.length} / ${emps.data?.length ?? 0}`} tone="green" />
            <Stat label="المتأخرون" value={present.filter((r: any) => r.late_minutes > 0).length} tone="amber" />
            <Stat label="لم يحضروا بعد / غياب" value={(emps.data?.length ?? 0) - present.length} tone="red" />
          </div>
          <div className="card overflow-hidden">
            {dayRows.loading ? <Loading /> : (
              <table className="tbl">
                <thead><tr><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>التأخير</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead>
                <tbody>{(emps.data ?? []).map((e: any) => {
                  const r = (dayRows.data ?? []).find((x: any) => x.employee_id === e.id)
                  const h = r?.check_in && r?.check_out ? (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 3.6e6 : null
                  const notStarted = e.hired_at && day < String(e.hired_at).slice(0, 10)
                  return (
                    <tr key={e.id} className={notStarted ? 'opacity-40' : ''}>
                      <td className="font-semibold">{e.full_name} <span className="text-[12px] text-zinc-500">{e.job_title}</span></td>
                      <td className="num">{time(r?.check_in)}</td><td className="num">{time(r?.check_out)}</td>
                      <td className="num">{h != null ? hours(h) : '—'}</td>
                      <td>{r?.late_minutes ? <Badge cls="bg-amber-500/15 text-amber-300">{r.late_minutes} دقيقة</Badge> : '—'}</td>
                      <td>{notStarted ? <Badge cls="bg-ink-700 text-zinc-400">لم يبدأ العمل</Badge> : !r ? <Badge cls="bg-ink-700 text-zinc-400">لم يسجل</Badge> : r.status === 'absent' ? <Badge cls="bg-red-500/15 text-red-300">غياب</Badge> : r.status === 'leave' ? <Badge cls="bg-sky-500/15 text-sky-300">إجازة</Badge> : <Badge cls="bg-emerald-500/15 text-emerald-300">حاضر</Badge>}</td>
                      <td className="text-zinc-500 text-[13px]">{r?.note}{r?.edited_by_name && <span className="text-amber-400"> (عدّلها {r.edited_by_name})</span>}</td>
                      <td>{can('attendance', 'edit') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" onClick={() => setEdit({ employee: e, row: r, day })}><Pencil size={15} /></button>}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {view === 'month' && (
        <>
          {first && <div className="grid grid-cols-4 gap-4 mb-4">
            <Stat label="أيام العمل في الشهر" value={first.month_workdays} sub={`من غير العطلات · ${hours(first.day_hours)} ساعة في اليوم`} icon={<CalendarDays size={20} />} />
            <Stat label="ساعات الشهر المطلوبة" value={hours(first.scheduled_hours)} />
            <Stat label="إجمالي الساعات الفعلية" value={hours(rows.reduce((s, r) => s + Number(r.worked_hours), 0))} tone="green" />
            <Stat accent label="إجمالي الصافي" value={<Money v={rows.reduce((s, r) => s + Number(r.net), 0)} />} />
          </div>}
          <div className="card overflow-x-auto">
            {sheet.loading ? <Loading /> : !rows.length ? <Empty title="لا يوجد موظفون في هذا الشهر" /> : (
              <table className="tbl text-[13px] [&_td]:px-2.5 [&_th]:px-2.5 whitespace-nowrap">
                <thead><tr>
                  <th>الموظف</th><th>بداية العمل</th><th>حضور</th><th>إجازة</th><th>غياب</th><th>تأخير</th><th>الساعات</th>
                  <th>المرتب</th><th>سعر الساعة</th><th>المستحق</th><th>العمولة</th><th>زيادات</th><th>خصومات</th><th>سلفيات</th><th>الصافي</th>{canMoney && <th></th>}
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.employee_id}>
                    <td className="font-semibold">{r.employee_name}<div className="text-[11px] text-zinc-500">{r.job_title}</div></td>
                    <td className="text-zinc-400">{date(r.hired_at)}</td>
                    <td className="num text-emerald-300">{r.present_days} <span className="text-zinc-500">/ {r.due_days}</span></td>
                    <td className="num text-sky-300">{r.leave_days}</td>
                    <td className="num text-red-300">{r.absent_days}</td>
                    <td className="num text-amber-300">{r.late_minutes ? `${r.late_minutes} د` : '—'}</td>
                    <td className="num font-bold">{hours(r.worked_hours)} <span className="text-zinc-500 font-normal">/ {hours(r.scheduled_hours)}</span></td>
                    <td><Money v={r.base_salary} cur={false} /></td>
                    <td className="text-zinc-400"><Money v={r.hourly_rate} cur={false} /></td>
                    <td className="font-bold"><Money v={r.earned} cur={false} /></td>
                    <td className="text-emerald-300"><Money v={r.commission} cur={false} /></td>
                    <td className="text-emerald-300"><Money v={r.additions} cur={false} /></td>
                    <td className="text-red-300"><Money v={Number(r.deductions) + Number(r.late_deduction)} cur={false} /></td>
                    <td className="text-red-300"><Money v={r.advances} cur={false} /></td>
                    <td><Money v={r.net} className="font-black text-brand-300" /></td>
                    {canMoney && <td><div className="flex gap-1">
                      <button title="زيادة" className="p-1.5 rounded-lg text-emerald-300 hover:bg-emerald-500/10" onClick={() => setMoney({ kind: 'addition', emp: r })}><PlusCircle size={15} /></button>
                      <button title="خصم" className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10" onClick={() => setMoney({ kind: 'deduction', emp: r })}><MinusCircle size={15} /></button>
                      <button title="سلفة" className="p-1.5 rounded-lg text-amber-300 hover:bg-amber-500/10" onClick={() => setMoney({ kind: 'advance', emp: r })}><HandCoins size={15} /></button>
                    </div></td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 mt-3 leading-6">
            سعر الساعة = المرتب الشهري ÷ ساعات الشهر المطلوبة · المستحق = سعر الساعة × (الساعات الفعلية + ساعات أيام الإجازة) · الصافي = المستحق + العمولة + الزيادات − الخصومات − السلفيات.
            الصرف الفعلي من صفحة «المرتبات والسلفيات».
          </p>
        </>
      )}

      {view === 'setup' && <Setup />}
      {edit && <EditAttendance x={edit} onClose={() => setEdit(null)} />}
      {money && <MoneyModal kind={money.kind} emp={money.emp} emps={emps.data ?? []} onClose={() => setMoney(null)} />}
    </>
  )
}

// مواعيد العمل والعطلة الأسبوعية والعطلات الرسمية
function Setup() {
  const { db, can, settings, reloadSettings } = useApp()
  const { busy, run } = useAction()
  const canEdit = can('settings', 'edit')
  const [f, setF] = useState({ start: String(settings.work_start ?? '09:00').slice(0, 5), end: String(settings.work_end ?? '17:00').slice(0, 5), grace: String(settings.late_grace_minutes ?? 15), off: (settings.weekly_off ?? [5]) as number[] })
  const hol = useLoad(() => db.list('holidays', { order: [{ col: 'holiday_date', asc: false }] }), [], ['holidays'])
  const [h, setH] = useState({ d: today(), name: '' })
  const dayHours = (() => { const [a, b] = [f.start, f.end].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))); return Math.max(0, (b - a) / 60) })()

  const saveTimes = async () => {
    if (await run(() => db.update('settings', 1, { work_start: f.start, work_end: f.end, late_grace_minutes: Number(f.grace) || 0, weekly_off: f.off }), 'حُفظت مواعيد العمل')) reloadSettings()
  }
  const addHoliday = async () => {
    if (await run(() => db.insert('holidays', { holiday_date: h.d, name: h.name.trim() }), 'أُضيفت العطلة')) { setH({ d: today(), name: '' }); hol.reload() }
  }

  return (
    <div className="grid grid-cols-2 gap-4 items-start">
      <div className="card p-6 space-y-4">
        <div className="font-bold flex items-center gap-2"><Settings2 size={18} className="text-brand-500" /> مواعيد العمل (بتوقيت السودان)</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="بداية اليوم"><input type="time" className="input" disabled={!canEdit} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="نهاية اليوم"><input type="time" className="input" disabled={!canEdit} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label="سماح التأخير (دقيقة)"><input className="input num" disabled={!canEdit} value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div className="text-sm text-zinc-400">ساعات اليوم: <span className="num text-zinc-100 font-bold">{num(dayHours, 1)}</span></div>
        <div>
          <div className="label">العطلة الأسبوعية</div>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={i} className={`chip h-9 px-3 rounded-lg cursor-pointer border ${f.off.includes(i) ? 'bg-brand-500/15 border-brand-500/40 text-brand-300' : 'bg-ink-800 border-ink-600 text-zinc-400'}`}>
                <input type="checkbox" className="hidden" disabled={!canEdit} checked={f.off.includes(i)} onChange={(e) => setF({ ...f, off: e.target.checked ? [...f.off, i].sort() : f.off.filter((x) => x !== i) })} /> {d}
              </label>
            ))}
          </div>
        </div>
        {canEdit && <button className="btn-primary" disabled={busy || dayHours <= 0} onClick={saveTimes}>حفظ</button>}
      </div>

      <div className="card p-6">
        <div className="font-bold flex items-center gap-2 mb-4"><CalendarDays size={18} className="text-brand-500" /> العطلات الرسمية والإجازات العامة</div>
        {can('attendance', 'edit') && (
          <div className="flex gap-2 mb-4">
            <input type="date" className="input w-44" value={h.d} onChange={(e) => setH({ ...h, d: e.target.value })} />
            <input className="input" placeholder="اسم العطلة (مثلًا: عيد الفطر)" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
            <button className="btn-primary shrink-0" disabled={busy || !h.name.trim() || !h.d} onClick={addHoliday}><Plus size={17} /> إضافة</button>
          </div>
        )}
        {hol.loading ? <Loading /> : !hol.data?.length ? <Empty title="لا توجد عطلات مسجَّلة" /> : (
          <div className="space-y-1 max-h-96 overflow-auto">
            {hol.data.map((x: any) => (
              <div key={x.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-ink-800">
                <span className="num text-zinc-400 w-28">{date(x.holiday_date)}</span>
                <span className="text-zinc-500 text-[12px] w-16">{DAYS[new Date(x.holiday_date + 'T12:00:00').getDay()]}</span>
                <span className="flex-1">{x.name}</span>
                {can('attendance', 'edit') && <button className="p-1.5 text-zinc-500 hover:text-red-300" onClick={async () => { await run(() => db.remove('holidays', x.id), 'تم الحذف'); hol.reload() }}><Trash2 size={15} /></button>}
              </div>
            ))}
          </div>
        )}
        <p className="text-[12px] text-zinc-500 mt-4 leading-6">أيام العطلة لا تُحسب ضمن أيام العمل، فلا تُعتبر غيابًا ولا تقلل المرتب.</p>
      </div>
    </div>
  )
}

const MONEY = {
  addition: { title: 'زيادة لموظف', table: 'salary_additions', date: 'addition_date', note: 'reason', noteLabel: 'السبب', sub: 'تُضاف إلى مرتب الشهر' },
  deduction: { title: 'خصم على موظف', table: 'salary_deductions', date: 'deduction_date', note: 'reason', noteLabel: 'السبب', sub: 'يُخصم من مرتب الشهر' },
  advance: { title: 'سلفة لموظف', table: 'salary_advances', date: 'advance_date', note: 'notes', noteLabel: 'ملاحظة', sub: 'تُخصم من مرتب الشهر' },
} as const

function MoneyModal({ kind, emp, emps, onClose }: { kind: keyof typeof MONEY; emp?: Row; emps: Row[]; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const m = MONEY[kind]
  const [f, setF] = useState({ employee_id: emp?.employee_id ?? '', amount: '', note: '', d: today() })
  const save = async () => {
    const ok = await run(() => db.insert(m.table, { employee_id: f.employee_id, amount_sdg: Number(f.amount), [m.note]: f.note || null, [m.date]: f.d }), 'تم التسجيل')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-md" title={m.title} subtitle={m.sub}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.employee_id || !(Number(f.amount) > 0)} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الموظف" className="col-span-2"><select className="input" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
          <option value="">—</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} — مرتب {num(e.base_salary)}</option>)}</select></Field>
        <Field label="المبلغ (ج.س)"><input className="input num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={f.d} onChange={(e) => setF({ ...f, d: e.target.value })} /></Field>
        <Field label={m.noteLabel} className="col-span-2"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function EditAttendance({ x, onClose }: { x: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const hm = (s?: string) => (s ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Khartoum', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : '')
  const [f, setF] = useState({ status: x.row?.status ?? 'present', in: hm(x.row?.check_in), out: hm(x.row?.check_out), late: String(x.row?.late_minutes ?? 0), note: x.row?.note ?? '' })
  const ts = (t: string) => (t ? `${x.day}T${t}:00+02:00` : '')
  const save = async () => {
    const ok = await run(() => db.rpc('admin_set_attendance', { p: { employee_id: x.employee.id, work_date: x.day, check_in: ts(f.in), check_out: ts(f.out), late_minutes: Number(f.late) || 0, status: f.status, note: f.note } }), 'تم التعديل — وأُرسل إشعار إلى مدير النظام')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-md" title={`تعديل حضور: ${x.employee.full_name}`} subtitle={`${date(x.day)} — الأوقات بتوقيت السودان`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الحالة" className="col-span-2"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="present">حاضر</option><option value="absent">غياب</option><option value="leave">إجازة (مدفوعة)</option></select></Field>
        <Field label="الحضور"><input type="time" className="input" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} /></Field>
        <Field label="الانصراف"><input type="time" className="input" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} /></Field>
        <Field label="دقائق التأخير"><input className="input num" value={f.late} onChange={(e) => setF({ ...f, late: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="السبب / ملاحظة"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
