import { useState } from 'react'
import { UserCog, Plus, Pencil, Link2 } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Money, Empty, Loading, Modal, Field, Badge, NoAccess } from '../components/ui'
import { date, num } from '../lib/format'
import type { Row } from '../lib/backend'
import { AdminDelete } from '../components/AdminDelete'

export default function Employees() {
  const { db, can } = useApp()
  const [edit, setEdit] = useState<Row | null>(null)
  const { data, loading } = useLoad(() => db.list('v_employees', { order: [{ col: 'is_active', asc: false }, { col: 'full_name' }] }), [], ['employees'])
  if (!can('hr')) return <NoAccess />
  const active = (data ?? []).filter((e: any) => e.is_active)
  return (
    <>
      <PageHeader title="الموظفون" subtitle={<>{active.length} موظف · إجمالي المرتبات الأساسية <Money v={active.reduce((s: number, e: any) => s + Number(e.base_salary), 0)} className="font-bold text-zinc-100" /></>} icon={<UserCog size={22} />}
        actions={can('hr', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> موظف جديد</button>} />
      {loading ? <Loading /> : !data?.length ? <div className="card"><Empty /></div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {data.map((e: any) => (
            <div key={e.id} className={`card p-5 ${!e.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500/30 to-brand-700/20 border border-brand-500/30 text-brand-300 font-black text-lg flex items-center justify-center">{e.full_name.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{e.full_name}</div>
                  <div className="text-[13px] text-zinc-400">{e.job_title}</div>
                </div>
                {can('hr', 'edit') && <button className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-ink-700" onClick={() => setEdit(e)}><Pencil size={16} /></button>}
                <AdminDelete icon table="employees" id={e.id} label={`الموظف ${e.full_name} (مع حضوره ومرتباته)`} />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                <div className="rounded-xl bg-ink-900 p-3"><div className="text-[11px] text-zinc-500">المرتب</div><Money v={e.base_salary} className="font-bold" /></div>
                <div className="rounded-xl bg-ink-900 p-3"><div className="text-[11px] text-zinc-500">نسبة المبيعات</div><span className="num font-bold">{num(e.commission_pct, 2)}%</span> <span className="text-[11px] text-zinc-500">{e.commission_basis === 'own' ? 'من مبيعاته' : 'من كل المبيعات'}</span></div>
              </div>
              <div className="flex items-center justify-between mt-3 text-[12px] text-zinc-500">
                <span>بدأ العمل {date(e.hired_at)}</span>
                {e.username ? <Badge cls="bg-sky-500/10 text-sky-300"><Link2 size={11} /> {e.username}</Badge> : <span>بدون حساب</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <EmployeeForm e={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function EmployeeForm({ e, onClose }: { e: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const users = useLoad(() => db.list('profiles', { order: [{ col: 'username' }] }), [])
  const [f, setF] = useState<Row>({ full_name: '', phone: '', job_title: '', base_salary: '', commission_pct: '0', commission_basis: 'own', user_id: '', hired_at: new Date().toISOString().slice(0, 10), is_active: true, notes: '', ...e })
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const body = {
      full_name: f.full_name.trim(), phone: f.phone || null, job_title: f.job_title || null, base_salary: Number(f.base_salary) || 0,
      commission_pct: Number(f.commission_pct) || 0, commission_basis: f.commission_basis, user_id: f.user_id || null,
      hired_at: f.hired_at || null, is_active: !!f.is_active, notes: f.notes || null,
    }
    const ok = await run(() => (e.id ? db.update('employees', e.id, body) : db.insert('employees', body)), 'تم الحفظ')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={e.id ? `تعديل: ${e.full_name}` : 'موظف جديد'}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.full_name?.trim()} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاسم *"><input className="input" autoFocus value={f.full_name} onChange={(x) => set('full_name', x.target.value)} /></Field>
        <Field label="الوظيفة"><input className="input" value={f.job_title ?? ''} onChange={(x) => set('job_title', x.target.value)} /></Field>
        <Field label="الهاتف"><input className="input num" dir="ltr" value={f.phone ?? ''} onChange={(x) => set('phone', x.target.value)} /></Field>
        <Field label="بداية العمل" hint="يبدأ منه حساب الحضور والمرتب"><input type="date" className="input" value={f.hired_at ?? ''} onChange={(x) => set('hired_at', x.target.value)} /></Field>
        <Field label="المرتب الشهري (ج.س)" hint="يُحسب بالساعة حسب ساعات العمل الفعلية"><input className="input num" value={f.base_salary} onChange={(x) => set('base_salary', x.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="نسبة من المبيعات %"><input className="input num" value={f.commission_pct} onChange={(x) => set('commission_pct', x.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="النسبة محسوبة من"><select className="input" value={f.commission_basis} onChange={(x) => set('commission_basis', x.target.value)}>
          <option value="own">مبيعاته الخاصة فقط</option><option value="total">إجمالي مبيعات الشركة</option></select></Field>
        <Field label="حساب الدخول المربوط" hint="ليتمكن من تسجيل الحضور وتُحتسب له مبيعاته"><select className="input" value={f.user_id ?? ''} onChange={(x) => set('user_id', x.target.value)}>
          <option value="">بدون</option>{(users.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.username} — {u.full_name}</option>)}</select></Field>
        <Field label="الحالة"><select className="input" value={f.is_active ? '1' : '0'} onChange={(x) => set('is_active', x.target.value === '1')}><option value="1">على رأس العمل</option><option value="0">ترك العمل</option></select></Field>
        <Field label="ملاحظات"><input className="input" value={f.notes ?? ''} onChange={(x) => set('notes', x.target.value)} /></Field>
      </div>
    </Modal>
  )
}
