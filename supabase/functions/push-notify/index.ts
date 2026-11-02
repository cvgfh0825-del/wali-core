// بيبعت إشعار على موبايل الأدمن (Web Push) مع كل صف جديد في جدول notifications
// بيتشغّل من Database Webhook: notifications → INSERT → هذه الدالة
// المتغيرات المطلوبة: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

Deno.serve(async (req) => {
  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  const payload = await req.json()
  const n = payload.record
  if (!n) return new Response('no record', { status: 400 })

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:info@waliplaza.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: subs } = await db.from('push_subscriptions').select('*')

  const message = JSON.stringify({
    id: n.id,
    title: n.title,
    body: [n.body, n.actor_name ? `— ${n.actor_name}` : ''].filter(Boolean).join(' '),
    level: n.level,
    url: `/#/n/${n.id}`,
  })

  let sent = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, {
        TTL: 60 * 60 * 24,
        // high علشان أندرويد ميأجلش الإشعار والموبايل نايم
        urgency: 'high',
      })
      sent++
    } catch (e) {
      // الاشتراك انتهى (الأدمن مسح التطبيق) → نشيله
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', s.id)
      }
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } })
})
