-- =====================================================================
--  WALI CORE — نظام إدارة والي بلازا
--  0001: الجداول الأساسية
--  شغّل الملفات بالترتيب في Supabase SQL Editor: 0001 ثم 0002 ثم 0003
-- =====================================================================

-- gen_random_uuid() موجودة جوه Postgres 13+ ومش محتاجة إضافات

-- كل التواريخ بتوقيت الخرطوم مش UTC
create or replace function public.local_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Khartoum')::date $$;

-- ---------------------------------------------------------------------
-- المستخدمون والصلاحيات
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  full_name    text not null default '',
  role         text not null default 'custom'
               check (role in ('admin','accountant','warehouse','showroom','custom')),
  permissions  jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  phone        text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- إعدادات الشركة (صف واحد)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                     int primary key default 1 check (id = 1),
  company_name           text not null default 'والي بلازا',
  company_name_en        text not null default 'Wali Plaza',
  phone1                 text default '+249 91 230 8288',
  phone2                 text default '+249 91 239 8880',
  email                  text default 'info@waliplaza.com',
  address                text default '',
  logo                   text,                       -- data URL
  currency               text not null default 'SDG',
  currency_label         text not null default 'ج.س',
  invoice_footer         text default 'شكراً لتعاملكم مع والي بلازا — ضمان سنة ضد عيوب الصناعة',
  low_stock_default      numeric not null default 2,
  work_start             time not null default '09:00',
  work_end               time not null default '17:00',
  late_grace_minutes     int not null default 15,
  late_deduction_per_min numeric not null default 0,
  updated_at             timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- سعر الصرف (الريت) اليومي
-- ---------------------------------------------------------------------
create table if not exists public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  rate        numeric(14,4) not null check (rate > 0),
  rate_date   date not null default public.local_today(),
  note        text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists exchange_rates_date_idx on public.exchange_rates(rate_date desc, created_at desc);

-- ---------------------------------------------------------------------
-- الترقيم التلقائي للمستندات
-- ---------------------------------------------------------------------
create table if not exists public.doc_counters (
  kind  text not null,
  year  int  not null,
  last  int  not null default 0,
  primary key (kind, year)
);

-- ---------------------------------------------------------------------
-- الأصناف والمخزن
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  barcode      text unique,
  name         text not null,
  model        text,
  category_id  uuid references public.categories(id) on delete set null,
  unit         text not null default 'قطعة',
  cost_usd     numeric(14,4) not null default 0,   -- التكلفة النهائية (بعد الشحن والجمارك)
  margin_pct   numeric(7,2)  not null default 0,   -- نسبة الربح
  price_usd    numeric(14,4) not null default 0,   -- سعر البيع بالدولار
  auto_price   boolean not null default true,      -- السعر = التكلفة × (1 + الربح)
  qty_on_hand  numeric(14,3) not null default 0,
  min_qty      numeric(14,3) not null default 2,
  image        text,                               -- data URL مصغّرة
  notes        text,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists products_name_idx on public.products(name);

create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id),
  kind          text not null check (kind in
                ('purchase_in','sale_out','cancel_in','adjust_in','adjust_out','opening')),
  qty           numeric(14,3) not null,               -- موجب للوارد، سالب للمنصرف
  unit_cost_usd numeric(14,4),
  ref_type      text,
  ref_id        uuid,
  note          text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

-- ---------------------------------------------------------------------
-- العملاء والموردون
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  address    text,
  notes      text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  phone           text,
  country         text,
  address         text,
  opening_balance numeric(16,2) not null default 0,
  notes           text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- المشتريات
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null,
  supplier_id   uuid references public.suppliers(id),
  purchase_date date not null default public.local_today(),
  rate          numeric(14,4) not null,              -- ريت يوم الشراء
  goods_usd     numeric(16,4) not null default 0,
  shipping_sdg  numeric(16,2) not null default 0,
  customs_sdg   numeric(16,2) not null default 0,
  other_sdg     numeric(16,2) not null default 0,
  total_sdg     numeric(16,2) not null default 0,    -- البضاعة + كل المصاريف بالجنيه
  paid_sdg      numeric(16,2) not null default 0,
  status        text not null default 'posted' check (status in ('posted','cancelled')),
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id             uuid primary key default gen_random_uuid(),
  purchase_id    uuid not null references public.purchases(id) on delete cascade,
  product_id     uuid not null references public.products(id),
  qty            numeric(14,3) not null check (qty > 0),
  unit_price_usd numeric(14,4) not null,
  landed_usd     numeric(14,4) not null              -- تكلفة الوحدة بعد توزيع المصاريف
);

