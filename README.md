# WALI CORE — نظام إدارة والي بلازا

## المشروع فيه إيه

| الفولدر | إيه هو |
|---|---|
| `desktop/` | برنامج Windows للموظفين (Electron + React) |
| `admin-app/` | موقع الأدمن للموبايل (PWA) — بيتسطّب على الآيفون وبيستقبل الإشعارات |
| `supabase/migrations/` | الداتا بيز كاملة: الجداول والصلاحيات والعمليات والإشعارات |
| `supabase/functions/` | دالتين على Supabase: إنشاء المستخدمين، وإرسال الإشعارات للموبايل |
| `desktop/release/` | ملف التثبيت `WaliCore-Setup-1.0.0.exe` |

كل الكاش والملفات المؤقتة في `.cache/` على D.

---

## تشغيل Supabase (مرة واحدة)

### 1) الداتا بيز
افتح **SQL Editor** في Supabase، والصق ملف `supabase/setup_all.sql` كله واضغط Run (الملف ده فيه التلات ملفات دول ورا بعض)، أو شغّلهم **بالترتيب**، كل ملف لوحده:
1. `supabase/migrations/0001_core.sql`
2. `supabase/migrations/0002_logic.sql`
3. `supabase/migrations/0003_security_notify.sql`

### 2) أول حساب (هيبقى Admin تلقائياً)
من **Authentication ← Users ← Add user**:
- الإيميل: `admin@wali.local` (اسم الدخول في البرنامج هيبقى `admin`)
- كلمة السر: اللي تختارها
- علّم على **Auto Confirm User**

أول مستخدم يتعمل في السيستم بيبقى Admin لوحده. بعد كده الأدمن بيعمل باقي الحسابات من جوه البرنامج.

### 3) الدوال (Edge Functions)
محتاج [Supabase CLI](https://supabase.com/docs/guides/cli). من فولدر المشروع:
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy admin-users
npx supabase functions deploy push-notify --no-verify-jwt
```
مفاتيح الإشعارات موجودة في `supabase/.vapid-keys.json` (متتشاركش الملف ده):
```bash
npx supabase secrets set VAPID_PUBLIC_KEY=<publicKey> VAPID_PRIVATE_KEY=<privateKey> VAPID_SUBJECT=mailto:info@waliplaza.com WEBHOOK_SECRET=<أي كلمة سر طويلة>
```

### 4) ربط الإشعارات بالموبايل
ملف `0004_push_webhook.sql` بيعمل trigger بيبعت كل إشعار جديد لدالة `push-notify` (عن طريق pg_net). بعد تشغيله:
```sql
insert into private.config values
  ('push_url', 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notify'),
  ('webhook_secret', '<نفس WEBHOOK_SECRET>');
```
(على مشروع والي بلازا الحالي ده متعمل خلاص، والسر محفوظ في `supabase/.webhook-secret`.)

---

## برنامج Windows

- **للتجربة:** `desktop/release/WaliCore-Setup-1.0.0.exe` — أول ما يفتح يطلب رابط Supabase والمفتاح العام (anon key)، أو تختار «جرّب السيستم الأول» ببيانات وهمية.
- **عشان العميل ميكتبش بيانات Supabase:** اعمل ملف `desktop/.env` فيه:
  ```
  VITE_SUPABASE_URL=https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY=...
  ```
  وبعدين ابني من جديد:
  ```bash
  cd desktop && npm run dist
  ```
- بيانات البرنامج على جهاز العميل بتتحفظ في `D:\WaliCore` لو في قرص D.

### التطوير
```bash
cd desktop && npm run dev
```
واختبار الداتا بيز (Postgres حقيقي جوه Node، 44 اختبار):
```bash
cd desktop && npm run test:db
```

---

## موقع الأدمن (الآيفون)

1. اعمل `admin-app/.env` من `admin-app/.env.example`، وحط فيه رابط Supabase والمفتاح العام.
2. ارفعه على Vercel: Root Directory = `admin-app`، والمتغيرات نفسها اللي في `.env`.
3. على موبايل أندرويد: افتح اللينك من **Google Chrome** ← سجّل دخول ← دوس «ثبّت التطبيق على الموبايل» ← افتحه من الأيقونة ← «تفعيل الإشعارات».

---

## حسابات وضع التجربة

| الدور | الاسم | كلمة السر |
|---|---|---|
| المدير | admin | admin123 |
| المعرض | sara / ahmed | sara123 / ahmed123 |
| المحاسب | mohamed | mohamed123 |
| المخزن | khaled | khaled123 |
