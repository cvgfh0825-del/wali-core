import { useEffect, useState } from 'react'
import { Settings as Cog, Building2, Clock, DatabaseBackup, ScrollText, ImagePlus, Download, Unplug, Upload, History, FolderOpen, CloudUpload, RotateCcw } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Field, Tabs, Loading, Badge, Empty, useConfirm, NoAccess } from '../components/ui'
import { saveConn, LOCKED } from '../lib/backend'
import { makeBackup, lastAutoBackup, hasCloudBackups, listCloudBackups, uploadCloudBackup, downloadCloudBackup } from '../lib/backup'

const TABLES = ['settings', 'profiles', 'categories', 'products', 'stock_movements', 'customers', 'suppliers', 'purchases', 'purchase_items',
  'invoices', 'invoice_items', 'sales_returns', 'delivery_permits', 'delivery_items', 'payments', 'expense_categories', 'expenses', 'exchange_rates',
  'employees', 'attendance', 'salary_advances', 'salary_deductions', 'payrolls', 'shareholders', 'shareholder_terms', 'shareholder_payouts', 'backup']
import { dateTime } from '../lib/format'


const ACTION: Record<string, { label: string; cls: string }> = {
  insert: { label: 'إضافة', cls: 'bg-emerald-500/15 text-emerald-300' },
  update: { label: 'تعديل', cls: 'bg-amber-500/15 text-amber-300' },
  delete: { label: 'حذف', cls: 'bg-red-500/15 text-red-300' },
}

export default function Settings() {
  const { can, isAdmin, db } = useApp()
  const [tab, setTab] = useState<'company' | 'work' | 'backup' | 'audit'>('company')
  if (!can('settings')) return <NoAccess />
  return (
    <>
      <PageHeader title="الإعدادات" icon={<Cog size={22} />} />
      <Tabs value={tab} onChange={setTab} items={[
        { key: 'company', label: <span className="flex items-center gap-2"><Building2 size={15} /> الشركة والفاتورة</span> },
        { key: 'work', label: <span className="flex items-center gap-2"><Clock size={15} /> مواعيد العمل</span> },
        { key: 'backup', label: <span className="flex items-center gap-2"><DatabaseBackup size={15} /> نسخ احتياطي</span> },
        ...(isAdmin ? [{ key: 'audit' as const, label: <span className="flex items-center gap-2"><ScrollText size={15} /> سجل التدقيق</span> }] : []),
      ]} />
      <div className="mt-5">
        {tab === 'company' && <CompanyForm />}
        {tab === 'work' && <WorkForm />}
        {tab === 'backup' && <Backup />}
        {tab === 'audit' && <Audit />}
      </div>
      <div className="mt-10 text-[12px] text-zinc-600">متصل بـ: {db.mode === 'demo' ? 'الوضع التجريبي (على هذا الجهاز)' : (db as any).sb?.supabaseUrl}</div>
    </>
  )
}

function useSettingsForm() {
  const { db, settings, reloadSettings, can } = useApp()
  const { busy, run } = useAction()
  const [f, setF] = useState<any>(settings)
  useEffect(() => setF(settings), [settings])
  const save = async (keys: string[]) => {
    const patch = Object.fromEntries(keys.map((k) => [k, f[k] === '' ? null : f[k]]))
    if (await run(() => db.update('settings', 1, patch), 'حُفظت الإعدادات')) reloadSettings()
  }
  return { f, setF, save, busy, canEdit: can('settings', 'edit') }
}

