import { useState } from 'react'
import { PieChart, Plus, Pencil, Percent, RefreshCw, CheckCircle2, History, UserMinus } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Money, Empty, Loading, Modal, Field, Badge, Tabs, useConfirm, NoAccess } from '../components/ui'
import { Donut } from '../components/charts'
import { STATUS, monthNow, monthName, date, num, sdg, today } from '../lib/format'
import type { Row } from '../lib/backend'

const COLORS = ['#FF7A1A', '#FFB066', '#E8530A', '#7A3204', '#FFD9B8', '#B84B06']

export default function Shareholders() {
  const { db, can } = useApp()
  const [tab, setTab] = useState<'list' | 'payouts'>('list')
  const [period, setPeriod] = useState(monthNow())
  const [edit, setEdit] = useState<Row | null>(null)
  const [terms, setTerms] = useState<Row | null>(null)
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const list = useLoad(() => db.list('v_shareholders', { order: [{ col: 'is_active', asc: false }, { col: 'full_name' }] }), [], ['shareholders'])
  const payouts = useLoad(() => db.list('v_shareholder_payouts', { eq: { period }, order: [{ col: 'shareholder_name' }] }), [period])

  if (!can('shareholders')) return <NoAccess />
  const active = (list.data ?? []).filter((s: any) => s.is_active)
  const totalPct = active.reduce((s: number, x: any) => s + Number(x.profit_pct ?? 0), 0)

  return (
    <>
      <PageHeader title="المساهمون" icon={<PieChart size={22} />}
        actions={can('shareholders', 'create') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={18} /> مساهم جديد</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'list', label: 'المساهمين والنسب' }, { key: 'payouts', label: 'المستحقات الشهرية' }]} />

      {tab === 'list' ? (
        <div className="grid grid-cols-[1fr_320px] gap-5 mt-4">
          <div className="space-y-3">
            {list.loading ? <Loading /> : !list.data?.length ? <div className="card"><Empty /></div> : list.data.map((s: any, i: number) => (
              <div key={s.id} className={`card p-5 flex items-center gap-5 ${!s.is_active ? 'opacity-50' : ''}`}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl text-ink-950" style={{ background: COLORS[i % COLORS.length] }}>{s.full_name.replace(/^(أ\.|م\.|د\.)\s*/, '').charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-lg flex items-center gap-2">{s.full_name} {!s.is_active && <Badge cls="bg-red-500/15 text-red-300">خرج {date(s.left_at)}</Badge>}</div>
                  <div className="text-[12px] text-zinc-500">شريك من {date(s.joined_at)}{s.effective_from && ` · النسب الحالية من ${date(s.effective_from)}`}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-ink-900 px-4 py-2"><div className="text-[11px] text-zinc-500">المرتب</div><Money v={s.monthly_salary ?? 0} cur={false} className="font-bold" /></div>
                  <div className="rounded-xl bg-ink-900 px-4 py-2"><div className="text-[11px] text-zinc-500">من المبيعات</div><span className="num font-bold">{num(s.sales_pct ?? 0, 2)}%</span></div>
                  <div className="rounded-xl bg-brand-500/10 border border-brand-500/30 px-4 py-2"><div className="text-[11px] text-zinc-400">من الأرباح</div><span className="num font-black text-brand-300">{num(s.profit_pct ?? 0, 2)}%</span></div>
                </div>
                {can('shareholders', 'edit') && <div className="flex flex-col gap-1">
                  <button className="btn-ghost btn-sm" onClick={() => setTerms(s)}><Percent size={14} /> النسب</button>
                  <button className="btn-ghost btn-sm" onClick={() => setEdit(s)}><Pencil size={14} /> بيانات</button>
                </div>}
              </div>
            ))}
          </div>
          <div className="card p-5 h-fit">
            <div className="font-bold mb-4">توزيع الأرباح السنوية</div>
            <div className="flex justify-center relative">
              <Donut parts={[...active.map((s: any, i: number) => ({ label: s.full_name, value: Number(s.profit_pct ?? 0), color: COLORS[i % COLORS.length] })), ...(totalPct < 100 ? [{ label: 'الشركة', value: 100 - totalPct, color: '#2E2E35' }] : [])]} />
              <div className="absolute inset-0 flex flex-col items-center justify-center"><div className="num text-2xl font-black">{num(totalPct, 1)}%</div><div className="text-[11px] text-zinc-500">للمساهمين</div></div>
            </div>
            {totalPct > 100 && <div className="mt-3 text-[13px] text-red-300 bg-red-500/10 rounded-xl px-3 py-2">مجموع النسب أكبر من 100%! يُرجى مراجعة النسب.</div>}
            {totalPct < 100 && <div className="mt-3 text-[12px] text-zinc-500">المتبقي {num(100 - totalPct, 1)}% يبقى للشركة.</div>}
            <div className="space-y-2 mt-4">{active.map((s: any, i: number) => (
              <div key={s.id} className="flex items-center gap-2 text-sm"><i className="w-3 h-3 rounded" style={{ background: COLORS[i % COLORS.length] }} /><span className="flex-1">{s.full_name}</span><span className="num">{num(s.profit_pct ?? 0, 2)}%</span></div>
            ))}</div>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <input type="month" className="input h-10 w-44" value={period} onChange={(e) => setPeriod(e.target.value)} />
            {can('shareholders', 'create') && <button className="btn-primary h-10" disabled={busy} onClick={async () => { await run(() => db.rpc('generate_shareholder_payouts', { p_period: period }), 'حُسبت المستحقات'); payouts.reload() }}><RefreshCw size={16} /> احتساب المستحقات {monthName(period)}</button>}
          </div>
          <div className="card overflow-hidden">
            {!payouts.data?.length ? <Empty title="لم تُحتسب المستحقات بعد" text="تُحتسب: المرتب الشهري + نسبة كل مساهم من مبيعات الشهر" /> : (
              <table className="tbl">
                <thead><tr><th>المساهم</th><th>المرتب</th><th>مبيعات الشهر</th><th>النسبة</th><th>نصيبه من المبيعات</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
                <tbody>{payouts.data.map((p: any) => (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.shareholder_name}</td><td><Money v={p.salary} cur={false} /></td><td className="text-zinc-400"><Money v={p.sales_base} cur={false} /></td>
                    <td className="num">{num(p.sales_pct, 2)}%</td><td className="text-emerald-300"><Money v={p.sales_share} cur={false} /></td>
                    <td><Money v={p.total} className="font-black text-brand-300" /></td><td><Badge cls={STATUS[p.status].cls}>{STATUS[p.status].label}</Badge></td>
                    <td>{p.status === 'draft' && can('shareholders', 'approve') && <button className="btn-primary btn-sm" disabled={busy} onClick={async () => {
                      if (await confirm.ask(`صرف ${sdg(p.total)} ج.س لـ ${p.shareholder_name}؟`, { text: 'يُخصم هذا المبلغ من نصيبه في الأرباح السنوية.' })) { await run(() => db.rpc('pay_shareholder_payout', { p_id: p.id }), 'تم الصرف'); payouts.reload() }
                    }}><CheckCircle2 size={14} /> صرف</button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 mt-3">تُخصم هذه المبالغ الشهرية من نصيب كل مساهم في تقرير الأرباح السنوية (صفحة التقارير).</p>
        </div>
      )}
      {edit && <ShareholderForm s={edit} onClose={() => setEdit(null)} />}
      {terms && <TermsModal s={terms} onClose={() => setTerms(null)} />}
      {confirm.node}
    </>
  )
}

function ShareholderForm({ s, onClose }: { s: Row; onClose: () => void }) {
  const { db, isAdmin } = useApp()
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const isNew = !s.id
  const [f, setF] = useState<Row>({ full_name: '', phone: '', joined_at: today(), notes: '', monthly_salary: '', sales_pct: '', profit_pct: '', ...s })
  const save = async () => {
    const ok = await run(async () => {
      const body = { full_name: f.full_name.trim(), phone: f.phone || null, joined_at: f.joined_at, notes: f.notes || null }
      if (isNew) {
        const [c] = await db.insert('shareholders', body)
        await db.insert('shareholder_terms', { shareholder_id: c.id, effective_from: f.joined_at, monthly_salary: Number(f.monthly_salary) || 0, sales_pct: Number(f.sales_pct) || 0, profit_pct: Number(f.profit_pct) || 0 })
      } else await db.update('shareholders', s.id, body)
      return true
    }, 'تم الحفظ')
    if (ok) onClose()
  }
  const leave = async () => {
    if (await confirm.ask(`إخراج ${s.full_name} من المساهمين؟`, { danger: true, text: 'سيتوقف احتساب نسبه اعتبارًا من اليوم، وسيبقى كل ما حصل عليه سابقًا مسجَّلًا في التقارير.' })) {
      if (await run(() => db.update('shareholders', s.id, { is_active: false, left_at: today() }), 'سُجِّل خروجه')) onClose()
    }
  }
  return (
    <Modal open onClose={onClose} width="max-w-lg" title={isNew ? 'مساهم جديد' : `بيانات: ${s.full_name}`}
      footer={<>
        {!isNew && isAdmin && s.is_active && <button className="btn-danger ml-auto" onClick={leave}><UserMinus size={16} /> إخراج من المساهمين</button>}
        <button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy || !f.full_name?.trim()} onClick={save}>حفظ</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاسم *" className="col-span-2"><input className="input" autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="الهاتف"><input className="input num" dir="ltr" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="تاريخ الدخول"><input type="date" className="input" value={f.joined_at} onChange={(e) => setF({ ...f, joined_at: e.target.value })} /></Field>
        {isNew && <>
          <Field label="المرتب الشهري (ج.س)"><input className="input num" value={f.monthly_salary} onChange={(e) => setF({ ...f, monthly_salary: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="نسبة من المبيعات %"><input className="input num" value={f.sales_pct} onChange={(e) => setF({ ...f, sales_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="نسبة من الأرباح السنوية %" className="col-span-2"><input className="input num" value={f.profit_pct} onChange={(e) => setF({ ...f, profit_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </>}
        <Field label="ملاحظات" className="col-span-2"><input className="input" value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {confirm.node}
    </Modal>
  )
}

function TermsModal({ s, onClose }: { s: Row; onClose: () => void }) {
  const { db } = useApp()
  const { busy, run } = useAction()
  const hist = useLoad(() => db.list('shareholder_terms', { eq: { shareholder_id: s.id }, order: [{ col: 'effective_from', asc: false }, { col: 'created_at', asc: false }] }), [s.id])
  const [f, setF] = useState({ effective_from: today().slice(0, 8) + '01', monthly_salary: String(s.monthly_salary ?? ''), sales_pct: String(s.sales_pct ?? ''), profit_pct: String(s.profit_pct ?? '') })
  const save = async () => {
    const ok = await run(() => db.insert('shareholder_terms', { shareholder_id: s.id, effective_from: f.effective_from, monthly_salary: Number(f.monthly_salary) || 0, sales_pct: Number(f.sales_pct) || 0, profit_pct: Number(f.profit_pct) || 0 }), 'سُجِّلت النسب الجديدة — وأُرسل إشعار إلى مدير النظام')
    if (ok) onClose()
  }
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={`تغيير نسب: ${s.full_name}`} subtitle="يسري التعديل من التاريخ الذي تختاره، وتبقى الأشهر السابقة بالنسب القديمة"
      footer={<><button className="btn-ghost" onClick={onClose}>إلغاء</button><button className="btn-primary" disabled={busy} onClick={save}>حفظ النسب الجديدة</button></>}>
      <div className="grid grid-cols-4 gap-3">
        <Field label="ساري من"><input type="date" className="input" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></Field>
        <Field label="المرتب الشهري"><input className="input num" value={f.monthly_salary} onChange={(e) => setF({ ...f, monthly_salary: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="% من المبيعات"><input className="input num" value={f.sales_pct} onChange={(e) => setF({ ...f, sales_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="% من الأرباح"><input className="input num" value={f.profit_pct} onChange={(e) => setF({ ...f, profit_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      </div>
      <div className="mt-6">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><History size={15} className="text-brand-500" /> سجل النسب</div>
        <table className="tbl">
          <thead><tr><th>من</th><th>المرتب</th><th>المبيعات</th><th>الأرباح</th><th>تم التسجيل</th></tr></thead>
          <tbody>{(hist.data ?? []).map((t: any) => (
            <tr key={t.id}><td>{date(t.effective_from)}</td><td><Money v={t.monthly_salary} cur={false} /></td><td className="num">{num(t.sales_pct, 2)}%</td><td className="num">{num(t.profit_pct, 2)}%</td><td className="text-zinc-500 text-[12px]">{date(t.created_at)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  )
}
