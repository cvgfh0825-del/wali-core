import { useState } from 'react'
import { Truck, CheckCircle2, Printer, Ban } from 'lucide-react'
import { useApp, useLoad, useAction } from '../lib/app'
import { PageHeader, Tabs, Badge, Empty, Loading, useConfirm, NoAccess } from '../components/ui'
import { printDoc, DeliveryDoc } from '../components/Print'
import { STATUS, dateTime, qty } from '../lib/format'
import type { Row } from '../lib/backend'
import { AdminDelete } from '../components/AdminDelete'

export default function Deliveries() {
  const { db, can, settings } = useApp()
  const [tab, setTab] = useState<'pending' | 'delivered' | 'cancelled'>('pending')
  const { busy, run } = useAction()
  const confirm = useConfirm()
  const { data, loading } = useLoad(() => db.list('v_delivery_permits', { eq: { status: tab }, order: [{ col: 'created_at', asc: false }], limit: 300 }), [tab], ['delivery_permits'])

  const itemsOf = async (p: Row) => {
    const di = await db.list('delivery_items', { eq: { permit_id: p.id } })
    const ii = await db.list('invoice_items', { in: { id: di.map((d: any) => d.invoice_item_id) } })
    return di.map((d: any) => { const x = ii.find((i: any) => i.id === d.invoice_item_id); return { code: x?.code, name: x?.name, qty: d.qty } })
  }
  const print = async (p: Row) => printDoc(<DeliveryDoc permit={p} items={await itemsOf(p)} settings={settings} />)
  const confirmDelivery = async (p: Row) => {
    if (await confirm.ask(`تأكيد تسليم ${p.number}؟`, { text: `خرجت البضاعة من المخزن وسُلِّمت إلى ${p.receiver_name ?? p.customer_name}.` })) {
      await run(() => db.rpc('confirm_delivery', { p_permit: p.id }), 'تم تأكيد التسليم')
    }
  }

  if (!can('delivery')) return <NoAccess />
  return (
    <>
      <PageHeader title="أذونات التسليم" icon={<Truck size={22} />} />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'pending', label: 'بانتظار التسليم' }, { key: 'delivered', label: 'سُلِّمت' }, { key: 'cancelled', label: 'ملغية' }]} />
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
        {loading ? <Loading /> : !data?.length ? <div className="card col-span-full"><Empty title={tab === 'pending' ? 'لا توجد أذونات معلّقة' : 'لا يوجد'} /></div> : data.map((p: any) => (
          <PermitCard key={p.id} p={p} itemsOf={itemsOf}
            actions={<>
              {can('delivery', 'print') && <button className="btn-ghost btn-sm" onClick={() => print(p)}><Printer size={15} /> طباعة</button>}
              <AdminDelete icon table="delivery_permits" id={p.id} label={`إذن التسليم ${p.number}`} />
              {p.status === 'pending' && can('delivery', 'cancel') && <button className="btn-danger btn-sm" disabled={busy} onClick={async () => { if (await confirm.ask('إلغاء الإذن؟', { danger: true })) await run(() => db.rpc('cancel_delivery', { p_permit: p.id }), 'أُلغي الإذن') }}><Ban size={15} /></button>}
              {p.status === 'pending' && can('delivery', 'approve') && <button className="btn-primary btn-sm mr-auto" disabled={busy} onClick={() => confirmDelivery(p)}><CheckCircle2 size={15} /> تأكيد التسليم</button>}
            </>} />
        ))}
      </div>
      {confirm.node}
    </>
  )
}

function PermitCard({ p, itemsOf, actions }: { p: Row; itemsOf: (p: Row) => Promise<any[]>; actions: any }) {
  const { data } = useLoad(() => itemsOf(p), [p.id])
  return (
    <div className={`card p-5 ${p.status === 'pending' ? 'border-amber-500/30' : ''}`}>
      <div className="flex items-start justify-between">
        <div><div className="num font-bold" dir="ltr">{p.number}</div><div className="text-[12px] text-zinc-500 num" dir="ltr">{p.invoice_number}</div></div>
        <Badge cls={STATUS[p.status].cls}>{STATUS[p.status].label}</Badge>
      </div>
      <div className="mt-3 text-sm"><span className="text-zinc-500">المستلم:</span> {p.receiver_name ?? p.customer_name}</div>
      <div className="mt-3 space-y-1.5">
        {(data ?? []).map((i, k) => (
          <div key={k} className="flex justify-between text-[13px] bg-ink-900 rounded-lg px-3 py-2"><span className="truncate">{i.name}</span><span className="num font-bold text-brand-300">× {qty(i.qty)}</span></div>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500 mt-3">أصدره {p.created_by_name} · {dateTime(p.created_at)}{p.delivered_at && <><br />سلّمه {p.delivered_by_name} · {dateTime(p.delivered_at)}</>}</div>
      <div className="flex items-center gap-2 mt-4">{actions}</div>
    </div>
  )
}
