import { useState } from 'react'
import { ShieldCheck, Plus, KeyRound, Check } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Empty, Loading, Modal, Field, Badge, NoAccess } from '../components/ui'
import { MODULES, ACTIONS, ROLE_PRESETS } from '../lib/perms'
import { date } from '../lib/format'
import type { Row } from '../lib/backend'

const roleCls: Record<string, string> = {
  admin: 'bg-brand-500/15 text-brand-300', showroom: 'bg-sky-500/15 text-sky-300', accountant: 'bg-emerald-500/15 text-emerald-300',
  warehouse: 'bg-violet-500/15 text-violet-300', custom: 'bg-zinc-500/15 text-zinc-300',
}

export default function Users() {
  const { db, can, me } = useApp()
  const [edit, setEdit] = useState<Row | null>(null)
  const { data, loading } = useLoad(() => db.list('profiles', { order: [{ col: 'created_at' }] }), [], ['profiles'])
  if (!can('users')) return <NoAccess />
  return (
    <>
      <PageHeader title="المستخدمين والصلاحيات" subtitle="كل موظف ليه حساب، وكل حساب ليه صلاحيات بالتفصيل" icon={<ShieldCheck size={22} />}
        actions={can('users', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> مستخدم جديد</button>} />
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !data?.length ? <Empty /> : (
          <table className="tbl">
            <thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>عدد الصلاحيات</th><th>الحالة</th><th>من</th><th></th></tr></thead>
            <tbody>{data.map((u: any) => (
              <tr key={u.id}>
                <td className="font-semibold">{u.full_name || '—'} {u.id === me.id && <span className="text-[11px] text-brand-400">(إنت)</span>}</td>
                <td className="num" dir="ltr">{u.username}</td>
                <td><Badge cls={roleCls[u.role]}>{ROLE_PRESETS[u.role]?.label}</Badge></td>
                <td className="num text-zinc-400">{u.role === 'admin' ? 'كل حاجة' : Object.values(u.permissions ?? {}).reduce((s: number, a: any) => s + a.length, 0)}</td>
                <td>{u.is_active ? <Badge cls="bg-emerald-500/15 text-emerald-300">نشط</Badge> : <Badge cls="bg-red-500/15 text-red-300">موقوف</Badge>}</td>
                <td className="text-zinc-500">{date(u.created_at)}</td>
                <td>{can('users', 'edit') && <button className="btn-ghost btn-sm" onClick={() => setEdit(u)}>تعديل</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <UserForm u={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function UserForm({ u, onClose }: { u: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const isNew = !u.id
  const [f, setF] = useState<Row>({ username: '', full_name: '', password: '', role: 'showroom', is_active: true, ...u, permissions: u.permissions ?? ROLE_PRESETS.showroom.perms })
  const [pw, setPw] = useState('')
  const perms: Record<string, string[]> = f.permissions ?? {}
  const toggle = (m: string, a: string) => {
    const cur = new Set(perms[m] ?? [])
    if (cur.has(a)) { cur.delete(a); if (a === 'view') cur.clear() } else { cur.add(a); cur.add('view') }
    setF({ ...f, role: f.role === 'admin' ? 'admin' : 'custom', permissions: { ...perms, [m]: [...cur] } })
  }
  const setRole = (role: string) => setF({ ...f, role, permissions: role === 'custom' ? perms : ROLE_PRESETS[role].perms })

  const save = async () => {
    const ok = await run(async () => {
      if (isNew) {
        await db.invoke('admin-users', { action: 'create', username: f.username, password: f.password, full_name: f.full_name, role: f.role, permissions: f.role === 'admin' ? {} : perms })
      } else {
        await db.update('profiles', u.id, { full_name: f.full_name, role: f.role, permissions: f.role === 'admin' ? {} : perms, is_active: f.is_active })
        if (pw) await db.invoke('admin-users', { action: 'set_password', id: u.id, password: pw })
      }
      return true
    }, isNew ? 'الحساب اتعمل' : 'اتحفظ')
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} width="max-w-5xl" title={isNew ? 'مستخدم جديد' : `تعديل: ${u.username}`}
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || (isNew && (!f.username || f.password.length < 6))} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Field label="الاسم الكامل"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="اسم الدخول (إنجليزي)"><input className="input num" dir="ltr" disabled={!isNew} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} /></Field>
        {isNew ? <Field label="كلمة السر (6 حروف على الأقل)"><input className="input" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          : <Field label="كلمة سر جديدة (اختياري)"><div className="relative"><KeyRound size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" /><input className="input pr-9" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></div></Field>}
        {!isNew && <Field label="الحالة"><select className="input" value={f.is_active ? '1' : '0'} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}><option value="1">نشط</option><option value="0">موقوف</option></select></Field>}
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(ROLE_PRESETS).map(([k, r]) => (
          <button key={k} onClick={() => setRole(k)} className={`h-10 px-4 rounded-xl border text-sm font-semibold transition ${f.role === k ? 'border-brand-500 bg-brand-500/15 text-brand-200' : 'border-ink-600 bg-ink-850 text-zinc-400 hover:text-white'}`}>{r.label}</button>
        ))}
      </div>
      {f.role === 'admin' ? (
        <div className="rounded-2xl border border-brand-500/30 bg-brand-500/10 p-5 text-sm leading-7">مدير النظام بيشوف ويعمل كل حاجة، وبيوصله كل الإشعارات.</div>
      ) : (
        <div className="rounded-2xl border border-ink-700 overflow-hidden">
          <table className="tbl">
            <thead><tr><th>القسم</th>{ACTIONS.map((a) => <th key={a.key} className="text-center">{a.label}</th>)}</tr></thead>
            <tbody>{MODULES.map((m) => (
              <tr key={m.key}>
                <td><div className="font-semibold">{m.label}</div>{'hint' in m && <div className="text-[11px] text-zinc-500">{(m as any).hint}</div>}</td>
                {ACTIONS.map((a) => {
                  const on = (perms[m.key] ?? []).includes(a.key)
                  return (
                    <td key={a.key} className="text-center">
                      <button onClick={() => toggle(m.key, a.key)} className={`w-7 h-7 rounded-lg border inline-flex items-center justify-center transition ${on ? 'bg-brand-500 border-brand-500 text-ink-950' : 'border-ink-500 hover:border-brand-500/60'}`}>
                        {on && <Check size={15} strokeWidth={3} />}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
