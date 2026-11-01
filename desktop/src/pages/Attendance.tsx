import { useMemo, useState } from 'react'
import { Clock, Pencil, CalendarDays } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Empty, Loading, Modal, Field, Badge, Tabs, Stat, NoAccess } from '../components/ui'
import { date, time, today, monthNow, monthName, monthEnd } from '../lib/format'
import type { Row } from '../lib/backend'

export default function Attendance() {
  const { db, can, settings } = useApp()
  const [view, setView] = useState<'day' | 'month'>('day')
  const [day, setDay] = useState(today())
  const [month, setMonth] = useState(monthNow())
  const [edit, setEdit] = useState<Row | null>(null)
  const emps = useLoad(() => db.list('employees', { eq: { is_active: true }, order: [{ col: 'full_name' }] }), [], ['employees'])
  const dayRows = useLoad(() => db.list('v_attendance', { eq: { work_date: day } }), [day], ['attendance'])
  const monthRows = useLoad(() => db.list('v_attendance', { gte: { work_date: month + '-01' }, lte: { work_date: monthEnd(month) } }), [month], ['attendance'])

  const summary = useMemo(() => (emps.data ?? []).map((e: any) => {
    const rs = (monthRows.data ?? []).filter((r: any) => r.employee_id === e.id)
    const hours = rs.reduce((s: number, r: any) => s + (r.check_in && r.check_out ? (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 3.6e6 : 0), 0)
    return { e, days: rs.filter((r: any) => r.status === 'present').length, late: rs.reduce((s: number, r: any) => s + r.late_minutes, 0), lateDays: rs.filter((r: any) => r.late_minutes > 0).length, absent: rs.filter((r: any) => r.status === 'absent').length, hours }
  }), [emps.data, monthRows.data])

  if (!can('attendance')) return <NoAccess />
  const present = (dayRows.data ?? []).filter((r: any) => r.check_in)
  return (
    <>
      <PageHeader title="الحضور والانصراف" subtitle={`مواعيد الشغل ${String(settings.work_start ?? '').slice(0, 5)} — ${String(settings.work_end ?? '').slice(0, 5)} · سماح ${settings.late_grace_minutes} دقيقة`} icon={<Clock size={22} />} />
      <div className="flex items-center gap-3 mb-4">
        <Tabs value={view} onChange={setView} items={[{ key: 'day', label: 'يوم' }, { key: 'month', label: 'ملخص الشهر' }]} />
        {view === 'day' ? <input type="date" className="input h-10 w-44" value={day} onChange={(e) => setDay(e.target.value)} />
          : <input type="month" className="input h-10 w-44" value={month} onChange={(e) => setMonth(e.target.value)} />}
      </div>

      {view === 'day' ? (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Stat label="حاضرين" value={`${present.length} / ${emps.data?.length ?? 0}`} tone="green" />
            <Stat label="متأخرين" value={present.filter((r: any) => r.late_minutes > 0).length} tone="amber" />
            <Stat label="لسه مجوش / غياب" value={(emps.data?.length ?? 0) - present.length} tone="red" />
          </div>
          <div className="card overflow-hidden">
            {dayRows.loading ? <Loading /> : (
              <table className="tbl">
                <thead><tr><th>الموظف</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead>
                <tbody>{(emps.data ?? []).map((e: any) => {
                  const r = (dayRows.data ?? []).find((x: any) => x.employee_id === e.id)
                  return (
                    <tr key={e.id}>
                      <td className="font-semibold">{e.full_name} <span className="text-[12px] text-zinc-500">{e.job_title}</span></td>
                      <td className="num">{time(r?.check_in)}</td><td className="num">{time(r?.check_out)}</td>
                      <td>{r?.late_minutes ? <Badge cls="bg-amber-500/15 text-amber-300">{r.late_minutes} دقيقة</Badge> : '—'}</td>
                      <td>{!r ? <Badge cls="bg-ink-700 text-zinc-400">لم يسجل</Badge> : r.status === 'absent' ? <Badge cls="bg-red-500/15 text-red-300">غياب</Badge> : r.status === 'leave' ? <Badge cls="bg-sky-500/15 text-sky-300">إجازة</Badge> : <Badge cls="bg-emerald-500/15 text-emerald-300">حاضر</Badge>}</td>
                      <td className="text-zinc-500 text-[13px]">{r?.note}{r?.edited_by_name && <span className="text-amber-400"> (عدّله {r.edited_by_name})</span>}</td>
                      <td>{can('attendance', 'edit') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" onClick={() => setEdit({ employee: e, row: r, day })}><Pencil size={15} /></button>}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-ink-700 flex items-center gap-2 font-bold"><CalendarDays size={17} className="text-brand-500" /> {monthName(month)}</div>
          {!summary.length ? <Empty /> : (
            <table className="tbl">
              <thead><tr><th>الموظف</th><th>أيام الحضور</th><th>ساعات الشغل</th><th>أيام التأخير</th><th>دقايق التأخير</th><th>غياب</th></tr></thead>
              <tbody>{summary.map((s) => (
                <tr key={s.e.id}><td className="font-semibold">{s.e.full_name}</td><td className="num">{s.days}</td><td className="num">{Math.round(s.hours)}</td>
                  <td className="num text-amber-300">{s.lateDays}</td><td className="num text-amber-300">{s.late}</td><td className="num text-red-300">{s.absent}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
      {edit && <EditAttendance x={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function EditAttendance({ x, onClose }: { x: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const hm = (s?: string) => (s ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Khartoum', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : '')
  const [f, setF] = useState({ status: x.row?.status ?? 'present', in: hm(x.row?.check_in), out: hm(x.row?.check_out), late: String(x.row?.late_minutes ?? 0), note: x.row?.note ?? '' })
  const ts = (t: string) => (t ? `${x.day}T${t}:00+02:00` : '')
  const save = async () => {
    const ok = await run(() => db.rpc('admin_set_attendance', { p: { employee_id: x.employee.id, work_date: x.day, check_in: ts(f.in), check_out: ts(f.out), late_minutes: Number(f.late) || 0, status: f.status, note: f.note } }), 'اتعدّل — ووصل إشعار للأدمن')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-md" title={`تعديل حضور: ${x.employee.full_name}`} subtitle={date(x.day)}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الحالة" className="col-span-2"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="present">حاضر</option><option value="absent">غياب</option><option value="leave">إجازة</option></select></Field>
        <Field label="الحضور"><input type="time" className="input" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} /></Field>
        <Field label="الانصراف"><input type="time" className="input" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} /></Field>
        <Field label="دقايق التأخير"><input className="input num" value={f.late} onChange={(e) => setF({ ...f, late: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="السبب / ملاحظة"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
