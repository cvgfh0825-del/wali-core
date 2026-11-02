// بيبعت إشعار على موبايل الأدمن (Web Push) مع كل صف جديد في جدول notifications
// بيتشغّل من Database Webhook: notifications → INSERT → هذه الدالة
// المتغيرات المطلوبة: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET
// وتطبيق الأندرويد: FCM_SERVICE_ACCOUNT (ملف service account من Firebase كله كـ JSON)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

// ---- Firebase Cloud Messaging (تطبيق الأندرويد) ----
const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

let fcmCache: { token: string; exp: number; project: string } | null = null
async function fcmAuth() {
  if (fcmCache && fcmCache.exp > Date.now() + 60_000) return fcmCache
  const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!)
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri, iat: now, exp: now + 3600 }))
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('fcm auth: ' + JSON.stringify(j))
  fcmCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000, project: sa.project_id }
  return fcmCache
}

// بيرجّع false لو الـ token مبقاش صالح (التطبيق اتمسح)
async function sendFcm(token: string, m: { id: string; title: string; body: string; url: string }) {
  const a = await fcmAuth()
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: m.title, body: m.body },
        data: { id: String(m.id), url: m.url },
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'wali', sound: 'default', tag: String(m.id) } },
      },
    }),
  })
  if (r.ok) return true
  const t = await r.text()
  if (r.status === 404 || t.includes('UNREGISTERED')) return false
  throw new Error(`fcm ${r.status}: ${t}`)
}

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

  const msg = {
    id: n.id,
    title: n.title,
    body: [n.body, n.actor_name ? `— ${n.actor_name}` : ''].filter(Boolean).join(' '),
    level: n.level,
    url: `/#/n/${n.id}`,
  }
  const message = JSON.stringify(msg)

  let sent = 0
  for (const s of subs ?? []) {
    if (s.endpoint.startsWith('fcm:')) {
      try {
        if (await sendFcm(s.endpoint.slice(4), msg)) sent++
        else await db.from('push_subscriptions').delete().eq('id', s.id)
      } catch (e) {
        console.error(e)
      }
      continue
    }
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