function CompanyForm() {
  const { f, setF, save, busy, canEdit } = useSettingsForm()
  const keys = ['company_name', 'company_name_en', 'phone1', 'phone2', 'email', 'address', 'logo', 'invoice_footer']
  const onLogo = async (file: File) => {
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode()
    const s = Math.min(1, 300 / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    setF({ ...f, logo: c.toDataURL('image/png') })
  }
  return (
    <div className="card p-6 max-w-4xl grid grid-cols-[180px_1fr] gap-6">
      <div>
        <label className="block aspect-square rounded-2xl border-2 border-dashed border-ink-600 hover:border-brand-500/60 bg-white/95 overflow-hidden cursor-pointer">
          {f.logo ? <img src={f.logo} className="w-full h-full object-contain p-3" /> : <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2"><ImagePlus size={28} /><span className="text-sm">شعار الفاتورة</span></div>}
          <input type="file" accept="image/*" className="hidden" disabled={!canEdit} onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])} />
        </label>
        {f.logo && canEdit && <button className="text-[12px] text-red-300 mt-2" onClick={() => setF({ ...f, logo: null })}>إزالة الشعار</button>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="اسم الشركة"><input className="input" value={f.company_name ?? ''} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
        <Field label="الاسم بالإنجليزية"><input className="input" dir="ltr" value={f.company_name_en ?? ''} onChange={(e) => setF({ ...f, company_name_en: e.target.value })} /></Field>
        <Field label="الهاتف 1"><input className="input num" dir="ltr" value={f.phone1 ?? ''} onChange={(e) => setF({ ...f, phone1: e.target.value })} /></Field>
        <Field label="الهاتف 2"><input className="input num" dir="ltr" value={f.phone2 ?? ''} onChange={(e) => setF({ ...f, phone2: e.target.value })} /></Field>
        <Field label="البريد الإلكتروني"><input className="input" dir="ltr" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="العنوان"><input className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="جملة آخر الفاتورة" className="col-span-2"><input className="input" value={f.invoice_footer ?? ''} onChange={(e) => setF({ ...f, invoice_footer: e.target.value })} /></Field>
        {canEdit && <div className="col-span-2"><button className="btn-primary" disabled={busy} onClick={() => save(keys)}>حفظ</button></div>}
      </div>
    </div>
  )
}