-- ---------------------------------------------------------------------
-- الفواتير (مبدئية ونهائية)
-- ---------------------------------------------------------------------
create table if not exists public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  number               text unique not null,
  kind                 text not null check (kind in ('proforma','final')),
  status               text not null check (status in ('open','converted','posted','cancelled')),
  customer_id          uuid references public.customers(id),
  customer_name        text,
  customer_phone       text,
  invoice_date         date not null default public.local_today(),
  rate                 numeric(14,4) not null,
  subtotal_sdg         numeric(16,2) not null default 0,
  discount_sdg         numeric(16,2) not null default 0,
  total_sdg            numeric(16,2) not null default 0,
  cost_sdg             numeric(16,2) not null default 0,  -- تكلفة البضاعة المباعة
  paid_sdg             numeric(16,2) not null default 0,
  payment_type         text not null default 'cash' check (payment_type in ('cash','credit','partial')),
  source_proforma_id   uuid references public.invoices(id),
  converted_invoice_id uuid references public.invoices(id),
  cancel_reason        text,
  notes                text,
  salesperson_id       uuid references public.profiles(id),   -- صاحب البيعة (للعمولة)
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now(),
  posted_at            timestamptz,
  cancelled_at         timestamptz
);
create index if not exists invoices_date_idx on public.invoices(invoice_date desc);

create table if not exists public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  product_id      uuid not null references public.products(id),
  code            text not null,
  name            text not null,
  model           text,
  qty             numeric(14,3) not null check (qty > 0),
  unit_price_usd  numeric(14,4) not null,
  unit_price_sdg  numeric(16,2) not null,
  total_sdg       numeric(16,2) not null,
  unit_cost_usd   numeric(14,4) not null default 0,
  delivered_qty   numeric(14,3) not null default 0,
  sort            int not null default 0
);

-- ---------------------------------------------------------------------
-- أذونات التسليم (من الحسابات للمخزن)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_permits (
  id            uuid primary key default gen_random_uuid(),
  number        text unique not null,
  invoice_id    uuid not null references public.invoices(id),
  status        text not null default 'pending' check (status in ('pending','delivered','cancelled')),
  receiver_name text,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  delivered_by  uuid references public.profiles(id),
  delivered_at  timestamptz
);

create table if not exists public.delivery_items (
  id              uuid primary key default gen_random_uuid(),
  permit_id       uuid not null references public.delivery_permits(id) on delete cascade,
  invoice_item_id uuid not null references public.invoice_items(id),
  product_id      uuid not null references public.products(id),
  qty             numeric(14,3) not null check (qty > 0)
);

-- ---------------------------------------------------------------------
-- الحسابات: المقبوضات والمدفوعات والمصروفات
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  direction    text not null check (direction in ('in','out')),
  party_type   text not null check (party_type in ('customer','supplier','other')),
  customer_id  uuid references public.customers(id),
  supplier_id  uuid references public.suppliers(id),
  invoice_id   uuid references public.invoices(id),
  purchase_id  uuid references public.purchases(id),
  amount_sdg   numeric(16,2) not null,
  method       text not null default 'cash' check (method in ('cash','bank','transfer','cheque')),
  pay_date     date not null default public.local_today(),
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.expense_categories (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  kind   text not null default 'operating' check (kind in ('operating','social','cost')),
  sort   int not null default 0
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.expense_categories(id),
  amount_sdg   numeric(16,2) not null check (amount_sdg > 0),
  expense_date date not null default public.local_today(),
  description  text,
  ref_type     text,
  ref_id       uuid,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- الموظفون والحضور والمرتبات
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique references public.profiles(id) on delete set null,
  full_name        text not null,
  phone            text,
  job_title        text,
  base_salary      numeric(16,2) not null default 0,
  commission_pct   numeric(7,3)  not null default 0,
  commission_basis text not null default 'own' check (commission_basis in ('own','total')),
  hired_at         date default public.local_today(),
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  work_date     date not null default public.local_today(),
  check_in      timestamptz,
  check_out     timestamptz,
  late_minutes  int not null default 0,
  status        text not null default 'present' check (status in ('present','absent','leave')),
  edited_by     uuid references public.profiles(id),
  note          text,
  unique (employee_id, work_date)
);

