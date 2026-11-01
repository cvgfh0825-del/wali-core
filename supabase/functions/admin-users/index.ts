// إدارة المستخدمين (للأدمن بس): إنشاء حساب، تغيير كلمة السر
// Deploy: supabase functions deploy admin-users
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// اسم المستخدم بيتحول لإيميل داخلي عشان Supabase Auth محتاج إيميل
const toEmail = (username: string) => `${username.trim().toLowerCase()}@wali.local`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })

    const { data: me } = await caller.auth.getUser()
    if (!me?.user) return json({ error: 'سجّل دخول الأول' }, 401)
    const { data: allowed } = await caller.rpc('has_perm', { p_module: 'users', p_action: 'create' })
    if (!allowed) return json({ error: 'ليس لديك صلاحية إدارة المستخدمين' }, 403)

    const body = await req.json()

    if (body.action === 'create') {
      const username = String(body.username ?? '').trim().toLowerCase()
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'اسم المستخدم لازم يكون إنجليزي من 3 لـ 30 حرف' }, 400)
      if (String(body.password ?? '').length < 6) return json({ error: 'كلمة السر لازم 6 حروف على الأقل' }, 400)
      const { data, error } = await service.auth.admin.createUser({
        email: toEmail(username),
        password: body.password,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: body.full_name ?? '',
          role: body.role ?? 'custom',
          permissions: body.permissions ?? {},
        },
      })
      if (error) return json({ error: error.message.includes('already') ? 'اسم المستخدم ده موجود' : error.message }, 400)
      return json({ id: data.user.id })
    }

    if (body.action === 'set_password') {
      if (String(body.password ?? '').length < 6) return json({ error: 'كلمة السر لازم 6 حروف على الأقل' }, 400)
      const { error } = await service.auth.admin.updateUserById(body.id, { password: body.password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'عملية غير معروفة' }, 400)
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
})
