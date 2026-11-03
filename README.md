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
4. `supabase/migrations/0004_push_webhook.sql` (ربط الإشعارات بالموبايل)
5. `supabase/migrations/0005_returns.sql` (مرتجع جزئي من الفاتورة + إلغاء المشتريات)
6. `supabase/migrations/0006_backup.sql` (النسخ الاحتياطي والاسترجاع)
7. `supabase/migrations/0007_product_images.sql` (صور الأصناف في جدول لوحدها)
8. `supabase/migrations/0008_fusha_messages.sql` (رسائل النظام والإشعارات بالفصحى)
9. `supabase/migrations/0009_backup_storage.sql` (مخزن النسخ الاحتياطية التلقائية لنسخة الموقع)
10. `supabase/migrations/0010_check_in_fix.sql` (تسجيل الحضور لو الأدمن عمل سجل لليوم قبل الموظف)
11. `supabase/migrations/0011_customer_tax_id.sql` (الرقم الضريبي للعميل على الفاتورة)
12. `supabase/migrations/0012_invoice_fields.sql` (كل خانات الفاتورة بتتكتب من الشاشة)
13. `supabase/migrations/0013_peek_doc_number.sql` (رقم الفاتورة الجاي على الشاشة)
14. `supabase/migrations/0014_hours_payroll.sql` (المرتب بالساعات + العطلات + الزيادات)
15. `supabase/migrations/0015_admin_delete.sql` (الحذف النهائي لمدير النظام)

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

## نسخة الموقع (Vercel)

نفس برنامج `desktop/` بيترفع كموقع: مشروع Vercel جديد من نفس الـ repo، و**Root Directory = `desktop`** (الإعدادات في `desktop/vercel.json`).
- الموقع مقفول على قاعدة بيانات والي بلازا: مفيش وضع تجربة ولا «تغيير قاعدة البيانات».
- النسخة الاحتياطية اليومية بتترفع على مخزن `backups` الخاص في Supabase (آخر 30 يوم)، وتتسترجع من الإعدادات.

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

## تطبيق الأندرويد للأدمن

نفس موقع الأدمن ملفوف في تطبيق أندرويد (Capacitor)، والإشعارات بتوصله من Firebase مباشرة حتى والتطبيق مقفول.

- ملف التثبيت: `admin-app/release/WaliCore-Admin.apk`
- مفاتيح Firebase ومفتاح توقيع التطبيق في فولدر `firebase/` (مش على GitHub). **متمسحوش `wali-admin.jks`** — من غيره التحديثات مش هتتسطّب فوق التطبيق القديم.
- Java مش بيتعامل مع اسم الفولدر العربي، فالبناء بيتم من حرف درايف مؤقت:
  ```bash
  subst W: "D:\سيستم والي بلازا"
  cd W:\admin-app && npm run build && npx cap sync android
  cp ../firebase/google-services.json android/app/
  cd android && set GRADLE_USER_HOME=W:\.cache\gradle && gradlew assembleRelease
  ```
- دالة `push-notify` محتاجة السر `FCM_SERVICE_ACCOUNT` (محتوى `firebase/service-account.json`).

---

## حسابات وضع التجربة

| الدور | الاسم | كلمة السر |
|---|---|---|
| المدير | admin | admin123 |
| المعرض | sara / ahmed | sara123 / ahmed123 |
| المحاسب | mohamed | mohamed123 |
| المخزن | khaled | khaled123 |