create table if not exists public.salary_advances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  amount_sdg   numeric(16,2) not null check (amount_sdg > 0),
  advance_date date not null default public.local_today(),
  payroll_id   uuid,
  notes        text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.salary_deductions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id) on delete cascade,
  amount_sdg     numeric(16,2) not null check (amount_sdg > 0),
  deduction_date date not null default public.local_today(),
  reason         text,
  payroll_id     uuid,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create table if not exists public.payrolls (
  id              uuid primary key default gen_random_uuid(),
  period          text not null,                -- YYYY-MM
  employee_id     uuid not null references public.employees(id) on delete cascade,
  base_salary     numeric(16,2) not null default 0,
  sales_base      numeric(16,2) not null default 0,
  commission      numeric(16,2) not null default 0,
  deductions      numeric(16,2) not null default 0,
  advances        numeric(16,2) not null default 0,
  late_minutes    int not null default 0,
  late_deduction  numeric(16,2) not null default 0,
  absent_days     int not null default 0,
  net             numeric(16,2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','paid')),
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (period, employee_id)
);

-- ---------------------------------------------------------------------
-- المساهمون
-- ---------------------------------------------------------------------
create table if not exists public.shareholders (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  phone      text,
  joined_at  date not null default public.local_today(),
  left_at    date,
  is_active  boolean not null default true,
  notes      text,
  created_at timestamptz not null default now()
);

-- كل تعديل في النسب يتسجّل كصف جديد بتاريخ سريانه، فالحسابات القديمة متتغيرش
create table if not exists public.shareholder_terms (
  id              uuid primary key default gen_random_uuid(),
  shareholder_id  uuid not null references public.shareholders(id) on delete cascade,
  effective_from  date not null,
  monthly_salary  numeric(16,2) not null default 0,
  sales_pct       numeric(7,3)  not null default 0,
  profit_pct      numeric(7,3)  not null default 0,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists public.shareholder_payouts (
  id              uuid primary key default gen_random_uuid(),
  shareholder_id  uuid not null references public.shareholders(id) on delete cascade,
  period          text not null,              -- YYYY-MM
  salary          numeric(16,2) not null default 0,
  sales_base      numeric(16,2) not null default 0,
  sales_pct       numeric(7,3)  not null default 0,
  sales_share     numeric(16,2) not null default 0,
  total           numeric(16,2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','paid')),
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (period, shareholder_id)
);

-- ---------------------------------------------------------------------
-- الإشعارات وسجل التدقيق
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  level       text not null default 'info' check (level in ('info','success','warning','danger')),
  title       text not null,
  body        text,
  entity_type text,
  entity_id   uuid,
  actor_id    uuid references public.profiles(id),
  actor_name  text,
  data        jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid,
  user_name   text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- بيانات أولية
-- ---------------------------------------------------------------------
insert into public.expense_categories (name, kind, sort) values
  ('شحن', 'cost', 1), ('جمارك', 'cost', 2), ('نقل وتركيب', 'operating', 3),
  ('إيجارات', 'operating', 4), ('رواتب', 'operating', 5), ('كهرباء ومياه', 'operating', 6),
  ('صيانة', 'operating', 7), ('دعاية وإعلان', 'operating', 8),
  ('مساهمات في الأعمال الاجتماعية', 'social', 9), ('مصروفات أخرى', 'operating', 10)
on conflict (name) do nothing;

insert into public.categories (name, sort) values
  ('مكاتب رئاسية',1),('جلوس رئاسي',2),('مكاتب مدراء إدارات',3),('جلوس مكاتب مدراء إدارات',4),
  ('مكاتب موظفين',5),('مكاتب سكرتارية',6),('ويرك ستيشن',7),('كاونترات استقبال',8),
  ('ترابيز اجتماعات',9),('خزن',10),('فايل كابينت مصفح',11),('فايل كابينت حديد',12),
  ('دواليب حديد',13),('لوكرات حديد',14),('كنب بنوك وانتظار',15),('كنب مكاتب واستقبال',16),
  ('كراسي جلد فاخرة',17),('كراسي طبية',18),('كراسي معامل',19),('كراسي قاعات ومسارح',20),
  ('كراسي VIP',21),('منصات ندوات',22),('مستلزمات البنوك',23),('أنظمة صوتيات',24)
on conflict (name) do nothing;
