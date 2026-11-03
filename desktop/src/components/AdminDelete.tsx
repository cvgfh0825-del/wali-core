import { Trash2 } from 'lucide-react'
import { useApp } from '../lib/app'
import { useConfirm } from './ui'

// زرار الحذف النهائي — لمدير النظام بس. بيمسح السجل وكل اللي مربوط بيه (admin_delete)
export function AdminDelete({ table, id, label, onDone, icon = false }: { table: string; id: string; label: string; onDone?: () => void; icon?: boolean }) {
  const { db, isAdmin, toast } = useApp()
  const confirm = useConfirm()
  if (!isAdmin) return null
  const go = async () => {
    const ok = await confirm.ask(`حذف نهائي: ${label}؟`, {
      danger: true, ok: 'حذف نهائي', cancel: 'لا',
      text: 'سيُحذف هذا السجل وكل ما يرتبط به (الأصناف، الدفعات، أذونات التسليم، حركات المخزن...) ويُعاد حساب المخزون. لا يمكن التراجع عن الحذف إلا من نسخة احتياطية.',
    })
    if (!ok) return
    try {
      await db.rpc('admin_delete', { p_table: table, p_id: id })
      toast('تم الحذف النهائي')
      onDone?.()
    } catch (e: any) { toast(e.message, 'err') }
  }
  return (
    <>
      {icon
        ? <button title="حذف نهائي" onClick={go} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-500/10"><Trash2 size={15} /></button>
        : <button onClick={go} className="btn-danger"><Trash2 size={16} /> حذف نهائي</button>}
      {confirm.node}
    </>
  )
}