function WorkForm() {
  const { f, setF, save, busy, canEdit } = useSettingsForm()
  return (
    <div className="card p-6 max-w-2xl grid grid-cols-2 gap-4">
      <Field label="بداية العمل"><input type="time" className="input" value={String(f.work_start ?? '').slice(0, 5)} onChange={(e) => setF({ ...f, work_start: e.target.value })} /></Field>
      <Field label="نهاية العمل"><input type="time" className="input" value={String(f.work_end ?? '').slice(0, 5)} onChange={(e) => setF({ ...f, work_end: e.target.value })} /></Field>
      <Field label="دقائق السماح قبل احتساب التأخير"><input className="input num" value={f.late_grace_minutes ?? ''} onChange={(e) => setF({ ...f, late_grace_minutes: e.target.value.replace(/\D/g, '') })} /></Field>
      <Field label="خصم كل دقيقة تأخير (ج.س)" hint="صفر = يُسجَّل التأخير فقط دون خصم"><input className="input num" value={f.late_deduction_per_min ?? ''} onChange={(e) => setF({ ...f, late_deduction_per_min: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      <Field label="حد التنبيه الافتراضي للمخزن"><input className="input num" value={f.low_stock_default ?? ''} onChange={(e) => setF({ ...f, low_stock_default: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      {canEdit && <div className="col-span-2"><button className="btn-primary" disabled={busy} onClick={() => save(['work_start', 'work_end', 'late_grace_minutes', 'late_deduction_per_min', 'low_stock_default'])}>حفظ</button></div>}
    </div>
  )
}

function Backup() {
  const { db, isAdmin, toast } = useApp()
  const [busy, setBusy] = useState('')
  const confirm = useConfirm()
  const w = (window as any).wali
  const last = lastAutoBackup()
  const exportAll = async () => {
    setBusy('جارٍ تجهيز النسخة...')
    try {
      const { name, json } = await makeBackup(db)
      if (w?.saveFile) {
        const p = await w.saveFile(name, json)
        if (p) toast('حُفظت النسخة في: ' + p)
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name; a.click()
        toast('نُزِّلت النسخة')
      }
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy('') }
  }
  const cloud = hasCloudBackups(db) && isAdmin
  const list = useLoad(() => (cloud ? listCloudBackups(db) : Promise.resolve([])), [cloud])
  const restore = async (file: File) => {
    let p: any
    try { p = JSON.parse(await file.text()) } catch { return toast('هذا الملف ليس نسخة احتياطية', 'err') }
    return restoreData(p)
  }
  const restoreCloud = async (path: string) => {
    setBusy('جارٍ تحميل النسخة...')
    let p: any
    try { p = JSON.parse(await downloadCloudBackup(db, path)) } catch (e: any) { setBusy(''); return toast(e.message, 'err') }
    setBusy('')
    return restoreData(p)
  }
  const downloadCloud = async (path: string, name: string) => {
    try {
      const json = await downloadCloudBackup(db, path)
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `wali-core-${name}`; a.click()
    } catch (e: any) { toast(e.message, 'err') }
  }
  const restoreData = async (p: any) => {
    if (p?.app !== 'wali-core' || !p.tables) return toast('هذا الملف ليس نسخة احتياطية من WALI CORE', 'err')
    const ok = await confirm.ask('استرجاع النسخة الاحتياطية؟', {
      danger: true,
      text: `ستُحذف جميع البيانات الحالية (الأصناف، الفواتير، الحسابات، الموظفون...) وتُستبدل بهذه النسخة: ${dateTime(p.created_at)} — ${p.tables.invoices?.length ?? 0} فاتورة و${p.tables.products?.length ?? 0} صنف. لن يتغير المستخدمون وكلمات المرور، وستُحفظ نسخة من الوضع الحالي أولًا.`,
    })
    if (!ok) return
    try {
      setBusy('جارٍ حفظ نسخة من الوضع الحالي...')
      const cur = await makeBackup(db, 'before-restore')
      if (w?.autoBackup) await w.autoBackup(cur.name, cur.json)
      else if (cloud) await uploadCloudBackup(db, `before-restore/${cur.name}`, cur.json)
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([cur.json], { type: 'application/json' })); a.download = cur.name; a.click() }
      setBusy('جارٍ الاسترجاع...')
      await db.rpc('restore_backup', { p })
      toast('استُرجعت النسخة')
      setTimeout(() => location.reload(), 800)
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy('') }
  }
  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-6">
        <div className="font-bold text-lg flex items-center gap-2"><DatabaseBackup size={20} className="text-brand-500" /> نسخة احتياطية كاملة</div>
        <p className="text-sm text-zinc-400 mt-2 leading-7">يصدّر جميع البيانات (الأصناف، الفواتير، الحسابات، الموظفين، المساهمين...) في ملف واحد. احفظه على ذاكرة خارجية أو على القرص D بعيدًا عن البرنامج.</p>
        <div className="flex gap-2 mt-4 flex-wrap">
          <button className="btn-primary" disabled={!!busy || !isAdmin} onClick={exportAll}><Download size={17} /> {busy || 'تصدير نسخة الآن'}</button>
          {isAdmin && <label className={`btn-ghost cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={17} /> استرجاع نسخة
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f) }} />
          </label>}
        </div>
        {!isAdmin && <p className="text-[12px] text-zinc-500 mt-2">النسخ الاحتياطي متاح لمدير النظام فقط.</p>}
      </div>
      {isAdmin && w?.autoBackup && (
        <div className="card p-6">
          <div className="font-bold flex items-center gap-2"><History size={18} className="text-brand-500" /> نسخة تلقائية كل يوم</div>
          <p className="text-sm text-zinc-400 mt-2 leading-7">عند أول فتح للبرنامج من مدير النظام كل يوم، تُنشأ نسخة تلقائيًا في <span dir="ltr" className="num">D:\WaliCore\Backups\auto</span>، ويُحتفظ بآخر 30 يومًا.</p>
          <div className="flex items-center gap-3 mt-4">
            <button className="btn-ghost" onClick={() => w.openBackups()}><FolderOpen size={17} /> فتح المجلد</button>
            <span className="text-sm text-zinc-500">{last ? `آخر نسخة: ${last}` : 'لا توجد نسخ بعد'}</span>
          </div>
        </div>
      )}
      {cloud && (
        <div className="card p-6">
          <div className="font-bold flex items-center gap-2"><CloudUpload size={18} className="text-brand-500" /> نسخة تلقائية كل يوم</div>
          <p className="text-sm text-zinc-400 mt-2 leading-7">عند أول دخول لمدير النظام كل يوم، تُحفظ نسخة تلقائيًا في مخزن خاص على الخادم لا يصل إليه غير مدير النظام، ويُحتفظ بآخر 30 يومًا.</p>
          {list.loading ? <Loading /> : !list.data?.length ? <p className="text-sm text-zinc-500 mt-4">لا توجد نسخ بعد</p> : (
            <div className="mt-4 divide-y divide-ink-700 border border-ink-700 rounded-xl max-h-80 overflow-auto">
              {list.data.map((b) => (
                <div key={b.path} className="flex items-center gap-3 px-4 py-2.5">
                  <History size={16} className="text-zinc-500" />
                  <span className="num flex-1">{b.name.replace('.json', '')}</span>
                  <span className="num text-[12px] text-zinc-500">{(b.size / 1024 / 1024).toFixed(1)} م.ب</span>
                  <button className="btn-ghost btn-sm" title="تنزيل" onClick={() => downloadCloud(b.path, b.name)}><Download size={15} /></button>
                  <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => restoreCloud(b.path)}><RotateCcw size={15} /> استرجاع</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!LOCKED && <div className="card p-6">
        <div className="font-bold flex items-center gap-2"><Unplug size={18} className="text-zinc-400" /> قاعدة البيانات</div>
        <p className="text-sm text-zinc-400 mt-2">لربط هذا الجهاز بقاعدة بيانات أخرى (أو للخروج من الوضع التجريبي).</p>
        <button className="btn-danger mt-4" onClick={async () => { if (await confirm.ask('هل تريد فصل الجهاز عن قاعدة البيانات؟', { danger: true, text: 'ستحتاج إلى إدخال بيانات Supabase مرة أخرى، ولن تُحذف البيانات نفسها.' })) { saveConn(null); location.reload() } }}>فصل وإعادة الإعداد</button>
      </div>}
      {confirm.node}
    </div>
  )
}

function Audit() {
  const { db } = useApp()
  const [table, setTable] = useState('')
  const [open, setOpen] = useState<any>(null)
  const { data, loading } = useLoad(() => db.list('audit_log', { eq: table ? { table_name: table } : {}, order: [{ col: 'created_at', asc: false }], limit: 300 }), [table])
  return (
    <>
      <select className="input w-64 h-10 mb-4" value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">كل الجداول</option>{TABLES.map((t) => <option key={t}>{t}</option>)}</select>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : !data?.length ? <Empty /> : (
          <div className="max-h-[calc(100vh-330px)] overflow-auto">
            <table className="tbl">
              <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الجدول</th><th>التغيير</th></tr></thead>
              <tbody>{data.map((a: any) => {
                const changed = a.action === 'update' ? Object.keys(a.new_data ?? {}).filter((k) => JSON.stringify(a.new_data[k]) !== JSON.stringify(a.old_data?.[k]) && k !== 'updated_at') : []
                return (
                  <tr key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                    <td className="text-zinc-400 text-[13px] num">{dateTime(a.created_at)}</td><td>{a.user_name ?? 'النظام'}</td>
                    <td><Badge cls={ACTION[a.action].cls}>{ACTION[a.action].label}</Badge></td><td className="num text-zinc-400">{a.table_name}</td>
                    <td className="text-[12px] text-zinc-500 num max-w-[380px] truncate">{changed.join('، ')}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8" onClick={() => setOpen(null)}>
          <div className="card p-6 max-w-4xl w-full max-h-[80vh] overflow-auto grid grid-cols-2 gap-4 selectable" onClick={(e) => e.stopPropagation()}>
            <div><div className="font-bold mb-2 text-red-300">قبل</div><pre className="text-[11px] text-zinc-400 whitespace-pre-wrap num" dir="ltr">{JSON.stringify(open.old_data, null, 2)}</pre></div>
            <div><div className="font-bold mb-2 text-emerald-300">بعد</div><pre className="text-[11px] text-zinc-300 whitespace-pre-wrap num" dir="ltr">{JSON.stringify(open.new_data, null, 2)}</pre></div>
          </div>
        </div>
      )}
    </>
  )
}
