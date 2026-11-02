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


-- =====================================================================
--  WALI CORE — 0002: الصلاحيات والعمليات والإشعارات
-- =====================================================================

-- ---------------------------------------------------------------------
-- أدوات مساعدة
-- ---------------------------------------------------------------------
create or replace function public.fmt(n numeric) returns text
language sql immutable as $$ select to_char(round(coalesce(n,0)), 'FM999G999G999G990') $$;

-- نسبة من غير أصفار زيادة: 0.500 ← 0.5
create or replace function public.pct(t text) returns text
language sql immutable as $$ select coalesce(t::numeric::float8::text, '0') $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active and role = 'admin')
$$;

-- الصلاحيات: permissions = {"sales": ["view","create",...], ...}
-- الأفعال: view, create, edit, approve, print, cancel
create or replace function public.has_perm(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active
      and (role = 'admin' or coalesce(permissions -> p_module, '[]'::jsonb) ? p_action)
  )
$$;

create or replace function public.ensure_perm(p_module text, p_action text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_module, p_action) then
    raise exception 'ليس لديك صلاحية لهذه العملية (% / %)', p_module, p_action using errcode = '42501';
  end if;
end $$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active)
$$;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), username) from profiles where id = auth.uid()
$$;

create or replace function public.month_start(p_period text) returns date
language sql immutable as $$ select (p_period || '-01')::date $$;

-- ---------------------------------------------------------------------
-- سعر الصرف
-- ---------------------------------------------------------------------
create or replace function public.current_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select rate from exchange_rates where rate_date = public.local_today()
  order by created_at desc limit 1
$$;

create or replace function public.latest_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select rate from exchange_rates order by rate_date desc, created_at desc limit 1
$$;

create or replace function public.set_exchange_rate(p_rate numeric, p_note text default null)
returns public.exchange_rates
language plpgsql security definer set search_path = public as $$
declare r exchange_rates;
begin
  perform ensure_perm('rates', 'create');
  if p_rate is null or p_rate <= 0 then raise exception 'سعر الدولار لازم يكون رقم أكبر من صفر'; end if;
  insert into exchange_rates (rate, rate_date, note, created_by)
  values (p_rate, local_today(), p_note, auth.uid()) returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- الترقيم
-- ---------------------------------------------------------------------
create or replace function public.next_doc_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from local_today())::int;
  n int;
  prefix text;
begin
  insert into doc_counters (kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = doc_counters.last + 1
  returning last into n;
  prefix := case p_kind
    when 'proforma' then 'PF' when 'final' then 'INV'
    when 'purchase' then 'PO' when 'delivery' then 'DL' else upper(p_kind) end;
  return prefix || '-' || lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 5, '0');
end $$;

-- ---------------------------------------------------------------------
-- المستخدمين: أول مستخدم يتسجل بيبقى Admin
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_user_meta_data ->> 'role', 'custom');
begin
  if not exists (select 1 from profiles where role = 'admin') then v_role := 'admin'; end if;
  insert into profiles (id, username, full_name, role, permissions)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    coalesce(new.raw_user_meta_data -> 'permissions', '{}'::jsonb)
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- المستخدم العادي ميقدرش يغيّر دوره أو صلاحياته بنفسه
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('users', 'edit') then
    new.role := old.role;
    new.permissions := old.permissions;
    new.is_active := old.is_active;
    new.username := old.username;
  end if;
  -- آخر Admin ميتشالش
  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active)
     and (select count(*) from profiles where role = 'admin' and is_active and id <> old.id) = 0 then
    raise exception 'لازم يفضل Admin واحد على الأقل';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------
-- الأصناف والمخزن
-- ---------------------------------------------------------------------
create or replace function public.products_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.qty_on_hand := 0;                         -- الرصيد الافتتاحي بيدخل كحركة مخزن
  elsif new.qty_on_hand is distinct from old.qty_on_hand
        and coalesce(current_setting('wali.stock_move', true), '') <> '1' then
    new.qty_on_hand := old.qty_on_hand;           -- الكمية بتتغير من حركات المخزن بس
  end if;
  if new.auto_price then
    new.price_usd := round(new.cost_usd * (1 + new.margin_pct / 100.0), 2);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists products_before on public.products;
create trigger products_before before insert or update on public.products
  for each row execute function public.products_before();

create or replace function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('wali.stock_move', '1', true);
  update products set qty_on_hand = qty_on_hand + new.qty where id = new.product_id;
  perform set_config('wali.stock_move', '', true);
  return new;
end $$;
drop trigger if exists apply_stock_movement on public.stock_movements;
create trigger apply_stock_movement after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create or replace function public.adjust_stock(p_product uuid, p_new_qty numeric, p_note text default null, p_opening boolean default false)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_cur numeric; v_diff numeric; v_cost numeric;
begin
  perform ensure_perm('stock', 'edit');
  if p_new_qty is null or p_new_qty < 0 then raise exception 'الكمية لازم تكون صفر أو أكتر'; end if;
  select qty_on_hand, cost_usd into v_cur, v_cost from products where id = p_product for update;
  if not found then raise exception 'الصنف مش موجود'; end if;
  v_diff := p_new_qty - v_cur;
  if v_diff = 0 then return v_cur; end if;
  insert into stock_movements (product_id, kind, qty, unit_cost_usd, note, created_by)
  values (p_product,
          case when p_opening then 'opening' when v_diff > 0 then 'adjust_in' else 'adjust_out' end,
          v_diff, v_cost, coalesce(p_note, 'تسوية جرد'), auth.uid());
  return p_new_qty;
end $$;

-- ---------------------------------------------------------------------
-- الفواتير
-- ---------------------------------------------------------------------
-- p = {id?, kind, customer_id?, customer_name?, customer_phone?, discount_sdg, paid_sdg,
--      method?, notes?, items:[{product_id, qty, unit_price_usd?, unit_price_sdg?}]}
create or replace function public._write_invoice(p jsonb, p_allow_price boolean, p_source uuid default null)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  v_kind     text := coalesce(p ->> 'kind', 'proforma');
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_rate     numeric := current_rate();
  v_items    jsonb := p -> 'items';
  v_disc     numeric := coalesce(nullif(p ->> 'discount_sdg', '')::numeric, 0);
  v_paid     numeric := coalesce(nullif(p ->> 'paid_sdg', '')::numeric, 0);
  v_cust     uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_cname    text := nullif(trim(p ->> 'customer_name'), '');
  v_cphone   text := nullif(trim(p ->> 'customer_phone'), '');
  v_sub      numeric := 0;
  v_cost     numeric := 0;
  v_total    numeric;
  v_inv      invoices;
  it         jsonb;
  pr         products;
  r          record;
  v_usd      numeric;
  v_sdg      numeric;
  v_qty      numeric;
  i          int := 0;
  v_ptype    text;
begin
  if v_rate is null then
    raise exception 'لازم تكتب سعر الدولار بتاع النهارده الأول';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'الفاتورة فاضية، ضيف أصناف الأول';
  end if;

  -- اقفل الأصناف عشان محدش يبيع نفس القطعة في نفس اللحظة
  perform 1 from products
   where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(v_items) e)
   for update;

  if v_kind = 'final' then
    for r in
      select p.id, p.name, p.qty_on_hand, sum((e ->> 'qty')::numeric) as need
        from jsonb_array_elements(v_items) e
        join products p on p.id = (e ->> 'product_id')::uuid
       group by p.id, p.name, p.qty_on_hand
    loop
      if r.need > r.qty_on_hand then
        raise exception 'الكمية المتاحة من "%" هي % بس', r.name, r.qty_on_hand::numeric(14,0);
      end if;
    end loop;
  end if;

  -- احسب الإجماليات
  for it in select * from jsonb_array_elements(v_items) loop
    select * into pr from products where id = (it ->> 'product_id')::uuid;
    if not found then raise exception 'صنف غير موجود في المخزن'; end if;
    v_qty := nullif(it ->> 'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'كمية غير صحيحة للصنف "%"', pr.name; end if;
    v_usd := case when p_allow_price and nullif(it ->> 'unit_price_usd', '') is not null
                  then (it ->> 'unit_price_usd')::numeric else pr.price_usd end;
    v_sdg := case when p_allow_price and nullif(it ->> 'unit_price_sdg', '') is not null
                  then (it ->> 'unit_price_sdg')::numeric else round(v_usd * v_rate, 2) end;
    v_sub := v_sub + round(v_sdg * v_qty, 2);
    v_cost := v_cost + round(pr.cost_usd * v_rate * v_qty, 2);
  end loop;

  v_total := v_sub - v_disc;
  if v_disc < 0 or v_total < 0 then raise exception 'الخصم أكبر من قيمة الفاتورة'; end if;

  if v_kind = 'final' then
    if v_paid > v_total then v_paid := v_total; end if;
    v_ptype := case when v_paid >= v_total then 'cash' when v_paid = 0 then 'credit' else 'partial' end;
  else
    v_paid := 0; v_ptype := coalesce(p ->> 'payment_type', 'cash');
  end if;

  -- عميل جديد يتسجل لوحده لو كتبت اسمه
  if v_cust is null and v_cname is not null then
    select id into v_cust from customers
     where name = v_cname and coalesce(phone, '') = coalesce(v_cphone, '') limit 1;
    if v_cust is null then
      insert into customers (name, phone, created_by) values (v_cname, v_cphone, auth.uid())
      returning id into v_cust;
    end if;
  end if;
  if v_cust is not null and v_cname is null then
    select name, phone into v_cname, v_cphone from customers where id = v_cust;
  end if;
  if v_kind = 'final' and v_ptype <> 'cash' and v_cust is null then
    raise exception 'البيع الآجل محتاج اسم العميل';
  end if;

  if v_id is not null then
    -- تعديل فاتورة مبدئية مفتوحة
    select * into v_inv from invoices where id = v_id for update;
    if not found or v_inv.kind <> 'proforma' or v_inv.status <> 'open' then
      raise exception 'الفاتورة دي مينفعش تتعدل';
    end if;
    delete from invoice_items where invoice_id = v_id;
    update invoices set customer_id = v_cust, customer_name = v_cname, customer_phone = v_cphone,
           rate = v_rate, subtotal_sdg = v_sub, discount_sdg = v_disc, total_sdg = v_total,
           cost_sdg = v_cost, payment_type = v_ptype, notes = p ->> 'notes', invoice_date = local_today()
     where id = v_id returning * into v_inv;
  else
    insert into invoices (number, kind, status, customer_id, customer_name, customer_phone, rate,
                          subtotal_sdg, discount_sdg, total_sdg, cost_sdg, payment_type, notes,
                          source_proforma_id, salesperson_id, created_by, posted_at)
    values (next_doc_number(v_kind), v_kind, case when v_kind = 'final' then 'posted' else 'open' end,
            v_cust, v_cname, v_cphone, v_rate, v_sub, v_disc, v_total, v_cost, v_ptype, p ->> 'notes',
            p_source,
            coalesce((select salesperson_id from invoices where id = p_source), auth.uid()),
            auth.uid(), case when v_kind = 'final' then now() end)
    returning * into v_inv;
  end if;

  for it in select * from jsonb_array_elements(v_items) loop
    i := i + 1;
    select * into pr from products where id = (it ->> 'product_id')::uuid;
    v_qty := (it ->> 'qty')::numeric;
    v_usd := case when p_allow_price and nullif(it ->> 'unit_price_usd', '') is not null
                  then (it ->> 'unit_price_usd')::numeric else pr.price_usd end;
    v_sdg := case when p_allow_price and nullif(it ->> 'unit_price_sdg', '') is not null
                  then (it ->> 'unit_price_sdg')::numeric else round(v_usd * v_rate, 2) end;
    insert into invoice_items (invoice_id, product_id, code, name, model, qty, unit_price_usd,
                               unit_price_sdg, total_sdg, unit_cost_usd, sort)
    values (v_inv.id, pr.id, pr.code, pr.name, pr.model, v_qty, v_usd, v_sdg,
            round(v_sdg * v_qty, 2), pr.cost_usd, i);
    if v_kind = 'final' then
      insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, created_by)
      values (pr.id, 'sale_out', -v_qty, pr.cost_usd, 'invoice', v_inv.id, auth.uid());
    end if;
  end loop;

  if v_kind = 'final' and v_paid > 0 then
    insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, method, notes, created_by)
    values ('in', 'customer', v_cust, v_inv.id, v_paid, coalesce(p ->> 'method', 'cash'),
            'دفعة من فاتورة ' || v_inv.number, auth.uid());
  end if;

  select * into v_inv from invoices where id = v_inv.id;
  return v_inv;
end $$;

create or replace function public.save_invoice(p jsonb) returns public.invoices
language plpgsql security definer set search_path = public as $$
begin
  if nullif(p ->> 'id', '') is not null then
    perform ensure_perm('sales', 'edit');
  else
    perform ensure_perm('sales', 'create');
  end if;
  return _write_invoice(p, has_perm('sales', 'approve'));
end $$;

-- تحويل المبدئية لنهائية: السعر بالدولار ثابت، والجنيه بريت النهارده
-- (أو بنفس أسعار المبدئية لو p_keep_sdg = true وعندك صلاحية الاعتماد)
create or replace function public.convert_proforma(p_id uuid, p_paid numeric default 0,
                                                   p_method text default 'cash', p_keep_sdg boolean default false)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v_pf invoices; v_items jsonb; v_final invoices;
begin
  perform ensure_perm('sales', 'create');
  select * into v_pf from invoices where id = p_id for update;
  if not found or v_pf.kind <> 'proforma' then raise exception 'الفاتورة المبدئية مش موجودة'; end if;
  if v_pf.status <> 'open' then raise exception 'الفاتورة دي اتحولت أو اتلغت قبل كده'; end if;
  if p_keep_sdg and not has_perm('sales', 'approve') then
    raise exception 'تثبيت أسعار المبدئية محتاج صلاحية اعتماد';
  end if;

  select jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'qty', qty, 'unit_price_usd', unit_price_usd,
           'unit_price_sdg', case when p_keep_sdg then unit_price_sdg end) order by sort)
    into v_items from invoice_items where invoice_id = p_id;

  v_final := _write_invoice(jsonb_build_object(
      'kind', 'final', 'customer_id', v_pf.customer_id, 'customer_name', v_pf.customer_name,
      'customer_phone', v_pf.customer_phone, 'discount_sdg', v_pf.discount_sdg,
      'paid_sdg', coalesce(p_paid, 0), 'method', p_method, 'notes', v_pf.notes, 'items', v_items),
    true, p_id);

  update invoices set status = 'converted', converted_invoice_id = v_final.id where id = p_id;
  return v_final;
end $$;

create or replace function public.cancel_invoice(p_id uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v_inv invoices; it record;
begin
  perform ensure_perm('sales', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;
  select * into v_inv from invoices where id = p_id for update;
  if not found then raise exception 'الفاتورة مش موجودة'; end if;
  if v_inv.status in ('cancelled', 'converted') then raise exception 'الفاتورة دي مينفعش تتلغي'; end if;

  if v_inv.kind = 'final' then
    for it in select * from invoice_items where invoice_id = p_id loop
      insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
      values (it.product_id, 'cancel_in', it.qty, it.unit_cost_usd, 'invoice', p_id, 'إلغاء ' || v_inv.number, auth.uid());
    end loop;
    update delivery_permits set status = 'cancelled' where invoice_id = p_id and status = 'pending';
    if v_inv.paid_sdg > 0 then
      insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, notes, created_by)
      values ('out', 'customer', v_inv.customer_id, p_id, v_inv.paid_sdg, 'رد مبلغ إلغاء ' || v_inv.number, auth.uid());
    end if;
  end if;

  update invoices set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
   where id = p_id returning * into v_inv;
  return v_inv;
end $$;

-- ---------------------------------------------------------------------
-- المشتريات: توزيع الشحن والجمارك والرسوم على الأصناف حسب القيمة
-- p = {supplier_id, purchase_date?, rate?, shipping_sdg, customs_sdg, other_sdg, paid_sdg, notes,
--      items:[{product_id, qty, unit_price_usd}]}
-- ---------------------------------------------------------------------
create or replace function public.save_purchase(p jsonb) returns public.purchases
language plpgsql security definer set search_path = public as $$
declare
  v_rate   numeric := coalesce(nullif(p ->> 'rate', '')::numeric, current_rate());
  v_ship   numeric := coalesce(nullif(p ->> 'shipping_sdg', '')::numeric, 0);
  v_cust   numeric := coalesce(nullif(p ->> 'customs_sdg', '')::numeric, 0);
  v_other  numeric := coalesce(nullif(p ->> 'other_sdg', '')::numeric, 0);
  v_paid   numeric := coalesce(nullif(p ->> 'paid_sdg', '')::numeric, 0);
  v_goods  numeric := 0;
  v_factor numeric;
  v_pur    purchases;
  it       jsonb;
  pr       products;
  v_qty    numeric;
  v_price  numeric;
  v_landed numeric;
  v_oldq   numeric;
begin
  perform ensure_perm('purchases', 'create');
  if v_rate is null or v_rate <= 0 then raise exception 'لازم تكتب سعر الدولار الأول'; end if;
  if p -> 'items' is null or jsonb_array_length(p -> 'items') = 0 then raise exception 'الفاتورة فاضية'; end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := nullif(it ->> 'qty', '')::numeric;
    v_price := nullif(it ->> 'unit_price_usd', '')::numeric;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then
      raise exception 'راجع الكميات والأسعار';
    end if;
    v_goods := v_goods + v_qty * v_price;
  end loop;

  -- نسبة المصاريف الإضافية لقيمة البضاعة
  v_factor := case when v_goods > 0 then ((v_ship + v_cust + v_other) / v_rate) / v_goods else 0 end;

  insert into purchases (number, supplier_id, purchase_date, rate, goods_usd, shipping_sdg, customs_sdg,
                         other_sdg, total_sdg, notes, created_by)
  values (next_doc_number('purchase'), nullif(p ->> 'supplier_id', '')::uuid,
          coalesce(nullif(p ->> 'purchase_date', '')::date, local_today()), v_rate, v_goods,
          v_ship, v_cust, v_other, round(v_goods * v_rate + v_ship + v_cust + v_other, 2),
          p ->> 'notes', auth.uid())
  returning * into v_pur;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into pr from products where id = (it ->> 'product_id')::uuid for update;
    if not found then raise exception 'صنف غير موجود'; end if;
    v_qty := (it ->> 'qty')::numeric;
    v_price := (it ->> 'unit_price_usd')::numeric;
    v_landed := round(v_price * (1 + v_factor), 4);
    insert into purchase_items (purchase_id, product_id, qty, unit_price_usd, landed_usd)
    values (v_pur.id, pr.id, v_qty, v_price, v_landed);

    -- متوسط التكلفة المرجّح
    v_oldq := greatest(pr.qty_on_hand, 0);
    update products
       set cost_usd = round((v_oldq * cost_usd + v_qty * v_landed) / nullif(v_oldq + v_qty, 0), 4)
     where id = pr.id;

    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, created_by)
    values (pr.id, 'purchase_in', v_qty, v_landed, 'purchase', v_pur.id, auth.uid());
  end loop;

  if v_paid > 0 then
    insert into payments (direction, party_type, supplier_id, purchase_id, amount_sdg, method, notes, created_by)
    values ('out', 'supplier', v_pur.supplier_id, v_pur.id, least(v_paid, v_pur.total_sdg),
            coalesce(p ->> 'method', 'cash'), 'دفعة من مشتريات ' || v_pur.number, auth.uid());
  end if;

  select * into v_pur from purchases where id = v_pur.id;
  return v_pur;
end $$;

-- ---------------------------------------------------------------------
-- المدفوعات (بتحدّث المدفوع في الفاتورة لوحدها)
-- ---------------------------------------------------------------------
create or replace function public.sync_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_pur uuid; v_paid numeric; v_total numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  v_pur := coalesce(new.purchase_id, old.purchase_id);
  if v_inv is not null then
    select coalesce(sum(case when direction = 'in' then amount_sdg else -amount_sdg end), 0)
      into v_paid from payments where invoice_id = v_inv;
    select total_sdg into v_total from invoices where id = v_inv;
    update invoices set paid_sdg = v_paid,
           payment_type = case when kind = 'proforma' or status = 'cancelled' then payment_type
                                when v_paid >= v_total then 'cash' when v_paid <= 0 then 'credit' else 'partial' end
     where id = v_inv;
  end if;
  if v_pur is not null then
    select coalesce(sum(case when direction = 'out' then amount_sdg else -amount_sdg end), 0)
      into v_paid from payments where purchase_id = v_pur;
    update purchases set paid_sdg = v_paid where id = v_pur;
  end if;
  return null;
end $$;
drop trigger if exists sync_paid on public.payments;
create trigger sync_paid after insert or update or delete on public.payments
  for each row execute function public.sync_paid();

create or replace function public.record_payment(p jsonb) returns public.payments
language plpgsql security definer set search_path = public as $$
declare v payments; v_amt numeric := nullif(p ->> 'amount_sdg', '')::numeric;
        v_inv invoices; v_pur purchases;
begin
  perform ensure_perm('accounting', 'create');
  if v_amt is null or v_amt <= 0 then raise exception 'المبلغ لازم يكون أكبر من صفر'; end if;
  if nullif(p ->> 'invoice_id', '') is not null then
    select * into v_inv from invoices where id = (p ->> 'invoice_id')::uuid;
    if v_inv.status <> 'posted' then raise exception 'الفاتورة مش نهائية'; end if;
    if v_amt > v_inv.total_sdg - v_inv.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي على الفاتورة (%)', fmt(v_inv.total_sdg - v_inv.paid_sdg);
    end if;
  end if;
  if nullif(p ->> 'purchase_id', '') is not null then
    select * into v_pur from purchases where id = (p ->> 'purchase_id')::uuid;
    if v_amt > v_pur.total_sdg - v_pur.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي للمورد (%)', fmt(v_pur.total_sdg - v_pur.paid_sdg);
    end if;
  end if;
  insert into payments (direction, party_type, customer_id, supplier_id, invoice_id, purchase_id,
                        amount_sdg, method, pay_date, notes, created_by)
  values (p ->> 'direction', p ->> 'party_type',
          coalesce(nullif(p ->> 'customer_id', '')::uuid, v_inv.customer_id),
          coalesce(nullif(p ->> 'supplier_id', '')::uuid, v_pur.supplier_id),
          v_inv.id, v_pur.id, v_amt, coalesce(nullif(p ->> 'method', ''), 'cash'),
          coalesce(nullif(p ->> 'pay_date', '')::date, local_today()), p ->> 'notes', auth.uid())
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- أذونات التسليم: الحسابات تطلّع الإذن، والمخزن يأكد التسليم
-- ---------------------------------------------------------------------
create or replace function public.create_delivery_permit(p_invoice uuid, p_receiver text default null,
                                                         p_notes text default null, p_items jsonb default null)
returns public.delivery_permits
language plpgsql security definer set search_path = public as $$
declare v_inv invoices; v_dp delivery_permits; it record; v_qty numeric; v_any boolean := false;
begin
  perform ensure_perm('delivery', 'create');
  select * into v_inv from invoices where id = p_invoice;
  if not found or v_inv.kind <> 'final' or v_inv.status <> 'posted' then
    raise exception 'إذن التسليم بيطلع لفاتورة نهائية بس';
  end if;

  insert into delivery_permits (number, invoice_id, receiver_name, notes, created_by)
  values (next_doc_number('delivery'), p_invoice, coalesce(p_receiver, v_inv.customer_name), p_notes, auth.uid())
  returning * into v_dp;

  for it in
    select ii.*, ii.qty - ii.delivered_qty - coalesce((
             select sum(di.qty) from delivery_items di join delivery_permits dp on dp.id = di.permit_id
              where di.invoice_item_id = ii.id and dp.status = 'pending' and dp.id <> v_dp.id), 0) as remaining
      from invoice_items ii where ii.invoice_id = p_invoice order by ii.sort
  loop
    v_qty := case when p_items is null then it.remaining
                  else least(it.remaining, coalesce((
                    select (e ->> 'qty')::numeric from jsonb_array_elements(p_items) e
                     where (e ->> 'invoice_item_id')::uuid = it.id limit 1), 0)) end;
    if v_qty > 0 then
      insert into delivery_items (permit_id, invoice_item_id, product_id, qty)
      values (v_dp.id, it.id, it.product_id, v_qty);
      v_any := true;
    end if;
  end loop;

  if not v_any then raise exception 'كل أصناف الفاتورة دي اتسلمت أو عليها إذن تسليم'; end if;
  return v_dp;
end $$;

create or replace function public.confirm_delivery(p_permit uuid) returns public.delivery_permits
language plpgsql security definer set search_path = public as $$
declare v_dp delivery_permits; it record;
begin
  perform ensure_perm('delivery', 'approve');
  select * into v_dp from delivery_permits where id = p_permit for update;
  if not found or v_dp.status <> 'pending' then raise exception 'الإذن ده مش منتظر تسليم'; end if;
  for it in select * from delivery_items where permit_id = p_permit loop
    update invoice_items set delivered_qty = delivered_qty + it.qty where id = it.invoice_item_id;
  end loop;
  update delivery_permits set status = 'delivered', delivered_by = auth.uid(), delivered_at = now()
   where id = p_permit returning * into v_dp;
  return v_dp;
end $$;

create or replace function public.cancel_delivery(p_permit uuid) returns public.delivery_permits
language plpgsql security definer set search_path = public as $$
declare v_dp delivery_permits;
begin
  perform ensure_perm('delivery', 'cancel');
  update delivery_permits set status = 'cancelled' where id = p_permit and status = 'pending'
  returning * into v_dp;
  if v_dp.id is null then raise exception 'الإذن ده مينفعش يتلغي'; end if;
  return v_dp;
end $$;

-- ---------------------------------------------------------------------
-- الحضور والانصراف (الوقت من السيرفر مش من الجهاز)
-- ---------------------------------------------------------------------
create or replace function public.my_employee() returns public.employees
language sql stable security definer set search_path = public as $$
  select * from employees where user_id = auth.uid() and is_active limit 1
$$;

create or replace function public.check_in() returns public.attendance
language plpgsql security definer set search_path = public as $$
declare v_emp employees; v_set settings; v_late int; v_now time; a attendance;
begin
  select * into v_emp from employees where user_id = auth.uid() and is_active;
  if not found then raise exception 'حسابك مش مربوط بموظف، كلّم الأدمن'; end if;
  select * into v_set from settings where id = 1;
  v_now := (now() at time zone 'Africa/Khartoum')::time;
  v_late := greatest(0, (extract(epoch from (v_now - v_set.work_start)) / 60)::int);
  if v_late <= v_set.late_grace_minutes then v_late := 0; end if;
  insert into attendance (employee_id, work_date, check_in, late_minutes)
  values (v_emp.id, local_today(), now(), v_late)
  on conflict (employee_id, work_date) do nothing
  returning * into a;
  if a.id is null then raise exception 'إنت سجلت حضور النهارده قبل كده'; end if;
  return a;
end $$;

create or replace function public.check_out() returns public.attendance
language plpgsql security definer set search_path = public as $$
declare a attendance;
begin
  update attendance set check_out = now()
   where employee_id = (select id from employees where user_id = auth.uid())
     and work_date = local_today() and check_in is not null and check_out is null
  returning * into a;
  if a.id is null then raise exception 'مفيش حضور مفتوح النهارده عشان تسجل انصراف'; end if;
  return a;
end $$;

-- تعديل الحضور من الأدمن (بيتسجل وبيوصل عليه إشعار)
create or replace function public.admin_set_attendance(p jsonb) returns public.attendance
language plpgsql security definer set search_path = public as $$
declare a attendance;
begin
  perform ensure_perm('attendance', 'edit');
  insert into attendance (employee_id, work_date, check_in, check_out, late_minutes, status, note, edited_by)
  values ((p ->> 'employee_id')::uuid, (p ->> 'work_date')::date,
          nullif(p ->> 'check_in', '')::timestamptz, nullif(p ->> 'check_out', '')::timestamptz,
          coalesce(nullif(p ->> 'late_minutes', '')::int, 0), coalesce(p ->> 'status', 'present'),
          p ->> 'note', auth.uid())
  on conflict (employee_id, work_date) do update
     set check_in = excluded.check_in, check_out = excluded.check_out,
         late_minutes = excluded.late_minutes, status = excluded.status,
         note = excluded.note, edited_by = excluded.edited_by
  returning * into a;
  return a;
end $$;

-- ---------------------------------------------------------------------
-- المرتبات: مرتب + نسبة مبيعات − خصومات − سلف − تأخير
-- ---------------------------------------------------------------------
create or replace function public.period_sales(p_from date, p_to date, p_user uuid default null)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(total_sdg), 0) from invoices
   where kind = 'final' and status = 'posted'
     and invoice_date >= p_from and invoice_date < p_to
     and (p_user is null or salesperson_id = p_user)
$$;

create or replace function public.generate_payroll(p_period text) returns int
language plpgsql security definer set search_path = public as $$
declare
  d1 date := month_start(p_period);
  d2 date := (month_start(p_period) + interval '1 month')::date;
  e employees; v_set settings;
  v_sales numeric; v_comm numeric; v_ded numeric; v_adv numeric; v_late int; v_abs int; n int := 0;
begin
  perform ensure_perm('payroll', 'create');
  select * into v_set from settings where id = 1;
  for e in select * from employees where is_active loop
    if exists (select 1 from payrolls where period = p_period and employee_id = e.id and status = 'paid') then
      continue;
    end if;
    v_sales := case when e.commission_basis = 'total' then period_sales(d1, d2)
                    when e.user_id is null then 0
                    else period_sales(d1, d2, e.user_id) end;
    v_comm := round(v_sales * e.commission_pct / 100.0, 2);
    select coalesce(sum(amount_sdg), 0) into v_ded from salary_deductions
     where employee_id = e.id and payroll_id is null and deduction_date < d2;
    select coalesce(sum(amount_sdg), 0) into v_adv from salary_advances
     where employee_id = e.id and payroll_id is null and advance_date < d2;
    select coalesce(sum(late_minutes), 0), count(*) filter (where status = 'absent')
      into v_late, v_abs from attendance
     where employee_id = e.id and work_date >= d1 and work_date < d2;

    insert into payrolls (period, employee_id, base_salary, sales_base, commission, deductions, advances,
                          late_minutes, late_deduction, absent_days, net)
    values (p_period, e.id, e.base_salary, v_sales, v_comm, v_ded, v_adv, v_late,
            round(v_late * v_set.late_deduction_per_min, 2), v_abs,
            e.base_salary + v_comm - v_ded - v_adv - round(v_late * v_set.late_deduction_per_min, 2))
    on conflict (period, employee_id) do update
       set base_salary = excluded.base_salary, sales_base = excluded.sales_base,
           commission = excluded.commission, deductions = excluded.deductions,
           advances = excluded.advances, late_minutes = excluded.late_minutes,
           late_deduction = excluded.late_deduction, absent_days = excluded.absent_days,
           net = excluded.net, created_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.pay_payroll(p_id uuid) returns public.payrolls
language plpgsql security definer set search_path = public as $$
declare v payrolls; d2 date; v_cat uuid; v_name text;
begin
  perform ensure_perm('payroll', 'approve');
  select * into v from payrolls where id = p_id for update;
  if not found or v.status <> 'draft' then raise exception 'المرتب ده اتصرف قبل كده'; end if;
  d2 := (month_start(v.period) + interval '1 month')::date;
  update salary_advances set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and advance_date < d2;
  update salary_deductions set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and deduction_date < d2;
  update payrolls set status = 'paid', paid_at = now() where id = p_id returning * into v;

  select id into v_cat from expense_categories where name = 'رواتب';
  select full_name into v_name from employees where id = v.employee_id;
  -- المصروف الحقيقي = المرتب + العمولة − الخصومات (السلفة اتصرفت قبل كده)
  if v.base_salary + v.commission - v.deductions - v.late_deduction > 0 then
    insert into expenses (category_id, amount_sdg, description, ref_type, ref_id, created_by)
    values (v_cat, v.base_salary + v.commission - v.deductions - v.late_deduction,
            'مرتب ' || v_name || ' — ' || v.period, 'payroll', v.id, auth.uid());
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- المساهمون
-- ---------------------------------------------------------------------
create or replace function public.shareholder_terms_at(p_sh uuid, p_date date)
returns public.shareholder_terms
language sql stable security definer set search_path = public as $$
  select * from shareholder_terms where shareholder_id = p_sh and effective_from <= p_date
  order by effective_from desc, created_at desc limit 1
$$;

create or replace function public.generate_shareholder_payouts(p_period text) returns int
language plpgsql security definer set search_path = public as $$
declare
  d1 date := month_start(p_period);
  d2 date := (month_start(p_period) + interval '1 month')::date;
  s shareholders; t shareholder_terms; v_sales numeric; n int := 0;
begin
  perform ensure_perm('shareholders', 'create');
  v_sales := period_sales(d1, d2);
  for s in select * from shareholders
            where joined_at < d2 and (left_at is null or left_at >= d1) loop
    if exists (select 1 from shareholder_payouts where period = p_period and shareholder_id = s.id and status = 'paid') then
      continue;
    end if;
    t := shareholder_terms_at(s.id, (d2 - 1));
    if t.id is null then continue; end if;
    insert into shareholder_payouts (shareholder_id, period, salary, sales_base, sales_pct, sales_share, total)
    values (s.id, p_period, t.monthly_salary, v_sales, t.sales_pct,
            round(v_sales * t.sales_pct / 100.0, 2),
            t.monthly_salary + round(v_sales * t.sales_pct / 100.0, 2))
    on conflict (period, shareholder_id) do update
       set salary = excluded.salary, sales_base = excluded.sales_base, sales_pct = excluded.sales_pct,
           sales_share = excluded.sales_share, total = excluded.total, created_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.pay_shareholder_payout(p_id uuid) returns public.shareholder_payouts
language plpgsql security definer set search_path = public as $$
declare v shareholder_payouts;
begin
  perform ensure_perm('shareholders', 'approve');
  update shareholder_payouts set status = 'paid', paid_at = now()
   where id = p_id and status = 'draft' returning * into v;
  if v.id is null then raise exception 'المبلغ ده اتصرف قبل كده'; end if;
  return v;
end $$;

-- تقرير الأرباح السنوية + نصيب كل مساهم
create or replace function public.annual_report(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d1 date := make_date(p_year, 1, 1);
  d2 date := make_date(p_year + 1, 1, 1);
  v_sales numeric; v_cogs numeric; v_disc numeric; v_exp numeric; v_net numeric; v_paid_sh numeric;
  v_months jsonb; v_cats jsonb; v_sh jsonb;
begin
  perform ensure_perm('reports', 'view');
  select coalesce(sum(total_sdg), 0), coalesce(sum(cost_sdg), 0), coalesce(sum(discount_sdg), 0)
    into v_sales, v_cogs, v_disc from invoices
   where kind = 'final' and status = 'posted' and invoice_date >= d1 and invoice_date < d2;
  select coalesce(sum(amount_sdg), 0) into v_exp from expenses where expense_date >= d1 and expense_date < d2;
  v_net := v_sales - v_cogs - v_exp;
  select coalesce(sum(total), 0) into v_paid_sh from shareholder_payouts
   where period >= to_char(d1, 'YYYY-MM') and period < to_char(d2, 'YYYY-MM') and status = 'paid';

  select jsonb_agg(m order by (m ->> 'month')) into v_months from (
    select jsonb_build_object(
      'month', to_char(gs, 'YYYY-MM'),
      'sales', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'final' and status = 'posted'
                 and invoice_date >= gs and invoice_date < gs + interval '1 month'),
      'cogs', (select coalesce(sum(cost_sdg), 0) from invoices where kind = 'final' and status = 'posted'
                 and invoice_date >= gs and invoice_date < gs + interval '1 month'),
      'expenses', (select coalesce(sum(amount_sdg), 0) from expenses
                 where expense_date >= gs and expense_date < gs + interval '1 month')) m
    from generate_series(d1, d2 - 1, interval '1 month') gs) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'total', t.total) order by t.total desc), '[]')
    into v_cats from (select category_id, sum(amount_sdg) total from expenses
                       where expense_date >= d1 and expense_date < d2 group by category_id) t
    join expense_categories c on c.id = t.category_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.full_name,
           'profit_pct', coalesce(t.profit_pct, 0),
           'profit_share', round(greatest(v_net, 0) * coalesce(t.profit_pct, 0) / 100.0, 2),
           'received', coalesce(pd.total, 0),
           'remaining', round(greatest(v_net, 0) * coalesce(t.profit_pct, 0) / 100.0, 2) - coalesce(pd.total, 0))
         order by s.full_name), '[]')
    into v_sh
    from shareholders s
    left join lateral (select * from shareholder_terms_at(s.id, least(d2 - 1, coalesce(s.left_at, d2 - 1)))) t on true
    left join lateral (select sum(total) total from shareholder_payouts
                        where shareholder_id = s.id and status = 'paid'
                          and period >= to_char(d1, 'YYYY-MM') and period < to_char(d2, 'YYYY-MM')) pd on true
   where s.joined_at < d2 and (s.left_at is null or s.left_at >= d1);

  return jsonb_build_object(
    'year', p_year, 'sales', v_sales, 'discounts', v_disc, 'cogs', v_cogs,
    'gross_profit', v_sales - v_cogs, 'expenses', v_exp, 'net_profit', v_net,
    'shareholder_paid', v_paid_sh, 'months', coalesce(v_months, '[]'), 'expense_categories', v_cats,
    'shareholders', v_sh);
end $$;

-- ---------------------------------------------------------------------
-- لوحة التحكم
-- ---------------------------------------------------------------------
create or replace function public.dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate numeric := coalesce(current_rate(), latest_rate(), 0);
  r jsonb;
  -- اللي معندوش صلاحية التقارير: مبيعاته هو بس
  v_me uuid := case when has_perm('reports', 'view') then null else auth.uid() end;
begin
  if not is_active_user() then raise exception 'غير مصرح'; end if;
  select jsonb_build_object(
    'rate_today', current_rate(),
    'rate_latest', latest_rate(),
    'sales', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)),
    'sales_count', (select count(*) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)),
    'cogs', (select coalesce(sum(cost_sdg), 0) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)),
    'purchases', (select coalesce(sum(total_sdg), 0) from purchases where status = 'posted' and purchase_date between p_from and p_to),
    'expenses', (select coalesce(sum(amount_sdg), 0) from expenses where expense_date between p_from and p_to),
    'collected', (select coalesce(sum(case when direction = 'in' then amount_sdg else -amount_sdg end), 0) from payments where party_type = 'customer' and pay_date between p_from and p_to),
    'receivables', (select coalesce(sum(total_sdg - paid_sdg), 0) from invoices where kind = 'final' and status = 'posted'),
    'payables', (select coalesce(sum(total_sdg - paid_sdg), 0) from purchases where status = 'posted'),
    'stock_value_sdg', (select coalesce(sum(qty_on_hand * cost_usd), 0) * v_rate from products where is_active),
    'stock_units', (select coalesce(sum(qty_on_hand), 0) from products where is_active),
    'products_count', (select count(*) from products where is_active),
    'low_stock', (select count(*) from products where is_active and qty_on_hand <= min_qty),
    'open_proformas', (select count(*) from invoices where kind = 'proforma' and status = 'open'),
    'open_proformas_total', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'proforma' and status = 'open'),
    'pending_deliveries', (select count(*) from delivery_permits where status = 'pending'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'sales', coalesce(s.total, 0)) order by d), '[]')
                from generate_series(p_from, p_to, interval '1 day') d
                left join (select invoice_date, sum(total_sdg) total from invoices
                            where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)
                            group by invoice_date) s on s.invoice_date = d::date),
    'top_products', (select coalesce(jsonb_agg(t), '[]') from (
                       select ii.name, ii.code, sum(ii.qty) qty, sum(ii.total_sdg) total
                         from invoice_items ii join invoices i on i.id = ii.invoice_id
                        where i.kind = 'final' and i.status = 'posted' and i.invoice_date between p_from and p_to and (v_me is null or i.salesperson_id = v_me)
                        group by ii.name, ii.code order by sum(ii.total_sdg) desc limit 6) t),
    'top_sellers', (select coalesce(jsonb_agg(t), '[]') from (
                       select coalesce(nullif(p.full_name, ''), p.username) as name, count(*) invoices, sum(i.total_sdg) total
                         from invoices i join profiles p on p.id = i.salesperson_id
                        where i.kind = 'final' and i.status = 'posted' and i.invoice_date between p_from and p_to and (v_me is null or i.salesperson_id = v_me)
                        group by 1 order by sum(i.total_sdg) desc limit 5) t)
  ) into r;
  if v_me is not null then
    r := r - 'cogs' - 'purchases' - 'expenses' - 'collected' - 'receivables' - 'payables' - 'stock_value_sdg' - 'top_sellers'
           || jsonb_build_object('limited', true);
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- العروض (Views)
-- ---------------------------------------------------------------------
-- من غير security_invoker: الكميات (الكلي/المباع/المسحوب/المحجوز) لازم تظهر لموظف المعرض
-- حتى لو مش مسموحله يشوف حركات المخزن نفسها
drop view if exists public.v_products;
create view public.v_products as
select p.*,
       c.name as category_name,
       round(p.price_usd * coalesce(public.current_rate(), public.latest_rate(), 0), 2) as price_sdg,
       coalesce((select sum(m.qty) from public.stock_movements m
                  where m.product_id = p.id and m.kind in ('purchase_in', 'opening', 'adjust_in')), 0) as total_in,
       coalesce((select sum(ii.qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as sold_qty,
       coalesce((select sum(ii.delivered_qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as withdrawn_qty,
       coalesce((select sum(ii.qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'proforma' and i.status = 'open'), 0) as reserved_qty
  from public.products p
  left join public.categories c on c.id = p.category_id;

create or replace view public.v_invoices with (security_invoker = on) as
select i.*,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       coalesce(nullif(sp.full_name, ''), sp.username) as salesperson_name,
       i.total_sdg - i.paid_sdg as remaining_sdg,
       (select count(*) from public.invoice_items ii where ii.invoice_id = i.id) as items_count,
       (select coalesce(sum(ii.qty - ii.delivered_qty), 0) from public.invoice_items ii where ii.invoice_id = i.id) as undelivered_qty
  from public.invoices i
  left join public.profiles u on u.id = i.created_by
  left join public.profiles sp on sp.id = i.salesperson_id;

create or replace view public.v_purchases with (security_invoker = on) as
select pu.*, s.name as supplier_name,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       pu.total_sdg - pu.paid_sdg as remaining_sdg
  from public.purchases pu
  left join public.suppliers s on s.id = pu.supplier_id
  left join public.profiles u on u.id = pu.created_by;

create or replace view public.v_customer_balances with (security_invoker = on) as
select c.*,
       coalesce((select sum(total_sdg) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted'), 0) as total_sales,
       coalesce((select sum(total_sdg - paid_sdg) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted'), 0) as balance,
       (select count(*) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted') as invoices_count
  from public.customers c;

create or replace view public.v_supplier_balances with (security_invoker = on) as
select s.*,
       coalesce((select sum(total_sdg) from public.purchases where supplier_id = s.id and status = 'posted'), 0) as total_purchases,
       s.opening_balance + coalesce((select sum(total_sdg - paid_sdg) from public.purchases where supplier_id = s.id and status = 'posted'), 0) as balance
  from public.suppliers s;

create or replace view public.v_delivery_permits with (security_invoker = on) as
select d.*, i.number as invoice_number, i.customer_name, i.customer_phone,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       coalesce(nullif(w.full_name, ''), w.username) as delivered_by_name,
       (select coalesce(sum(qty), 0) from public.delivery_items where permit_id = d.id) as total_qty
  from public.delivery_permits d
  join public.invoices i on i.id = d.invoice_id
  left join public.profiles u on u.id = d.created_by
  left join public.profiles w on w.id = d.delivered_by;

create or replace view public.v_expenses with (security_invoker = on) as
select e.*, c.name as category_name, c.kind as category_kind,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  left join public.profiles u on u.id = e.created_by;

create or replace view public.v_payments with (security_invoker = on) as
select p.*, c.name as customer_name, s.name as supplier_name,
       i.number as invoice_number, pu.number as purchase_number,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name
  from public.payments p
  left join public.customers c on c.id = p.customer_id
  left join public.suppliers s on s.id = p.supplier_id
  left join public.invoices i on i.id = p.invoice_id
  left join public.purchases pu on pu.id = p.purchase_id
  left join public.profiles u on u.id = p.created_by;

create or replace view public.v_attendance with (security_invoker = on) as
select a.*, e.full_name as employee_name, e.job_title,
       coalesce(nullif(u.full_name, ''), u.username) as edited_by_name
  from public.attendance a
  join public.employees e on e.id = a.employee_id
  left join public.profiles u on u.id = a.edited_by;

create or replace view public.v_payrolls with (security_invoker = on) as
select p.*, e.full_name as employee_name, e.job_title
  from public.payrolls p join public.employees e on e.id = p.employee_id;

create or replace view public.v_shareholders with (security_invoker = on) as
select s.*, t.monthly_salary, t.sales_pct, t.profit_pct, t.effective_from
  from public.shareholders s
  left join lateral (select * from public.shareholder_terms t
                      where t.shareholder_id = s.id and t.effective_from <= public.local_today()
                      order by t.effective_from desc, t.created_at desc limit 1) t on true;

create or replace view public.v_shareholder_payouts with (security_invoker = on) as
select p.*, s.full_name as shareholder_name
  from public.shareholder_payouts p join public.shareholders s on s.id = p.shareholder_id;

create or replace view public.v_employees with (security_invoker = on) as
select e.*, u.username, u.role as user_role
  from public.employees e left join public.profiles u on u.id = e.user_id;

create or replace view public.v_stock_movements with (security_invoker = on) as
select m.*, p.code, p.name as product_name,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       coalesce(i.number, pu.number) as ref_number
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  left join public.profiles u on u.id = m.created_by
  left join public.invoices i on m.ref_type = 'invoice' and i.id = m.ref_id
  left join public.purchases pu on m.ref_type = 'purchase' and pu.id = m.ref_id;

create or replace view public.v_exchange_rates with (security_invoker = on) as
select r.*, coalesce(nullif(u.full_name, ''), u.username) as created_by_name
  from public.exchange_rates r left join public.profiles u on u.id = r.created_by;


-- =====================================================================
--  WALI CORE — 0003: سجل التدقيق + إشعارات الأدمن + الحماية (RLS)
-- =====================================================================

-- ---------------------------------------------------------------------
-- كل تغيير في السيستم يتسجل، والمهم منه يوصل إشعار للأدمن
-- ---------------------------------------------------------------------
create or replace function public.track_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := coalesce(public.actor_name(), 'النظام');
  n       jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'image' - 'logo' end;
  o       jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'image' - 'logo' end;
  r       jsonb := coalesce(n, o);
  v_title text;
  v_body  text;
  v_level text := 'info';
  v_tmp   text;
begin
  insert into audit_log (table_name, record_id, action, old_data, new_data, user_id, user_name)
  values (tg_table_name, r ->> 'id', lower(tg_op), o, n, v_uid, v_name);

  case tg_table_name
  when 'invoices' then
    if tg_op = 'INSERT' then
      if n ->> 'kind' = 'proforma' then
        v_title := 'فاتورة مبدئية جديدة ' || (n ->> 'number'); v_level := 'warning';
      else
        v_title := 'فاتورة بيع ' || (n ->> 'number'); v_level := 'success';
      end if;
      v_body := coalesce(n ->> 'customer_name', 'عميل نقدي') || ' — ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif tg_op = 'UPDATE' and (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := case n ->> 'status'
                   when 'converted' then 'تحويل المبدئية ' || (n ->> 'number') || ' لفاتورة نهائية'
                   when 'cancelled' then 'إلغاء فاتورة ' || (n ->> 'number')
                   else 'تحديث فاتورة ' || (n ->> 'number') end;
      v_level := case when n ->> 'status' = 'cancelled' then 'danger' else 'info' end;
      v_body := coalesce('السبب: ' || (n ->> 'cancel_reason'), n ->> 'customer_name');
    elsif tg_op = 'UPDATE' and n ->> 'kind' = 'proforma' and (n ->> 'total_sdg') is distinct from (o ->> 'total_sdg') then
      v_title := 'تعديل فاتورة مبدئية ' || (n ->> 'number');
      v_body := fmt((o ->> 'total_sdg')::numeric) || ' ← ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif tg_op = 'UPDATE' and (n ->> 'discount_sdg') is distinct from (o ->> 'discount_sdg') then
      v_title := 'تغيير خصم فاتورة ' || (n ->> 'number'); v_level := 'warning';
    else
      return null;
    end if;

  when 'purchases' then
    if tg_op = 'INSERT' then
      select name into v_tmp from suppliers where id = (n ->> 'supplier_id')::uuid;
      v_title := 'فاتورة مشتريات ' || (n ->> 'number');
      v_body := coalesce(v_tmp, 'بدون مورد') || ' — ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := 'إلغاء مشتريات ' || (n ->> 'number'); v_level := 'danger';
      v_body := 'السبب: ' || coalesce(n ->> 'cancel_reason', '—');
    else return null; end if;

  -- المرتجع بيتسجل بصفر الأول وبعدين بيتحدّث بقيمته، فالإشعار مع التحديث
  when 'sales_returns' then
    if tg_op = 'UPDATE' and coalesce((o ->> 'total_sdg')::numeric, 0) = 0 and (n ->> 'total_sdg')::numeric > 0 then
      select number into v_tmp from invoices where id = (n ->> 'invoice_id')::uuid;
      v_title := 'مرتجع ' || (n ->> 'number') || ' من فاتورة ' || coalesce(v_tmp, '');
      v_body := fmt((n ->> 'total_sdg')::numeric) || ' ج.س'
             || case when (n ->> 'refund_sdg')::numeric > 0 then ' — اترد للعميل ' || fmt((n ->> 'refund_sdg')::numeric) else '' end
             || ' — السبب: ' || (n ->> 'reason');
      v_level := 'warning';
    else return null; end if;

  when 'products' then
    if tg_op = 'INSERT' then
      v_title := 'صنف جديد: ' || (n ->> 'name'); v_body := 'كود ' || (n ->> 'code');
    elsif tg_op = 'DELETE' then
      v_title := 'حذف صنف: ' || (o ->> 'name'); v_level := 'danger';
    elsif (n ->> 'qty_on_hand')::numeric <= (n ->> 'min_qty')::numeric
          and (o ->> 'qty_on_hand')::numeric > (o ->> 'min_qty')::numeric then
      v_title := 'نقص مخزون: ' || (n ->> 'name'); v_level := 'warning';
      v_body := 'الباقي ' || ((n ->> 'qty_on_hand')::numeric)::int || ' — كود ' || (n ->> 'code');
    elsif (n ->> 'price_usd') is distinct from (o ->> 'price_usd')
       or (n ->> 'margin_pct') is distinct from (o ->> 'margin_pct') then
      v_title := 'تغيير سعر: ' || (n ->> 'name');
      v_body := pct(o ->> 'price_usd') || '$ ← ' || pct(n ->> 'price_usd') || '$';
    elsif (n - 'qty_on_hand' - 'updated_at' - 'cost_usd' - 'image_v') is distinct from (o - 'qty_on_hand' - 'updated_at' - 'cost_usd' - 'image_v') then
      v_title := 'تعديل صنف: ' || (n ->> 'name');
    else return null; end if;

  when 'stock_movements' then
    if n ->> 'kind' in ('adjust_in', 'adjust_out', 'opening') then
      select name into v_tmp from products where id = (n ->> 'product_id')::uuid;
      v_title := case n ->> 'kind' when 'opening' then 'رصيد افتتاحي: ' else 'تسوية مخزون: ' end || coalesce(v_tmp, '');
      v_body := (case when (n ->> 'qty')::numeric > 0 then '+' else '' end) || ((n ->> 'qty')::numeric)::int
                || ' — ' || coalesce(n ->> 'note', '');
      v_level := case when n ->> 'kind' = 'adjust_out' then 'warning' else 'info' end;
    else return null; end if;

  when 'exchange_rates' then
    if tg_op <> 'INSERT' then return null; end if;
    v_title := 'سعر الدولار: ' || fmt((n ->> 'rate')::numeric) || ' ج.س';
    v_body := 'ريت يوم ' || (n ->> 'rate_date');

  when 'payments' then
    if tg_op <> 'INSERT' then return null; end if;
    v_title := case when n ->> 'direction' = 'in' then 'تحصيل ' else 'دفع ' end || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_body := n ->> 'notes';
    v_level := case when n ->> 'direction' = 'in' then 'success' else 'info' end;

  when 'expenses' then
    if tg_op = 'INSERT' then
      select name into v_tmp from expense_categories where id = (n ->> 'category_id')::uuid;
      v_title := 'مصروف: ' || coalesce(v_tmp, '') || ' — ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
      v_body := n ->> 'description';
    elsif tg_op = 'DELETE' then
      v_title := 'حذف مصروف ' || fmt((o ->> 'amount_sdg')::numeric) || ' ج.س'; v_level := 'danger';
    else
      v_title := 'تعديل مصروف'; v_level := 'warning';
    end if;

  when 'delivery_permits' then
    if tg_op = 'INSERT' then
      v_title := 'إذن تسليم جديد ' || (n ->> 'number'); v_body := n ->> 'receiver_name';
    elsif (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := case n ->> 'status' when 'delivered' then 'تم تسليم ' else 'إلغاء إذن ' end || (n ->> 'number');
      v_level := case n ->> 'status' when 'delivered' then 'success' else 'danger' end;
    else return null; end if;

  when 'attendance' then
    select full_name into v_tmp from employees where id = (r ->> 'employee_id')::uuid;
    if n ->> 'edited_by' is not null then
      v_title := 'تعديل حضور: ' || coalesce(v_tmp, ''); v_level := 'warning';
      v_body := 'يوم ' || (n ->> 'work_date');
    elsif tg_op = 'INSERT' then
      v_title := 'حضور: ' || coalesce(v_tmp, '');
      v_body := case when (n ->> 'late_minutes')::int > 0 then 'متأخر ' || (n ->> 'late_minutes') || ' دقيقة' else 'في الميعاد' end;
      v_level := case when (n ->> 'late_minutes')::int > 0 then 'warning' else 'info' end;
    elsif (n ->> 'check_out') is distinct from (o ->> 'check_out') then
      v_title := 'انصراف: ' || coalesce(v_tmp, '');
    else return null; end if;

  when 'employees' then
    v_title := case tg_op when 'INSERT' then 'موظف جديد: ' when 'DELETE' then 'حذف موظف: ' else 'تعديل بيانات موظف: ' end
               || (r ->> 'full_name');
    if (n ->> 'base_salary') is distinct from (o ->> 'base_salary') and tg_op = 'UPDATE' then
      v_body := 'المرتب: ' || fmt((o ->> 'base_salary')::numeric) || ' ← ' || fmt((n ->> 'base_salary')::numeric);
      v_level := 'warning';
    end if;

  when 'salary_advances' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
    v_title := 'سلفة لـ ' || coalesce(v_tmp, '') || ': ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_level := 'warning';

  when 'salary_deductions' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
    v_title := 'خصم على ' || coalesce(v_tmp, '') || ': ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_body := n ->> 'reason';

  when 'payrolls' then
    if tg_op = 'UPDATE' and n ->> 'status' = 'paid' and o ->> 'status' <> 'paid' then
      select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
      v_title := 'صرف مرتب ' || coalesce(v_tmp, '') || ' — ' || (n ->> 'period');
      v_body := 'الصافي ' || fmt((n ->> 'net')::numeric) || ' ج.س';
    else return null; end if;

  when 'shareholders' then
    v_title := case tg_op when 'INSERT' then 'مساهم جديد: ' when 'DELETE' then 'حذف مساهم: ' else 'تعديل مساهم: ' end
               || (r ->> 'full_name');
    v_level := case when tg_op = 'DELETE' or (n ->> 'is_active') = 'false' then 'danger' else 'info' end;

  when 'shareholder_terms' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from shareholders where id = (n ->> 'shareholder_id')::uuid;
    v_title := 'نسب جديدة للمساهم ' || coalesce(v_tmp, '');
    v_body := 'مرتب ' || fmt((n ->> 'monthly_salary')::numeric) || ' — مبيعات ' || pct(n ->> 'sales_pct')
              || '% — أرباح ' || pct(n ->> 'profit_pct') || '% من ' || (n ->> 'effective_from');
    v_level := 'warning';

  when 'shareholder_payouts' then
    if tg_op = 'UPDATE' and n ->> 'status' = 'paid' and o ->> 'status' <> 'paid' then
      select full_name into v_tmp from shareholders where id = (n ->> 'shareholder_id')::uuid;
      v_title := 'صرف مستحقات ' || coalesce(v_tmp, '') || ' — ' || (n ->> 'period');
      v_body := fmt((n ->> 'total')::numeric) || ' ج.س';
    else return null; end if;

  when 'profiles' then
    if tg_op = 'INSERT' then
      v_title := 'مستخدم جديد: ' || (n ->> 'username');
    elsif tg_op = 'DELETE' then
      v_title := 'حذف المستخدم ' || (o ->> 'username'); v_level := 'danger';
    elsif (n ->> 'permissions') is distinct from (o ->> 'permissions') or (n ->> 'role') is distinct from (o ->> 'role') then
      v_title := 'تغيير صلاحيات: ' || (n ->> 'username'); v_level := 'warning';
    elsif (n ->> 'is_active') is distinct from (o ->> 'is_active') then
      v_title := case when (n ->> 'is_active')::boolean then 'تفعيل ' else 'إيقاف ' end || 'المستخدم ' || (n ->> 'username');
      v_level := 'danger';
    else return null; end if;

  when 'settings' then
    v_title := 'تعديل إعدادات الشركة'; v_level := 'warning';

  when 'customers' then
    v_title := case tg_op when 'INSERT' then 'عميل جديد: ' when 'DELETE' then 'حذف عميل: ' else 'تعديل عميل: ' end || (r ->> 'name');

  when 'suppliers' then
    v_title := case tg_op when 'INSERT' then 'مورد جديد: ' when 'DELETE' then 'حذف مورد: ' else 'تعديل مورد: ' end || (r ->> 'name');

  when 'categories' then
    v_title := case tg_op when 'INSERT' then 'قسم جديد: ' when 'DELETE' then 'حذف قسم: ' else 'تعديل قسم: ' end || (r ->> 'name');

  else
    return null;
  end case;
  if v_title is null then return null; end if;

  insert into notifications (type, level, title, body, entity_type, entity_id, actor_id, actor_name, data)
  values (tg_table_name || '.' || lower(tg_op), v_level, v_title, v_body, tg_table_name,
          (r ->> 'id')::uuid, v_uid, v_name, n);
  return null;
end $$;

-- settings.id رقم مش uuid، فبنحوّل بأمان
create or replace function public.safe_uuid(t text) returns uuid
language plpgsql immutable as $$
begin return t::uuid; exception when others then return null; end $$;

do $$
declare t text;
begin
  -- settings: id integer، فبنعالجه بدالة لوحدها
  foreach t in array array[
    'invoices','purchases','products','stock_movements','exchange_rates','payments','expenses',
    'delivery_permits','attendance','employees','salary_advances','salary_deductions','payrolls',
    'shareholders','shareholder_terms','shareholder_payouts','profiles','customers','suppliers',
    'categories','expense_categories','invoice_items','purchase_items']
  loop
    execute format('drop trigger if exists track_change on public.%I', t);
    execute format('create trigger track_change after insert or update or delete on public.%I
                    for each row execute function public.track_change()', t);
  end loop;
end $$;

create or replace function public.track_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (table_name, record_id, action, old_data, new_data, user_id, user_name)
  values ('settings', '1', 'update', to_jsonb(old) - 'logo', to_jsonb(new) - 'logo', auth.uid(), public.actor_name());
  insert into notifications (type, level, title, actor_id, actor_name)
  values ('settings.update', 'warning', 'تعديل إعدادات الشركة', auth.uid(), coalesce(public.actor_name(), 'النظام'));
  return null;
end $$;
drop trigger if exists track_settings on public.settings;
create trigger track_settings after update on public.settings
  for each row execute function public.track_settings();

-- ---------------------------------------------------------------------
-- الحماية: Row Level Security
-- ---------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in select * from (values
      -- الجدول            , الموديول      , القراءة لكل المستخدمين؟
      ('categories',          'products',     true),
      ('products',            'products',     true),
      ('stock_movements',     'stock',        false),
      ('customers',           'customers',    true),
      ('suppliers',           'suppliers',    false),
      ('purchases',           'purchases',    false),
      ('purchase_items',      'purchases',    false),
      ('invoices',            'sales',        false),
      ('invoice_items',       'sales',        false),
      ('delivery_permits',    'delivery',     false),
      ('delivery_items',      'delivery',     false),
      ('payments',            'accounting',   false),
      ('expense_categories',  'expenses',     true),
      ('expenses',            'expenses',     false),
      ('employees',           'hr',           false),
      ('attendance',          'attendance',   false),
      ('salary_advances',     'payroll',      false),
      ('salary_deductions',   'payroll',      false),
      ('payrolls',            'payroll',      false),
      ('shareholders',        'shareholders', false),
      ('shareholder_terms',   'shareholders', false),
      ('shareholder_payouts', 'shareholders', false),
      ('exchange_rates',      'rates',        true),
      ('doc_counters',        'settings',     false)
    ) as x(tbl, module, open_read)
  loop
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('drop policy if exists sel on public.%I', rec.tbl);
    execute format('drop policy if exists ins on public.%I', rec.tbl);
    execute format('drop policy if exists upd on public.%I', rec.tbl);
    execute format('drop policy if exists del on public.%I', rec.tbl);
    if rec.open_read then
      execute format('create policy sel on public.%I for select to authenticated using (public.is_active_user())', rec.tbl);
    else
      execute format('create policy sel on public.%I for select to authenticated using (public.has_perm(%L, ''view''))', rec.tbl, rec.module);
    end if;
    execute format('create policy ins on public.%I for insert to authenticated with check (public.has_perm(%L, ''create''))', rec.tbl, rec.module);
    execute format('create policy upd on public.%I for update to authenticated using (public.has_perm(%L, ''edit'')) with check (public.has_perm(%L, ''edit''))', rec.tbl, rec.module, rec.module);
    execute format('create policy del on public.%I for delete to authenticated using (public.is_admin())', rec.tbl);
  end loop;
end $$;

-- الفواتير والحركات المعتمدة متتعدلش مباشرة — بس من خلال الدوال
drop policy if exists upd on public.invoices;
drop policy if exists ins on public.invoices;
drop policy if exists upd on public.invoice_items;
drop policy if exists ins on public.invoice_items;
drop policy if exists upd on public.stock_movements;
drop policy if exists ins on public.stock_movements;
drop policy if exists upd on public.purchases;
drop policy if exists ins on public.purchases;
drop policy if exists upd on public.purchase_items;
drop policy if exists ins on public.purchase_items;
drop policy if exists upd on public.payments;
drop policy if exists ins on public.payments;
drop policy if exists upd on public.delivery_permits;
drop policy if exists ins on public.delivery_permits;
drop policy if exists ins on public.delivery_items;
drop policy if exists upd on public.delivery_items;
drop policy if exists ins on public.exchange_rates;
drop policy if exists upd on public.exchange_rates;
drop policy if exists upd on public.payrolls;
drop policy if exists ins on public.payrolls;
drop policy if exists upd on public.shareholder_payouts;
drop policy if exists ins on public.shareholder_payouts;
drop policy if exists ins on public.attendance;
drop policy if exists upd on public.attendance;
drop policy if exists sel on public.attendance;
-- الموظف يشوف حضوره هو، واللي عنده صلاحية يشوف الكل
create policy sel on public.attendance for select to authenticated
  using (public.has_perm('attendance', 'view')
         or employee_id in (select id from public.employees where user_id = auth.uid()));
drop policy if exists sel on public.employees;
create policy sel on public.employees for select to authenticated
  using (public.has_perm('hr', 'view') or user_id = auth.uid());
drop policy if exists sel on public.doc_counters;

-- المستخدمين
alter table public.profiles enable row level security;
drop policy if exists sel on public.profiles;
drop policy if exists upd on public.profiles;
create policy sel on public.profiles for select to authenticated using (public.is_active_user() or id = auth.uid());
create policy upd on public.profiles for update to authenticated
  using (public.has_perm('users', 'edit') or id = auth.uid())
  with check (public.has_perm('users', 'edit') or id = auth.uid());

-- الإعدادات: الكل يقرا، واللي عنده صلاحية يعدّل
alter table public.settings enable row level security;
drop policy if exists sel on public.settings;
drop policy if exists upd on public.settings;
create policy sel on public.settings for select to authenticated using (true);
create policy upd on public.settings for update to authenticated
  using (public.has_perm('settings', 'edit')) with check (public.has_perm('settings', 'edit'));

-- الإشعارات وسجل التدقيق: للأدمن بس
alter table public.notifications enable row level security;
drop policy if exists sel on public.notifications;
drop policy if exists upd on public.notifications;
drop policy if exists del on public.notifications;
create policy sel on public.notifications for select to authenticated using (public.is_admin());
create policy upd on public.notifications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy del on public.notifications for delete to authenticated using (public.is_admin());

alter table public.audit_log enable row level security;
drop policy if exists sel on public.audit_log;
create policy sel on public.audit_log for select to authenticated using (public.is_admin());

alter table public.push_subscriptions enable row level security;
drop policy if exists own on public.push_subscriptions;
create policy own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_admin());

-- مفيش وصول لغير المسجلين
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ---------------------------------------------------------------------
-- التحديث اللحظي (Realtime)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications','invoices','products','exchange_rates','delivery_permits','attendance'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;


-- ربط جدول notifications بدالة push-notify (بديل Database Webhook من لوحة Supabase)
-- بعد التشغيل: insert into private.config values ('push_url', 'https://<ref>.supabase.co/functions/v1/push-notify'), ('webhook_secret', '<WEBHOOK_SECRET>');
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);

create or replace function private.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.config where key = 'push_url';
  select value into v_secret from private.config where key = 'webhook_secret';
  if v_url is not null then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(v_secret, ''))
    );
  end if;
  return new;
end $$;

drop trigger if exists push_notification on public.notifications;
create trigger push_notification after insert on public.notifications
  for each row execute function private.push_notification();


-- =====================================================================
--  WALI CORE — 0005: مرتجع جزئي من فاتورة البيع + إلغاء فاتورة المشتريات
--  الفاتورة الأصلية بتفضل زي ما هي، والمرتجع بيتسجل لوحده بتاريخه،
--  فالتقارير بتخصمه في يوم المرتجع (والشهور القديمة متتغيرش)
-- =====================================================================

alter table public.stock_movements drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check check (kind in
  ('purchase_in','sale_out','cancel_in','adjust_in','adjust_out','opening','return_in','purchase_cancel'));

alter table public.invoice_items add column if not exists returned_qty numeric(14,3) not null default 0;
alter table public.invoices add column if not exists returned_sdg numeric(16,2) not null default 0;
alter table public.invoices add column if not exists returned_cost_sdg numeric(16,2) not null default 0;
alter table public.purchases add column if not exists cancel_reason text;
alter table public.purchases add column if not exists cancelled_at timestamptz;

create table if not exists public.sales_returns (
  id          uuid primary key default gen_random_uuid(),
  number      text unique not null,
  invoice_id  uuid not null references public.invoices(id),
  customer_id uuid references public.customers(id),
  return_date date not null default public.local_today(),
  total_sdg   numeric(16,2) not null,            -- قيمة المرتجع بعد نصيبه من الخصم
  cost_sdg    numeric(16,2) not null,            -- تكلفته (بريت الفاتورة)
  refund_sdg  numeric(16,2) not null default 0,  -- اللي اترد للعميل كاش
  reason      text not null,
  salesperson_id uuid references public.profiles(id),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists sales_returns_date_idx on public.sales_returns(return_date desc);

create table if not exists public.sales_return_items (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.sales_returns(id) on delete cascade,
  invoice_item_id uuid not null references public.invoice_items(id),
  product_id      uuid not null references public.products(id),
  code            text not null,
  name            text not null,
  qty             numeric(14,3) not null check (qty > 0),
  unit_price_sdg  numeric(16,2) not null,
  total_sdg       numeric(16,2) not null,
  unit_cost_usd   numeric(14,4) not null default 0
);

create or replace function public.next_doc_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from local_today())::int;
  n int;
  prefix text;
begin
  insert into doc_counters (kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = doc_counters.last + 1
  returning last into n;
  prefix := case p_kind
    when 'proforma' then 'PF' when 'final' then 'INV' when 'return' then 'RT'
    when 'purchase' then 'PO' when 'delivery' then 'DL' else upper(p_kind) end;
  return prefix || '-' || lpad((y % 100)::text, 2, '0') || '-' || lpad(n::text, 5, '0');
end $$;

-- ---------------------------------------------------------------------
-- المرتجع: p_items = [{invoice_item_id, qty}]
-- لو العميل دافع أكتر من قيمة الفاتورة بعد المرتجع، الفرق بيترد له
-- ---------------------------------------------------------------------
create or replace function public.create_sales_return(p_invoice uuid, p_items jsonb, p_reason text)
returns public.sales_returns
language plpgsql security definer set search_path = public as $$
declare
  v_inv   invoices;
  v_ret   sales_returns;
  it      jsonb;
  ii      invoice_items;
  v_qty   numeric;
  v_avail numeric;
  v_line  numeric;
  v_net   numeric;
  v_cost  numeric;
  v_total numeric := 0;
  v_tcost numeric := 0;
  v_over  numeric;
begin
  perform ensure_perm('sales', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب المرتجع'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'اختار الأصناف اللي راجعة';
  end if;
  select * into v_inv from invoices where id = p_invoice for update;
  if not found or v_inv.kind <> 'final' or v_inv.status <> 'posted' then
    raise exception 'المرتجع بيتعمل من فاتورة نهائية بس';
  end if;

  insert into sales_returns (number, invoice_id, customer_id, total_sdg, cost_sdg, reason, salesperson_id, created_by)
  values (next_doc_number('return'), p_invoice, v_inv.customer_id, 0, 0, trim(p_reason), v_inv.salesperson_id, auth.uid())
  returning * into v_ret;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::numeric, 0);
    if v_qty = 0 then continue; end if;
    select * into ii from invoice_items where id = (it ->> 'invoice_item_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'الصنف ده مش في الفاتورة'; end if;
    -- اللي عليه إذن تسليم لسه منتظر مينفعش يرجع قبل ما الإذن يتلغي أو يتسلم
    v_avail := ii.qty - ii.returned_qty - coalesce((
                 select sum(di.qty) from delivery_items di join delivery_permits dp on dp.id = di.permit_id
                  where di.invoice_item_id = ii.id and dp.status = 'pending'), 0);
    if v_qty < 0 or v_qty > v_avail then
      raise exception 'الكمية المتاحة للمرتجع من "%" هي % بس', ii.name, greatest(v_avail, 0)::numeric(14,0);
    end if;

    v_line := round(ii.unit_price_sdg * v_qty, 2);
    v_net := v_line - case when v_inv.subtotal_sdg > 0
                           then round(v_inv.discount_sdg * v_line / v_inv.subtotal_sdg, 2) else 0 end;
    v_cost := round(ii.unit_cost_usd * v_inv.rate * v_qty, 2);
    v_total := v_total + v_net;
    v_tcost := v_tcost + v_cost;

    insert into sales_return_items (return_id, invoice_item_id, product_id, code, name, qty, unit_price_sdg, total_sdg, unit_cost_usd)
    values (v_ret.id, ii.id, ii.product_id, ii.code, ii.name, v_qty, ii.unit_price_sdg, v_net, ii.unit_cost_usd);
    update invoice_items set returned_qty = returned_qty + v_qty where id = ii.id;
    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
    values (ii.product_id, 'return_in', v_qty, ii.unit_cost_usd, 'sales_return', v_ret.id,
            'مرتجع من ' || v_inv.number, auth.uid());
  end loop;

  if v_total = 0 and v_tcost = 0 then raise exception 'اكتب كمية المرتجع'; end if;

  update invoices set returned_sdg = returned_sdg + v_total, returned_cost_sdg = returned_cost_sdg + v_tcost
   where id = p_invoice returning * into v_inv;

  v_over := v_inv.paid_sdg - (v_inv.total_sdg - v_inv.returned_sdg);
  if v_over > 0 then
    insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, notes, created_by)
    values ('out', 'customer', v_inv.customer_id, p_invoice, v_over, 'رد مبلغ مرتجع ' || v_ret.number, auth.uid());
  end if;

  update sales_returns set total_sdg = v_total, cost_sdg = v_tcost, refund_sdg = greatest(v_over, 0)
   where id = v_ret.id returning * into v_ret;
  return v_ret;
end $$;

-- إلغاء الفاتورة بعد مرتجع جزئي: بيرجّع الباقي بس
create or replace function public.cancel_invoice(p_id uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v_inv invoices; it record;
begin
  perform ensure_perm('sales', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;
  select * into v_inv from invoices where id = p_id for update;
  if not found then raise exception 'الفاتورة مش موجودة'; end if;
  if v_inv.status in ('cancelled', 'converted') then raise exception 'الفاتورة دي مينفعش تتلغي'; end if;
  if v_inv.returned_sdg > 0 then raise exception 'الفاتورة دي عليها مرتجع، اعمل مرتجع بالباقي بدل الإلغاء'; end if;

  if v_inv.kind = 'final' then
    for it in select * from invoice_items where invoice_id = p_id loop
      insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
      values (it.product_id, 'cancel_in', it.qty, it.unit_cost_usd, 'invoice', p_id, 'إلغاء ' || v_inv.number, auth.uid());
    end loop;
    update delivery_permits set status = 'cancelled' where invoice_id = p_id and status = 'pending';
    if v_inv.paid_sdg > 0 then
      insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, notes, created_by)
      values ('out', 'customer', v_inv.customer_id, p_id, v_inv.paid_sdg, 'رد مبلغ إلغاء ' || v_inv.number, auth.uid());
    end if;
  end if;

  update invoices set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
   where id = p_id returning * into v_inv;
  return v_inv;
end $$;

-- ---------------------------------------------------------------------
-- إلغاء المشتريات: البضاعة تخرج من المخزن، والتكلفة ترجع زي ما كانت،
-- واللي اتدفع للمورد يتسجل استرداد
-- ---------------------------------------------------------------------
create or replace function public.cancel_purchase(p_id uuid, p_reason text) returns public.purchases
language plpgsql security definer set search_path = public as $$
declare v_pur purchases; it record; pr products; v_rest numeric; v_cost numeric;
begin
  perform ensure_perm('purchases', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;
  select * into v_pur from purchases where id = p_id for update;
  if not found or v_pur.status <> 'posted' then raise exception 'الفاتورة دي مينفعش تتلغي'; end if;

  for it in select * from purchase_items where purchase_id = p_id loop
    select * into pr from products where id = it.product_id for update;
    if pr.qty_on_hand < it.qty then
      raise exception 'مينفعش تتلغي: "%" اتباع منه، والموجود % بس من %', pr.name,
        pr.qty_on_hand::numeric(14,0), it.qty::numeric(14,0);
    end if;
    v_rest := pr.qty_on_hand - it.qty;
    v_cost := case when v_rest > 0 then round((pr.qty_on_hand * pr.cost_usd - it.qty * it.landed_usd) / v_rest, 4) end;
    if v_cost is not null and v_cost > 0 then
      update products set cost_usd = v_cost where id = pr.id;
    end if;
    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
    values (pr.id, 'purchase_cancel', -it.qty, it.landed_usd, 'purchase', p_id, 'إلغاء ' || v_pur.number, auth.uid());
  end loop;

  if v_pur.paid_sdg > 0 then
    insert into payments (direction, party_type, supplier_id, purchase_id, amount_sdg, notes, created_by)
    values ('in', 'supplier', v_pur.supplier_id, p_id, v_pur.paid_sdg, 'استرداد من المورد — إلغاء ' || v_pur.number, auth.uid());
  end if;

  update purchases set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_at = now()
   where id = p_id returning * into v_pur;
  return v_pur;
end $$;

-- ---------------------------------------------------------------------
-- كل الحسابات اللي بتعتمد على قيمة الفاتورة بقت بتطرح المرتجع
-- ---------------------------------------------------------------------
create or replace function public.sync_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_pur uuid; v_paid numeric; v_total numeric;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  v_pur := coalesce(new.purchase_id, old.purchase_id);
  if v_inv is not null then
    select coalesce(sum(case when direction = 'in' then amount_sdg else -amount_sdg end), 0)
      into v_paid from payments where invoice_id = v_inv;
    select total_sdg - returned_sdg into v_total from invoices where id = v_inv;
    update invoices set paid_sdg = v_paid,
           payment_type = case when kind = 'proforma' or status = 'cancelled' then payment_type
                                when v_paid >= v_total then 'cash' when v_paid <= 0 then 'credit' else 'partial' end
     where id = v_inv;
  end if;
  if v_pur is not null then
    select coalesce(sum(case when direction = 'out' then amount_sdg else -amount_sdg end), 0)
      into v_paid from payments where purchase_id = v_pur;
    update purchases set paid_sdg = v_paid where id = v_pur;
  end if;
  return null;
end $$;

create or replace function public.record_payment(p jsonb) returns public.payments
language plpgsql security definer set search_path = public as $$
declare v payments; v_amt numeric := nullif(p ->> 'amount_sdg', '')::numeric;
        v_inv invoices; v_pur purchases;
begin
  perform ensure_perm('accounting', 'create');
  if v_amt is null or v_amt <= 0 then raise exception 'المبلغ لازم يكون أكبر من صفر'; end if;
  if nullif(p ->> 'invoice_id', '') is not null then
    select * into v_inv from invoices where id = (p ->> 'invoice_id')::uuid;
    if v_inv.status <> 'posted' then raise exception 'الفاتورة مش نهائية'; end if;
    if v_amt > v_inv.total_sdg - v_inv.returned_sdg - v_inv.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي على الفاتورة (%)', fmt(v_inv.total_sdg - v_inv.returned_sdg - v_inv.paid_sdg);
    end if;
  end if;
  if nullif(p ->> 'purchase_id', '') is not null then
    select * into v_pur from purchases where id = (p ->> 'purchase_id')::uuid;
    if v_pur.status <> 'posted' then raise exception 'فاتورة المشتريات دي ملغية'; end if;
    if v_amt > v_pur.total_sdg - v_pur.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي للمورد (%)', fmt(v_pur.total_sdg - v_pur.paid_sdg);
    end if;
  end if;
  insert into payments (direction, party_type, customer_id, supplier_id, invoice_id, purchase_id,
                        amount_sdg, method, pay_date, notes, created_by)
  values (p ->> 'direction', p ->> 'party_type',
          coalesce(nullif(p ->> 'customer_id', '')::uuid, v_inv.customer_id),
          coalesce(nullif(p ->> 'supplier_id', '')::uuid, v_pur.supplier_id),
          v_inv.id, v_pur.id, v_amt, coalesce(nullif(p ->> 'method', ''), 'cash'),
          coalesce(nullif(p ->> 'pay_date', '')::date, local_today()), p ->> 'notes', auth.uid())
  returning * into v;
  return v;
end $$;

create or replace function public.create_delivery_permit(p_invoice uuid, p_receiver text default null,
                                                         p_notes text default null, p_items jsonb default null)
returns public.delivery_permits
language plpgsql security definer set search_path = public as $$
declare v_inv invoices; v_dp delivery_permits; it record; v_qty numeric; v_any boolean := false;
begin
  perform ensure_perm('delivery', 'create');
  select * into v_inv from invoices where id = p_invoice;
  if not found or v_inv.kind <> 'final' or v_inv.status <> 'posted' then
    raise exception 'إذن التسليم بيطلع لفاتورة نهائية بس';
  end if;

  insert into delivery_permits (number, invoice_id, receiver_name, notes, created_by)
  values (next_doc_number('delivery'), p_invoice, coalesce(p_receiver, v_inv.customer_name), p_notes, auth.uid())
  returning * into v_dp;

  for it in
    select ii.*, ii.qty - ii.returned_qty - ii.delivered_qty - coalesce((
             select sum(di.qty) from delivery_items di join delivery_permits dp on dp.id = di.permit_id
              where di.invoice_item_id = ii.id and dp.status = 'pending' and dp.id <> v_dp.id), 0) as remaining
      from invoice_items ii where ii.invoice_id = p_invoice order by ii.sort
  loop
    v_qty := case when p_items is null then it.remaining
                  else least(it.remaining, coalesce((
                    select (e ->> 'qty')::numeric from jsonb_array_elements(p_items) e
                     where (e ->> 'invoice_item_id')::uuid = it.id limit 1), 0)) end;
    if v_qty > 0 then
      insert into delivery_items (permit_id, invoice_item_id, product_id, qty)
      values (v_dp.id, it.id, it.product_id, v_qty);
      v_any := true;
    end if;
  end loop;

  if not v_any then raise exception 'كل أصناف الفاتورة دي اتسلمت أو عليها إذن تسليم'; end if;
  return v_dp;
end $$;

create or replace function public.period_sales(p_from date, p_to date, p_user uuid default null)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(total_sdg) from invoices
                    where kind = 'final' and status = 'posted'
                      and invoice_date >= p_from and invoice_date < p_to
                      and (p_user is null or salesperson_id = p_user)), 0)
       - coalesce((select sum(total_sdg) from sales_returns
                    where return_date >= p_from and return_date < p_to
                      and (p_user is null or salesperson_id = p_user)), 0)
$$;

create or replace function public.annual_report(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d1 date := make_date(p_year, 1, 1);
  d2 date := make_date(p_year + 1, 1, 1);
  v_sales numeric; v_cogs numeric; v_disc numeric; v_exp numeric; v_net numeric; v_paid_sh numeric;
  v_ret numeric; v_ret_cost numeric;
  v_months jsonb; v_cats jsonb; v_sh jsonb;
begin
  perform ensure_perm('reports', 'view');
  select coalesce(sum(total_sdg), 0), coalesce(sum(cost_sdg), 0), coalesce(sum(discount_sdg), 0)
    into v_sales, v_cogs, v_disc from invoices
   where kind = 'final' and status = 'posted' and invoice_date >= d1 and invoice_date < d2;
  select coalesce(sum(total_sdg), 0), coalesce(sum(cost_sdg), 0) into v_ret, v_ret_cost
    from sales_returns where return_date >= d1 and return_date < d2;
  v_sales := v_sales - v_ret;
  v_cogs := v_cogs - v_ret_cost;
  select coalesce(sum(amount_sdg), 0) into v_exp from expenses where expense_date >= d1 and expense_date < d2;
  v_net := v_sales - v_cogs - v_exp;
  select coalesce(sum(total), 0) into v_paid_sh from shareholder_payouts
   where period >= to_char(d1, 'YYYY-MM') and period < to_char(d2, 'YYYY-MM') and status = 'paid';

  select jsonb_agg(m order by (m ->> 'month')) into v_months from (
    select jsonb_build_object(
      'month', to_char(gs, 'YYYY-MM'),
      'sales', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'final' and status = 'posted'
                 and invoice_date >= gs and invoice_date < gs + interval '1 month')
             - (select coalesce(sum(total_sdg), 0) from sales_returns
                 where return_date >= gs and return_date < gs + interval '1 month'),
      'cogs', (select coalesce(sum(cost_sdg), 0) from invoices where kind = 'final' and status = 'posted'
                 and invoice_date >= gs and invoice_date < gs + interval '1 month')
            - (select coalesce(sum(cost_sdg), 0) from sales_returns
                 where return_date >= gs and return_date < gs + interval '1 month'),
      'expenses', (select coalesce(sum(amount_sdg), 0) from expenses
                 where expense_date >= gs and expense_date < gs + interval '1 month')) m
    from generate_series(d1, d2 - 1, interval '1 month') gs) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'total', t.total) order by t.total desc), '[]')
    into v_cats from (select category_id, sum(amount_sdg) total from expenses
                       where expense_date >= d1 and expense_date < d2 group by category_id) t
    join expense_categories c on c.id = t.category_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.full_name,
           'profit_pct', coalesce(t.profit_pct, 0),
           'profit_share', round(greatest(v_net, 0) * coalesce(t.profit_pct, 0) / 100.0, 2),
           'received', coalesce(pd.total, 0),
           'remaining', round(greatest(v_net, 0) * coalesce(t.profit_pct, 0) / 100.0, 2) - coalesce(pd.total, 0))
         order by s.full_name), '[]')
    into v_sh
    from shareholders s
    left join lateral (select * from shareholder_terms_at(s.id, least(d2 - 1, coalesce(s.left_at, d2 - 1)))) t on true
    left join lateral (select sum(total) total from shareholder_payouts
                        where shareholder_id = s.id and status = 'paid'
                          and period >= to_char(d1, 'YYYY-MM') and period < to_char(d2, 'YYYY-MM')) pd on true
   where s.joined_at < d2 and (s.left_at is null or s.left_at >= d1);

  return jsonb_build_object(
    'year', p_year, 'sales', v_sales, 'discounts', v_disc, 'returns', v_ret, 'cogs', v_cogs,
    'gross_profit', v_sales - v_cogs, 'expenses', v_exp, 'net_profit', v_net,
    'shareholder_paid', v_paid_sh, 'months', coalesce(v_months, '[]'), 'expense_categories', v_cats,
    'shareholders', v_sh);
end $$;

create or replace function public.dashboard(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rate numeric := coalesce(current_rate(), latest_rate(), 0);
  r jsonb;
  -- اللي معندوش صلاحية التقارير: مبيعاته هو بس
  v_me uuid := case when has_perm('reports', 'view') then null else auth.uid() end;
  v_ret numeric; v_ret_cost numeric;
begin
  if not is_active_user() then raise exception 'غير مصرح'; end if;
  select coalesce(sum(total_sdg), 0), coalesce(sum(cost_sdg), 0) into v_ret, v_ret_cost
    from sales_returns where return_date between p_from and p_to and (v_me is null or salesperson_id = v_me);
  select jsonb_build_object(
    'rate_today', current_rate(),
    'rate_latest', latest_rate(),
    'sales', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)) - v_ret,
    'returns', v_ret,
    'sales_count', (select count(*) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)),
    'cogs', (select coalesce(sum(cost_sdg), 0) from invoices where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)) - v_ret_cost,
    'purchases', (select coalesce(sum(total_sdg), 0) from purchases where status = 'posted' and purchase_date between p_from and p_to),
    'expenses', (select coalesce(sum(amount_sdg), 0) from expenses where expense_date between p_from and p_to),
    'collected', (select coalesce(sum(case when direction = 'in' then amount_sdg else -amount_sdg end), 0) from payments where party_type = 'customer' and pay_date between p_from and p_to),
    'receivables', (select coalesce(sum(total_sdg - returned_sdg - paid_sdg), 0) from invoices where kind = 'final' and status = 'posted'),
    'payables', (select coalesce(sum(total_sdg - paid_sdg), 0) from purchases where status = 'posted'),
    'stock_value_sdg', (select coalesce(sum(qty_on_hand * cost_usd), 0) * v_rate from products where is_active),
    'stock_units', (select coalesce(sum(qty_on_hand), 0) from products where is_active),
    'products_count', (select count(*) from products where is_active),
    'low_stock', (select count(*) from products where is_active and qty_on_hand <= min_qty),
    'open_proformas', (select count(*) from invoices where kind = 'proforma' and status = 'open'),
    'open_proformas_total', (select coalesce(sum(total_sdg), 0) from invoices where kind = 'proforma' and status = 'open'),
    'pending_deliveries', (select count(*) from delivery_permits where status = 'pending'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'sales', coalesce(s.total, 0) - coalesce(rt.total, 0)) order by d), '[]')
                from generate_series(p_from, p_to, interval '1 day') d
                left join (select invoice_date, sum(total_sdg) total from invoices
                            where kind = 'final' and status = 'posted' and invoice_date between p_from and p_to and (v_me is null or salesperson_id = v_me)
                            group by invoice_date) s on s.invoice_date = d::date
                left join (select return_date, sum(total_sdg) total from sales_returns
                            where return_date between p_from and p_to and (v_me is null or salesperson_id = v_me)
                            group by return_date) rt on rt.return_date = d::date),
    'top_products', (select coalesce(jsonb_agg(t), '[]') from (
                       select ii.name, ii.code, sum(ii.qty - ii.returned_qty) qty,
                              sum(round(ii.unit_price_sdg * (ii.qty - ii.returned_qty), 2)) total
                         from invoice_items ii join invoices i on i.id = ii.invoice_id
                        where i.kind = 'final' and i.status = 'posted' and i.invoice_date between p_from and p_to and (v_me is null or i.salesperson_id = v_me)
                        group by ii.name, ii.code having sum(ii.qty - ii.returned_qty) > 0
                        order by 4 desc limit 6) t),
    'top_sellers', (select coalesce(jsonb_agg(t), '[]') from (
                       select coalesce(nullif(p.full_name, ''), p.username) as name, count(*) invoices, sum(i.total_sdg - i.returned_sdg) total
                         from invoices i join profiles p on p.id = i.salesperson_id
                        where i.kind = 'final' and i.status = 'posted' and i.invoice_date between p_from and p_to and (v_me is null or i.salesperson_id = v_me)
                        group by 1 order by 3 desc limit 5) t)
  ) into r;
  if v_me is not null then
    r := r - 'cogs' - 'purchases' - 'expenses' - 'collected' - 'receivables' - 'payables' - 'stock_value_sdg' - 'top_sellers'
           || jsonb_build_object('limited', true);
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- العروض
-- ---------------------------------------------------------------------
drop view if exists public.v_products;
create view public.v_products as
select p.*,
       c.name as category_name,
       round(p.price_usd * coalesce(public.current_rate(), public.latest_rate(), 0), 2) as price_sdg,
       coalesce((select sum(m.qty) from public.stock_movements m
                  where m.product_id = p.id and m.kind in ('purchase_in', 'opening', 'adjust_in')), 0)
     + coalesce((select sum(m.qty) from public.stock_movements m
                  where m.product_id = p.id and m.kind = 'purchase_cancel'), 0) as total_in,
       coalesce((select sum(ii.qty - ii.returned_qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as sold_qty,
       coalesce((select sum(ii.delivered_qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as withdrawn_qty,
       coalesce((select sum(ii.qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'proforma' and i.status = 'open'), 0) as reserved_qty
  from public.products p
  left join public.categories c on c.id = p.category_id;

drop view if exists public.v_invoices;
create view public.v_invoices with (security_invoker = on) as
select i.*,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       coalesce(nullif(sp.full_name, ''), sp.username) as salesperson_name,
       i.total_sdg - i.returned_sdg - i.paid_sdg as remaining_sdg,
       (select count(*) from public.invoice_items ii where ii.invoice_id = i.id) as items_count,
       (select coalesce(sum(greatest(ii.qty - ii.returned_qty - ii.delivered_qty, 0)), 0)
          from public.invoice_items ii where ii.invoice_id = i.id) as undelivered_qty
  from public.invoices i
  left join public.profiles u on u.id = i.created_by
  left join public.profiles sp on sp.id = i.salesperson_id;

drop view if exists public.v_purchases;
create view public.v_purchases with (security_invoker = on) as
select pu.*, s.name as supplier_name,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       case when pu.status = 'posted' then pu.total_sdg - pu.paid_sdg else 0 end as remaining_sdg
  from public.purchases pu
  left join public.suppliers s on s.id = pu.supplier_id
  left join public.profiles u on u.id = pu.created_by;

create or replace view public.v_customer_balances with (security_invoker = on) as
select c.*,
       coalesce((select sum(total_sdg - returned_sdg) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted'), 0) as total_sales,
       coalesce((select sum(total_sdg - returned_sdg - paid_sdg) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted'), 0) as balance,
       (select count(*) from public.invoices where customer_id = c.id and kind = 'final' and status = 'posted') as invoices_count
  from public.customers c;

create or replace view public.v_stock_movements with (security_invoker = on) as
select m.*, p.code, p.name as product_name,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       coalesce(i.number, pu.number, sr.number) as ref_number
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  left join public.profiles u on u.id = m.created_by
  left join public.invoices i on m.ref_type = 'invoice' and i.id = m.ref_id
  left join public.purchases pu on m.ref_type = 'purchase' and pu.id = m.ref_id
  left join public.sales_returns sr on m.ref_type = 'sales_return' and sr.id = m.ref_id;

create or replace view public.v_sales_returns with (security_invoker = on) as
select r.*, i.number as invoice_number, i.customer_name,
       coalesce(nullif(u.full_name, ''), u.username) as created_by_name,
       (select coalesce(sum(qty), 0) from public.sales_return_items where return_id = r.id) as total_qty
  from public.sales_returns r
  join public.invoices i on i.id = r.invoice_id
  left join public.profiles u on u.id = r.created_by;

-- ---------------------------------------------------------------------
-- الحماية والإشعارات للجداول الجديدة
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_returns', 'sales_return_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists sel on public.%I', t);
    execute format('drop policy if exists del on public.%I', t);
    execute format('create policy sel on public.%I for select to authenticated using (public.has_perm(''sales'', ''view''))', t);
    execute format('create policy del on public.%I for delete to authenticated using (public.is_admin())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  drop trigger if exists track_change on public.sales_returns;
  create trigger track_change after insert or update or delete on public.sales_returns
    for each row execute function public.track_change();
end $$;
revoke all on public.v_sales_returns from anon;
revoke all on public.v_products, public.v_invoices, public.v_purchases from anon;
revoke execute on function public.create_sales_return(uuid, jsonb, text), public.cancel_purchase(uuid, text) from anon;


-- =====================================================================
--  WALI CORE — 0006: نسخة احتياطية كاملة واسترجاعها (للأدمن بس)
--  التصدير من جوه الداتا بيز عشان Supabase بيرجّع 1000 صف بس في الطلب العادي
-- =====================================================================

create or replace function public.backup_tables() returns text[]
language sql immutable as $$
  -- بالترتيب اللي بيتضاف بيه (الأب قبل الابن)
  select array['categories','products','customers','suppliers','exchange_rates','doc_counters',
               'purchases','purchase_items','invoices','invoice_items','sales_returns','sales_return_items',
               'delivery_permits','delivery_items','payments','expense_categories','expenses',
               'employees','attendance','salary_advances','salary_deductions','payrolls',
               'shareholders','shareholder_terms','shareholder_payouts','stock_movements']
$$;

create or replace function public.export_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; v jsonb; out jsonb := '{}';
begin
  if not is_admin() then raise exception 'النسخ الاحتياطي للأدمن بس'; end if;
  foreach t in array array['settings', 'profiles'] || backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into v;
    out := out || jsonb_build_object(t, v);
  end loop;
  return jsonb_build_object('app', 'wali-core', 'version', 2, 'created_at', now(), 'tables', out);
end $$;

-- الاسترجاع بيمسح البيانات الحالية ويحط النسخة مكانها في عملية واحدة (لو حصل خطأ مفيش حاجة بتتغير)
-- المستخدمين وصلاحياتهم والإشعارات وسجل التدقيق مش بيتلمسوا
create or replace function public.restore_backup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t text; i int; cols text; n int; counts jsonb := '{}';
  tabs text[] := backup_tables();
  data jsonb := p -> 'tables';
begin
  if not is_admin() then raise exception 'الاسترجاع للأدمن بس'; end if;
  if p ->> 'app' is distinct from 'wali-core' or jsonb_typeof(data) <> 'object' then
    raise exception 'الملف ده مش نسخة احتياطية من WALI CORE';
  end if;

  -- من غير triggers ولا فحص روابط أثناء النقل (الكميات والأرصدة جاية جاهزة من النسخة)
  set local session_replication_role = replica;

  for i in reverse array_length(tabs, 1) .. 1 loop
    execute format('delete from public.%I', tabs[i]);
  end loop;

  foreach t in array tabs loop
    if jsonb_typeof(data -> t) = 'array' and jsonb_array_length(data -> t) > 0 then
      -- الأعمدة الموجودة في النسخة بس، والباقي ياخد القيمة الافتراضية (نسخ أقدم من التحديثات)
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t
         and (data -> t -> 0) ? c.column_name;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
                     t, cols, cols, t) using data -> t;
      get diagnostics n = row_count;
      counts := counts || jsonb_build_object(t, n);
    end if;
  end loop;

  -- نسخ قديمة (قبل 0007) كانت صورة الصنف جوه الصنف نفسه
  if to_regclass('public.product_images') is not null and not (data ? 'product_images')
     and jsonb_typeof(data -> 'products') = 'array' then
    execute 'insert into public.product_images (product_id, image)
             select (x ->> ''id'')::uuid, x ->> ''image'' from jsonb_array_elements($1) x
              where coalesce(x ->> ''image'', '''') <> '''' on conflict do nothing' using data -> 'products';
    execute 'update public.products set image_v = 1
              where image_v = 0 and id in (select product_id from public.product_images)';
  end if;

  if jsonb_typeof(data -> 'settings') = 'array' and jsonb_array_length(data -> 'settings') > 0 then
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'settings' and (data -> 'settings' -> 0) ? c.column_name;
    delete from settings;
    execute format('insert into public.settings (%s) select %s from jsonb_populate_recordset(null::public.settings, $1)', cols, cols)
      using data -> 'settings';
  end if;

  set local session_replication_role = origin;

  insert into audit_log (table_name, record_id, action, new_data, user_id, user_name)
  values ('backup', null, 'restore', jsonb_build_object('backup_date', p ->> 'created_at', 'counts', counts),
          auth.uid(), actor_name());
  insert into notifications (type, level, title, body, actor_id, actor_name)
  values ('backup.restore', 'danger', 'استرجاع نسخة احتياطية',
          'البيانات اتبدلت بنسخة ' || coalesce(to_char((p ->> 'created_at')::timestamptz at time zone 'Africa/Khartoum', 'YYYY-MM-DD HH24:MI'), ''),
          auth.uid(), coalesce(actor_name(), 'النظام'));
  return counts;
end $$;

revoke execute on function public.export_backup(), public.restore_backup(jsonb) from anon;


-- =====================================================================
--  WALI CORE — 0007: صور الأصناف في جدول لوحدها
--  قايمة الأصناف بتتحمّل تاني مع كل بيعة (المخزن بيتغير)، فلو الصور جواها
--  كانت هتتحمّل كلها كل مرة وتخلّص حد التحميل في خطة Supabase المجانية.
--  دلوقتي القايمة فيها رقم نسخة الصورة بس (image_v)، وكل جهاز بيحمّل الصورة
--  مرة واحدة ويحتفظ بيها لحد ما الرقم يتغير.
-- =====================================================================

create table if not exists public.product_images (
  product_id uuid primary key references public.products(id) on delete cascade,
  image      text not null,
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists image_v int not null default 0;

-- نقل الصور القديمة (من غير ما يطلع إشعار «تعديل صنف» لكل واحد)
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'products' and column_name = 'image') then
    set local session_replication_role = replica;
    execute 'insert into public.product_images (product_id, image)
             select id, image from public.products where image is not null
             on conflict (product_id) do nothing';
    execute 'update public.products set image_v = 1 where image is not null';
    set local session_replication_role = origin;
  end if;
end $$;

drop view if exists public.v_products;
alter table public.products drop column if exists image;

create view public.v_products as
select p.*,
       c.name as category_name,
       round(p.price_usd * coalesce(public.current_rate(), public.latest_rate(), 0), 2) as price_sdg,
       coalesce((select sum(m.qty) from public.stock_movements m
                  where m.product_id = p.id and m.kind in ('purchase_in', 'opening', 'adjust_in')), 0)
     + coalesce((select sum(m.qty) from public.stock_movements m
                  where m.product_id = p.id and m.kind = 'purchase_cancel'), 0) as total_in,
       coalesce((select sum(ii.qty - ii.returned_qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as sold_qty,
       coalesce((select sum(ii.delivered_qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'final' and i.status = 'posted'), 0) as withdrawn_qty,
       coalesce((select sum(ii.qty) from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
                  where ii.product_id = p.id and i.kind = 'proforma' and i.status = 'open'), 0) as reserved_qty
  from public.products p
  left join public.categories c on c.id = p.category_id;
revoke all on public.v_products from anon;

-- تغيير الصورة (أو شيلها لو p_image فاضي)
create or replace function public.set_product_image(p_id uuid, p_image text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not (has_perm('products', 'create') or has_perm('products', 'edit')) then
    raise exception 'ليس لديك صلاحية لهذه العملية (products / edit)';
  end if;
  if coalesce(p_image, '') = '' then
    delete from product_images where product_id = p_id;
  else
    if length(p_image) > 400000 then raise exception 'الصورة كبيرة، اختار صورة أصغر'; end if;
    insert into product_images (product_id, image) values (p_id, p_image)
    on conflict (product_id) do update set image = excluded.image, updated_at = now();
  end if;
  update products set image_v = image_v + 1 where id = p_id returning image_v into v;
  if v is null then raise exception 'الصنف مش موجود'; end if;
  return v;
end $$;

alter table public.product_images enable row level security;
drop policy if exists sel on public.product_images;
drop policy if exists del on public.product_images;
create policy sel on public.product_images for select to authenticated using (public.is_active_user());
create policy del on public.product_images for delete to authenticated using (public.is_admin());
revoke all on public.product_images from anon;

-- النسخة الاحتياطية بقت بتشمل الصور
create or replace function public.backup_tables() returns text[]
language sql immutable as $$
  select array['categories','products','product_images','customers','suppliers','exchange_rates','doc_counters',
               'purchases','purchase_items','invoices','invoice_items','sales_returns','sales_return_items',
               'delivery_permits','delivery_items','payments','expense_categories','expenses',
               'employees','attendance','salary_advances','salary_deductions','payrolls',
               'shareholders','shareholder_terms','shareholder_payouts','stock_movements']
$$;


-- 0008: رسائل النظام (الأخطاء والإشعارات) بالعربية الفصحى
-- نفس الدوال بالظبط، اللي اتغير هو النصوص اللي بتظهر للمستخدم بس
CREATE OR REPLACE FUNCTION public._write_invoice(p jsonb, p_allow_price boolean, p_source uuid DEFAULT NULL::uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind     text := coalesce(p ->> 'kind', 'proforma');
  v_id       uuid := nullif(p ->> 'id', '')::uuid;
  v_rate     numeric := current_rate();
  v_items    jsonb := p -> 'items';
  v_disc     numeric := coalesce(nullif(p ->> 'discount_sdg', '')::numeric, 0);
  v_paid     numeric := coalesce(nullif(p ->> 'paid_sdg', '')::numeric, 0);
  v_cust     uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_cname    text := nullif(trim(p ->> 'customer_name'), '');
  v_cphone   text := nullif(trim(p ->> 'customer_phone'), '');
  v_sub      numeric := 0;
  v_cost     numeric := 0;
  v_total    numeric;
  v_inv      invoices;
  it         jsonb;
  pr         products;
  r          record;
  v_usd      numeric;
  v_sdg      numeric;
  v_qty      numeric;
  i          int := 0;
  v_ptype    text;
begin
  if v_rate is null then
    raise exception 'يجب إدخال سعر الدولار لهذا اليوم أولًا';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'الفاتورة فارغة، أضف أصنافًا أولًا';
  end if;

  -- اقفل الأصناف عشان محدش يبيع نفس القطعة في نفس اللحظة
  perform 1 from products
   where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(v_items) e)
   for update;

  if v_kind = 'final' then
    for r in
      select p.id, p.name, p.qty_on_hand, sum((e ->> 'qty')::numeric) as need
        from jsonb_array_elements(v_items) e
        join products p on p.id = (e ->> 'product_id')::uuid
       group by p.id, p.name, p.qty_on_hand
    loop
      if r.need > r.qty_on_hand then
        raise exception 'الكمية المتاحة من "%" هي % فقط', r.name, r.qty_on_hand::numeric(14,0);
      end if;
    end loop;
  end if;

  -- احسب الإجماليات
  for it in select * from jsonb_array_elements(v_items) loop
    select * into pr from products where id = (it ->> 'product_id')::uuid;
    if not found then raise exception 'صنف غير موجود في المخزن'; end if;
    v_qty := nullif(it ->> 'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'كمية غير صحيحة للصنف "%"', pr.name; end if;
    v_usd := case when p_allow_price and nullif(it ->> 'unit_price_usd', '') is not null
                  then (it ->> 'unit_price_usd')::numeric else pr.price_usd end;
    v_sdg := case when p_allow_price and nullif(it ->> 'unit_price_sdg', '') is not null
                  then (it ->> 'unit_price_sdg')::numeric else round(v_usd * v_rate, 2) end;
    v_sub := v_sub + round(v_sdg * v_qty, 2);
    v_cost := v_cost + round(pr.cost_usd * v_rate * v_qty, 2);
  end loop;

  v_total := v_sub - v_disc;
  if v_disc < 0 or v_total < 0 then raise exception 'الخصم أكبر من قيمة الفاتورة'; end if;

  if v_kind = 'final' then
    if v_paid > v_total then v_paid := v_total; end if;
    v_ptype := case when v_paid >= v_total then 'cash' when v_paid = 0 then 'credit' else 'partial' end;
  else
    v_paid := 0; v_ptype := coalesce(p ->> 'payment_type', 'cash');
  end if;

  -- عميل جديد يتسجل لوحده لو كتبت اسمه
  if v_cust is null and v_cname is not null then
    select id into v_cust from customers
     where name = v_cname and coalesce(phone, '') = coalesce(v_cphone, '') limit 1;
    if v_cust is null then
      insert into customers (name, phone, created_by) values (v_cname, v_cphone, auth.uid())
      returning id into v_cust;
    end if;
  end if;
  if v_cust is not null and v_cname is null then
    select name, phone into v_cname, v_cphone from customers where id = v_cust;
  end if;
  if v_kind = 'final' and v_ptype <> 'cash' and v_cust is null then
    raise exception 'البيع الآجل يتطلب اسم العميل';
  end if;

  if v_id is not null then
    -- تعديل فاتورة مبدئية مفتوحة
    select * into v_inv from invoices where id = v_id for update;
    if not found or v_inv.kind <> 'proforma' or v_inv.status <> 'open' then
      raise exception 'لا يمكن تعديل هذه الفاتورة';
    end if;
    delete from invoice_items where invoice_id = v_id;
    update invoices set customer_id = v_cust, customer_name = v_cname, customer_phone = v_cphone,
           rate = v_rate, subtotal_sdg = v_sub, discount_sdg = v_disc, total_sdg = v_total,
           cost_sdg = v_cost, payment_type = v_ptype, notes = p ->> 'notes', invoice_date = local_today()
     where id = v_id returning * into v_inv;
  else
    insert into invoices (number, kind, status, customer_id, customer_name, customer_phone, rate,
                          subtotal_sdg, discount_sdg, total_sdg, cost_sdg, payment_type, notes,
                          source_proforma_id, salesperson_id, created_by, posted_at)
    values (next_doc_number(v_kind), v_kind, case when v_kind = 'final' then 'posted' else 'open' end,
            v_cust, v_cname, v_cphone, v_rate, v_sub, v_disc, v_total, v_cost, v_ptype, p ->> 'notes',
            p_source,
            coalesce((select salesperson_id from invoices where id = p_source), auth.uid()),
            auth.uid(), case when v_kind = 'final' then now() end)
    returning * into v_inv;
  end if;

  for it in select * from jsonb_array_elements(v_items) loop
    i := i + 1;
    select * into pr from products where id = (it ->> 'product_id')::uuid;
    v_qty := (it ->> 'qty')::numeric;
    v_usd := case when p_allow_price and nullif(it ->> 'unit_price_usd', '') is not null
                  then (it ->> 'unit_price_usd')::numeric else pr.price_usd end;
    v_sdg := case when p_allow_price and nullif(it ->> 'unit_price_sdg', '') is not null
                  then (it ->> 'unit_price_sdg')::numeric else round(v_usd * v_rate, 2) end;
    insert into invoice_items (invoice_id, product_id, code, name, model, qty, unit_price_usd,
                               unit_price_sdg, total_sdg, unit_cost_usd, sort)
    values (v_inv.id, pr.id, pr.code, pr.name, pr.model, v_qty, v_usd, v_sdg,
            round(v_sdg * v_qty, 2), pr.cost_usd, i);
    if v_kind = 'final' then
      insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, created_by)
      values (pr.id, 'sale_out', -v_qty, pr.cost_usd, 'invoice', v_inv.id, auth.uid());
    end if;
  end loop;

  if v_kind = 'final' and v_paid > 0 then
    insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, method, notes, created_by)
    values ('in', 'customer', v_cust, v_inv.id, v_paid, coalesce(p ->> 'method', 'cash'),
            'دفعة من فاتورة ' || v_inv.number, auth.uid());
  end if;

  select * into v_inv from invoices where id = v_inv.id;
  return v_inv;
end $function$;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_product uuid, p_new_qty numeric, p_note text DEFAULT NULL::text, p_opening boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cur numeric; v_diff numeric; v_cost numeric;
begin
  perform ensure_perm('stock', 'edit');
  if p_new_qty is null or p_new_qty < 0 then raise exception 'يجب أن تكون الكمية صفرًا أو أكثر'; end if;
  select qty_on_hand, cost_usd into v_cur, v_cost from products where id = p_product for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  v_diff := p_new_qty - v_cur;
  if v_diff = 0 then return v_cur; end if;
  insert into stock_movements (product_id, kind, qty, unit_cost_usd, note, created_by)
  values (p_product,
          case when p_opening then 'opening' when v_diff > 0 then 'adjust_in' else 'adjust_out' end,
          v_diff, v_cost, coalesce(p_note, 'تسوية جرد'), auth.uid());
  return p_new_qty;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_delivery(p_permit uuid)
 RETURNS delivery_permits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dp delivery_permits;
begin
  perform ensure_perm('delivery', 'cancel');
  update delivery_permits set status = 'cancelled' where id = p_permit and status = 'pending'
  returning * into v_dp;
  if v_dp.id is null then raise exception 'لا يمكن إلغاء هذا الإذن'; end if;
  return v_dp;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_id uuid, p_reason text)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv invoices; it record;
begin
  perform ensure_perm('sales', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'أدخل سبب الإلغاء'; end if;
  select * into v_inv from invoices where id = p_id for update;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if v_inv.status in ('cancelled', 'converted') then raise exception 'لا يمكن إلغاء هذه الفاتورة'; end if;
  if v_inv.returned_sdg > 0 then raise exception 'هذه الفاتورة عليها مرتجع، سجّل مرتجعًا بالمتبقي بدلًا من الإلغاء'; end if;

  if v_inv.kind = 'final' then
    for it in select * from invoice_items where invoice_id = p_id loop
      insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
      values (it.product_id, 'cancel_in', it.qty, it.unit_cost_usd, 'invoice', p_id, 'إلغاء ' || v_inv.number, auth.uid());
    end loop;
    update delivery_permits set status = 'cancelled' where invoice_id = p_id and status = 'pending';
    if v_inv.paid_sdg > 0 then
      insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, notes, created_by)
      values ('out', 'customer', v_inv.customer_id, p_id, v_inv.paid_sdg, 'رد مبلغ إلغاء ' || v_inv.number, auth.uid());
    end if;
  end if;

  update invoices set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
   where id = p_id returning * into v_inv;
  return v_inv;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_purchase(p_id uuid, p_reason text)
 RETURNS purchases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pur purchases; it record; pr products; v_rest numeric; v_cost numeric;
begin
  perform ensure_perm('purchases', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'أدخل سبب الإلغاء'; end if;
  select * into v_pur from purchases where id = p_id for update;
  if not found or v_pur.status <> 'posted' then raise exception 'لا يمكن إلغاء هذه الفاتورة'; end if;

  for it in select * from purchase_items where purchase_id = p_id loop
    select * into pr from products where id = it.product_id for update;
    if pr.qty_on_hand < it.qty then
      raise exception 'لا يمكن الإلغاء: بيع جزء من "%"، والمتوفر % فقط من %', pr.name,
        pr.qty_on_hand::numeric(14,0), it.qty::numeric(14,0);
    end if;
    v_rest := pr.qty_on_hand - it.qty;
    v_cost := case when v_rest > 0 then round((pr.qty_on_hand * pr.cost_usd - it.qty * it.landed_usd) / v_rest, 4) end;
    if v_cost is not null and v_cost > 0 then
      update products set cost_usd = v_cost where id = pr.id;
    end if;
    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
    values (pr.id, 'purchase_cancel', -it.qty, it.landed_usd, 'purchase', p_id, 'إلغاء ' || v_pur.number, auth.uid());
  end loop;

  if v_pur.paid_sdg > 0 then
    insert into payments (direction, party_type, supplier_id, purchase_id, amount_sdg, notes, created_by)
    values ('in', 'supplier', v_pur.supplier_id, p_id, v_pur.paid_sdg, 'استرداد من المورد — إلغاء ' || v_pur.number, auth.uid());
  end if;

  update purchases set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_at = now()
   where id = p_id returning * into v_pur;
  return v_pur;
end $function$;

CREATE OR REPLACE FUNCTION public.check_in()
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp employees; v_set settings; v_late int; v_now time; a attendance;
begin
  select * into v_emp from employees where user_id = auth.uid() and is_active;
  if not found then raise exception 'حسابك غير مرتبط بموظف، تواصل مع مدير النظام'; end if;
  select * into v_set from settings where id = 1;
  v_now := (now() at time zone 'Africa/Khartoum')::time;
  v_late := greatest(0, (extract(epoch from (v_now - v_set.work_start)) / 60)::int);
  if v_late <= v_set.late_grace_minutes then v_late := 0; end if;
  insert into attendance (employee_id, work_date, check_in, late_minutes)
  values (v_emp.id, local_today(), now(), v_late)
  on conflict (employee_id, work_date) do nothing
  returning * into a;
  if a.id is null then raise exception 'سجّلت حضورك اليوم من قبل'; end if;
  return a;
end $function$;

CREATE OR REPLACE FUNCTION public.check_out()
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a attendance;
begin
  update attendance set check_out = now()
   where employee_id = (select id from employees where user_id = auth.uid())
     and work_date = local_today() and check_in is not null and check_out is null
  returning * into a;
  if a.id is null then raise exception 'لا يوجد حضور مسجَّل اليوم لتسجيل الانصراف'; end if;
  return a;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_delivery(p_permit uuid)
 RETURNS delivery_permits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dp delivery_permits; it record;
begin
  perform ensure_perm('delivery', 'approve');
  select * into v_dp from delivery_permits where id = p_permit for update;
  if not found or v_dp.status <> 'pending' then raise exception 'هذا الإذن ليس بانتظار التسليم'; end if;
  for it in select * from delivery_items where permit_id = p_permit loop
    update invoice_items set delivered_qty = delivered_qty + it.qty where id = it.invoice_item_id;
  end loop;
  update delivery_permits set status = 'delivered', delivered_by = auth.uid(), delivered_at = now()
   where id = p_permit returning * into v_dp;
  return v_dp;
end $function$;

CREATE OR REPLACE FUNCTION public.convert_proforma(p_id uuid, p_paid numeric DEFAULT 0, p_method text DEFAULT 'cash'::text, p_keep_sdg boolean DEFAULT false)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pf invoices; v_items jsonb; v_final invoices;
begin
  perform ensure_perm('sales', 'create');
  select * into v_pf from invoices where id = p_id for update;
  if not found or v_pf.kind <> 'proforma' then raise exception 'الفاتورة المبدئية غير موجودة'; end if;
  if v_pf.status <> 'open' then raise exception 'هذه الفاتورة حُوِّلت أو أُلغيت من قبل'; end if;
  if p_keep_sdg and not has_perm('sales', 'approve') then
    raise exception 'تثبيت أسعار الفاتورة المبدئية يتطلب صلاحية اعتماد';
  end if;

  select jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'qty', qty, 'unit_price_usd', unit_price_usd,
           'unit_price_sdg', case when p_keep_sdg then unit_price_sdg end) order by sort)
    into v_items from invoice_items where invoice_id = p_id;

  v_final := _write_invoice(jsonb_build_object(
      'kind', 'final', 'customer_id', v_pf.customer_id, 'customer_name', v_pf.customer_name,
      'customer_phone', v_pf.customer_phone, 'discount_sdg', v_pf.discount_sdg,
      'paid_sdg', coalesce(p_paid, 0), 'method', p_method, 'notes', v_pf.notes, 'items', v_items),
    true, p_id);

  update invoices set status = 'converted', converted_invoice_id = v_final.id where id = p_id;
  return v_final;
end $function$;

CREATE OR REPLACE FUNCTION public.create_delivery_permit(p_invoice uuid, p_receiver text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb)
 RETURNS delivery_permits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inv invoices; v_dp delivery_permits; it record; v_qty numeric; v_any boolean := false;
begin
  perform ensure_perm('delivery', 'create');
  select * into v_inv from invoices where id = p_invoice;
  if not found or v_inv.kind <> 'final' or v_inv.status <> 'posted' then
    raise exception 'يصدر إذن التسليم للفواتير النهائية فقط';
  end if;

  insert into delivery_permits (number, invoice_id, receiver_name, notes, created_by)
  values (next_doc_number('delivery'), p_invoice, coalesce(p_receiver, v_inv.customer_name), p_notes, auth.uid())
  returning * into v_dp;

  for it in
    select ii.*, ii.qty - ii.returned_qty - ii.delivered_qty - coalesce((
             select sum(di.qty) from delivery_items di join delivery_permits dp on dp.id = di.permit_id
              where di.invoice_item_id = ii.id and dp.status = 'pending' and dp.id <> v_dp.id), 0) as remaining
      from invoice_items ii where ii.invoice_id = p_invoice order by ii.sort
  loop
    v_qty := case when p_items is null then it.remaining
                  else least(it.remaining, coalesce((
                    select (e ->> 'qty')::numeric from jsonb_array_elements(p_items) e
                     where (e ->> 'invoice_item_id')::uuid = it.id limit 1), 0)) end;
    if v_qty > 0 then
      insert into delivery_items (permit_id, invoice_item_id, product_id, qty)
      values (v_dp.id, it.id, it.product_id, v_qty);
      v_any := true;
    end if;
  end loop;

  if not v_any then raise exception 'جميع أصناف هذه الفاتورة سُلِّمت أو صدر لها إذن تسليم'; end if;
  return v_dp;
end $function$;

CREATE OR REPLACE FUNCTION public.create_sales_return(p_invoice uuid, p_items jsonb, p_reason text)
 RETURNS sales_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv   invoices;
  v_ret   sales_returns;
  it      jsonb;
  ii      invoice_items;
  v_qty   numeric;
  v_avail numeric;
  v_line  numeric;
  v_net   numeric;
  v_cost  numeric;
  v_total numeric := 0;
  v_tcost numeric := 0;
  v_over  numeric;
begin
  perform ensure_perm('sales', 'cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'أدخل سبب المرتجع'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'اختر الأصناف المرتجعة';
  end if;
  select * into v_inv from invoices where id = p_invoice for update;
  if not found or v_inv.kind <> 'final' or v_inv.status <> 'posted' then
    raise exception 'يُسجَّل المرتجع من فاتورة نهائية فقط';
  end if;

  insert into sales_returns (number, invoice_id, customer_id, total_sdg, cost_sdg, reason, salesperson_id, created_by)
  values (next_doc_number('return'), p_invoice, v_inv.customer_id, 0, 0, trim(p_reason), v_inv.salesperson_id, auth.uid())
  returning * into v_ret;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::numeric, 0);
    if v_qty = 0 then continue; end if;
    select * into ii from invoice_items where id = (it ->> 'invoice_item_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'هذا الصنف غير موجود في الفاتورة'; end if;
    -- اللي عليه إذن تسليم لسه منتظر مينفعش يرجع قبل ما الإذن يتلغي أو يتسلم
    v_avail := ii.qty - ii.returned_qty - coalesce((
                 select sum(di.qty) from delivery_items di join delivery_permits dp on dp.id = di.permit_id
                  where di.invoice_item_id = ii.id and dp.status = 'pending'), 0);
    if v_qty < 0 or v_qty > v_avail then
      raise exception 'الكمية المتاحة للإرجاع من "%" هي % فقط', ii.name, greatest(v_avail, 0)::numeric(14,0);
    end if;

    v_line := round(ii.unit_price_sdg * v_qty, 2);
    v_net := v_line - case when v_inv.subtotal_sdg > 0
                           then round(v_inv.discount_sdg * v_line / v_inv.subtotal_sdg, 2) else 0 end;
    v_cost := round(ii.unit_cost_usd * v_inv.rate * v_qty, 2);
    v_total := v_total + v_net;
    v_tcost := v_tcost + v_cost;

    insert into sales_return_items (return_id, invoice_item_id, product_id, code, name, qty, unit_price_sdg, total_sdg, unit_cost_usd)
    values (v_ret.id, ii.id, ii.product_id, ii.code, ii.name, v_qty, ii.unit_price_sdg, v_net, ii.unit_cost_usd);
    update invoice_items set returned_qty = returned_qty + v_qty where id = ii.id;
    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, note, created_by)
    values (ii.product_id, 'return_in', v_qty, ii.unit_cost_usd, 'sales_return', v_ret.id,
            'مرتجع من ' || v_inv.number, auth.uid());
  end loop;

  if v_total = 0 and v_tcost = 0 then raise exception 'أدخل كمية المرتجع'; end if;

  update invoices set returned_sdg = returned_sdg + v_total, returned_cost_sdg = returned_cost_sdg + v_tcost
   where id = p_invoice returning * into v_inv;

  v_over := v_inv.paid_sdg - (v_inv.total_sdg - v_inv.returned_sdg);
  if v_over > 0 then
    insert into payments (direction, party_type, customer_id, invoice_id, amount_sdg, notes, created_by)
    values ('out', 'customer', v_inv.customer_id, p_invoice, v_over, 'رد مبلغ مرتجع ' || v_ret.number, auth.uid());
  end if;

  update sales_returns set total_sdg = v_total, cost_sdg = v_tcost, refund_sdg = greatest(v_over, 0)
   where id = v_ret.id returning * into v_ret;
  return v_ret;
end $function$;

CREATE OR REPLACE FUNCTION public.export_backup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t text; v jsonb; out jsonb := '{}';
begin
  if not is_admin() then raise exception 'النسخ الاحتياطي متاح لمدير النظام فقط'; end if;
  foreach t in array array['settings', 'profiles'] || backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into v;
    out := out || jsonb_build_object(t, v);
  end loop;
  return jsonb_build_object('app', 'wali-core', 'version', 2, 'created_at', now(), 'tables', out);
end $function$;

CREATE OR REPLACE FUNCTION public.guard_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_perm('users', 'edit') then
    new.role := old.role;
    new.permissions := old.permissions;
    new.is_active := old.is_active;
    new.username := old.username;
  end if;
  -- آخر Admin ميتشالش
  if old.role = 'admin' and (new.role <> 'admin' or not new.is_active)
     and (select count(*) from profiles where role = 'admin' and is_active and id <> old.id) = 0 then
    raise exception 'يجب أن يبقى مدير نظام واحد على الأقل';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.pay_payroll(p_id uuid)
 RETURNS payrolls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v payrolls; d2 date; v_cat uuid; v_name text;
begin
  perform ensure_perm('payroll', 'approve');
  select * into v from payrolls where id = p_id for update;
  if not found or v.status <> 'draft' then raise exception 'صُرف هذا المرتب من قبل'; end if;
  d2 := (month_start(v.period) + interval '1 month')::date;
  update salary_advances set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and advance_date < d2;
  update salary_deductions set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and deduction_date < d2;
  update payrolls set status = 'paid', paid_at = now() where id = p_id returning * into v;

  select id into v_cat from expense_categories where name = 'رواتب';
  select full_name into v_name from employees where id = v.employee_id;
  -- المصروف الحقيقي = المرتب + العمولة − الخصومات (السلفة اتصرفت قبل كده)
  if v.base_salary + v.commission - v.deductions - v.late_deduction > 0 then
    insert into expenses (category_id, amount_sdg, description, ref_type, ref_id, created_by)
    values (v_cat, v.base_salary + v.commission - v.deductions - v.late_deduction,
            'مرتب ' || v_name || ' — ' || v.period, 'payroll', v.id, auth.uid());
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.pay_shareholder_payout(p_id uuid)
 RETURNS shareholder_payouts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v shareholder_payouts;
begin
  perform ensure_perm('shareholders', 'approve');
  update shareholder_payouts set status = 'paid', paid_at = now()
   where id = p_id and status = 'draft' returning * into v;
  if v.id is null then raise exception 'صُرف هذا المبلغ من قبل'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.record_payment(p jsonb)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v payments; v_amt numeric := nullif(p ->> 'amount_sdg', '')::numeric;
        v_inv invoices; v_pur purchases;
begin
  perform ensure_perm('accounting', 'create');
  if v_amt is null or v_amt <= 0 then raise exception 'يجب أن يكون المبلغ أكبر من صفر'; end if;
  if nullif(p ->> 'invoice_id', '') is not null then
    select * into v_inv from invoices where id = (p ->> 'invoice_id')::uuid;
    if v_inv.status <> 'posted' then raise exception 'الفاتورة ليست نهائية'; end if;
    if v_amt > v_inv.total_sdg - v_inv.returned_sdg - v_inv.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي على الفاتورة (%)', fmt(v_inv.total_sdg - v_inv.returned_sdg - v_inv.paid_sdg);
    end if;
  end if;
  if nullif(p ->> 'purchase_id', '') is not null then
    select * into v_pur from purchases where id = (p ->> 'purchase_id')::uuid;
    if v_pur.status <> 'posted' then raise exception 'فاتورة المشتريات هذه ملغاة'; end if;
    if v_amt > v_pur.total_sdg - v_pur.paid_sdg + 0.01 then
      raise exception 'المبلغ أكبر من المتبقي للمورد (%)', fmt(v_pur.total_sdg - v_pur.paid_sdg);
    end if;
  end if;
  insert into payments (direction, party_type, customer_id, supplier_id, invoice_id, purchase_id,
                        amount_sdg, method, pay_date, notes, created_by)
  values (p ->> 'direction', p ->> 'party_type',
          coalesce(nullif(p ->> 'customer_id', '')::uuid, v_inv.customer_id),
          coalesce(nullif(p ->> 'supplier_id', '')::uuid, v_pur.supplier_id),
          v_inv.id, v_pur.id, v_amt, coalesce(nullif(p ->> 'method', ''), 'cash'),
          coalesce(nullif(p ->> 'pay_date', '')::date, local_today()), p ->> 'notes', auth.uid())
  returning * into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.restore_backup(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t text; i int; cols text; n int; counts jsonb := '{}';
  tabs text[] := backup_tables();
  data jsonb := p -> 'tables';
begin
  if not is_admin() then raise exception 'الاسترجاع متاح لمدير النظام فقط'; end if;
  if p ->> 'app' is distinct from 'wali-core' or jsonb_typeof(data) <> 'object' then
    raise exception 'هذا الملف ليس نسخة احتياطية من WALI CORE';
  end if;

  -- من غير triggers ولا فحص روابط أثناء النقل (الكميات والأرصدة جاية جاهزة من النسخة)
  set local session_replication_role = replica;

  for i in reverse array_length(tabs, 1) .. 1 loop
    execute format('delete from public.%I', tabs[i]);
  end loop;

  foreach t in array tabs loop
    if jsonb_typeof(data -> t) = 'array' and jsonb_array_length(data -> t) > 0 then
      -- الأعمدة الموجودة في النسخة بس، والباقي ياخد القيمة الافتراضية (نسخ أقدم من التحديثات)
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t
         and (data -> t -> 0) ? c.column_name;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)',
                     t, cols, cols, t) using data -> t;
      get diagnostics n = row_count;
      counts := counts || jsonb_build_object(t, n);
    end if;
  end loop;

  -- نسخ قديمة (قبل 0007) كانت صورة الصنف جوه الصنف نفسه
  if to_regclass('public.product_images') is not null and not (data ? 'product_images')
     and jsonb_typeof(data -> 'products') = 'array' then
    execute 'insert into public.product_images (product_id, image)
             select (x ->> ''id'')::uuid, x ->> ''image'' from jsonb_array_elements($1) x
              where coalesce(x ->> ''image'', '''') <> '''' on conflict do nothing' using data -> 'products';
    execute 'update public.products set image_v = 1
              where image_v = 0 and id in (select product_id from public.product_images)';
  end if;

  if jsonb_typeof(data -> 'settings') = 'array' and jsonb_array_length(data -> 'settings') > 0 then
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'settings' and (data -> 'settings' -> 0) ? c.column_name;
    delete from settings;
    execute format('insert into public.settings (%s) select %s from jsonb_populate_recordset(null::public.settings, $1)', cols, cols)
      using data -> 'settings';
  end if;

  set local session_replication_role = origin;

  insert into audit_log (table_name, record_id, action, new_data, user_id, user_name)
  values ('backup', null, 'restore', jsonb_build_object('backup_date', p ->> 'created_at', 'counts', counts),
          auth.uid(), actor_name());
  insert into notifications (type, level, title, body, actor_id, actor_name)
  values ('backup.restore', 'danger', 'استرجاع نسخة احتياطية',
          'استُبدلت البيانات بنسخة ' || coalesce(to_char((p ->> 'created_at')::timestamptz at time zone 'Africa/Khartoum', 'YYYY-MM-DD HH24:MI'), ''),
          auth.uid(), coalesce(actor_name(), 'النظام'));
  return counts;
end $function$;

CREATE OR REPLACE FUNCTION public.save_purchase(p jsonb)
 RETURNS purchases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rate   numeric := coalesce(nullif(p ->> 'rate', '')::numeric, current_rate());
  v_ship   numeric := coalesce(nullif(p ->> 'shipping_sdg', '')::numeric, 0);
  v_cust   numeric := coalesce(nullif(p ->> 'customs_sdg', '')::numeric, 0);
  v_other  numeric := coalesce(nullif(p ->> 'other_sdg', '')::numeric, 0);
  v_paid   numeric := coalesce(nullif(p ->> 'paid_sdg', '')::numeric, 0);
  v_goods  numeric := 0;
  v_factor numeric;
  v_pur    purchases;
  it       jsonb;
  pr       products;
  v_qty    numeric;
  v_price  numeric;
  v_landed numeric;
  v_oldq   numeric;
begin
  perform ensure_perm('purchases', 'create');
  if v_rate is null or v_rate <= 0 then raise exception 'يجب إدخال سعر الدولار أولًا'; end if;
  if p -> 'items' is null or jsonb_array_length(p -> 'items') = 0 then raise exception 'الفاتورة فارغة'; end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := nullif(it ->> 'qty', '')::numeric;
    v_price := nullif(it ->> 'unit_price_usd', '')::numeric;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then
      raise exception 'راجع الكميات والأسعار';
    end if;
    v_goods := v_goods + v_qty * v_price;
  end loop;

  -- نسبة المصاريف الإضافية لقيمة البضاعة
  v_factor := case when v_goods > 0 then ((v_ship + v_cust + v_other) / v_rate) / v_goods else 0 end;

  insert into purchases (number, supplier_id, purchase_date, rate, goods_usd, shipping_sdg, customs_sdg,
                         other_sdg, total_sdg, notes, created_by)
  values (next_doc_number('purchase'), nullif(p ->> 'supplier_id', '')::uuid,
          coalesce(nullif(p ->> 'purchase_date', '')::date, local_today()), v_rate, v_goods,
          v_ship, v_cust, v_other, round(v_goods * v_rate + v_ship + v_cust + v_other, 2),
          p ->> 'notes', auth.uid())
  returning * into v_pur;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into pr from products where id = (it ->> 'product_id')::uuid for update;
    if not found then raise exception 'صنف غير موجود'; end if;
    v_qty := (it ->> 'qty')::numeric;
    v_price := (it ->> 'unit_price_usd')::numeric;
    v_landed := round(v_price * (1 + v_factor), 4);
    insert into purchase_items (purchase_id, product_id, qty, unit_price_usd, landed_usd)
    values (v_pur.id, pr.id, v_qty, v_price, v_landed);

    -- متوسط التكلفة المرجّح
    v_oldq := greatest(pr.qty_on_hand, 0);
    update products
       set cost_usd = round((v_oldq * cost_usd + v_qty * v_landed) / nullif(v_oldq + v_qty, 0), 4)
     where id = pr.id;

    insert into stock_movements (product_id, kind, qty, unit_cost_usd, ref_type, ref_id, created_by)
    values (pr.id, 'purchase_in', v_qty, v_landed, 'purchase', v_pur.id, auth.uid());
  end loop;

  if v_paid > 0 then
    insert into payments (direction, party_type, supplier_id, purchase_id, amount_sdg, method, notes, created_by)
    values ('out', 'supplier', v_pur.supplier_id, v_pur.id, least(v_paid, v_pur.total_sdg),
            coalesce(p ->> 'method', 'cash'), 'دفعة من مشتريات ' || v_pur.number, auth.uid());
  end if;

  select * into v_pur from purchases where id = v_pur.id;
  return v_pur;
end $function$;

CREATE OR REPLACE FUNCTION public.set_exchange_rate(p_rate numeric, p_note text DEFAULT NULL::text)
 RETURNS exchange_rates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r exchange_rates;
begin
  perform ensure_perm('rates', 'create');
  if p_rate is null or p_rate <= 0 then raise exception 'يجب أن يكون سعر الدولار رقمًا أكبر من صفر'; end if;
  insert into exchange_rates (rate, rate_date, note, created_by)
  values (p_rate, local_today(), p_note, auth.uid()) returning * into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.set_product_image(p_id uuid, p_image text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v int;
begin
  if not (has_perm('products', 'create') or has_perm('products', 'edit')) then
    raise exception 'ليس لديك صلاحية لهذه العملية (products / edit)';
  end if;
  if coalesce(p_image, '') = '' then
    delete from product_images where product_id = p_id;
  else
    if length(p_image) > 400000 then raise exception 'حجم الصورة كبير، اختر صورة أصغر'; end if;
    insert into product_images (product_id, image) values (p_id, p_image)
    on conflict (product_id) do update set image = excluded.image, updated_at = now();
  end if;
  update products set image_v = image_v + 1 where id = p_id returning image_v into v;
  if v is null then raise exception 'الصنف غير موجود'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.track_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_name  text := coalesce(public.actor_name(), 'النظام');
  n       jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'image' - 'logo' end;
  o       jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'image' - 'logo' end;
  r       jsonb := coalesce(n, o);
  v_title text;
  v_body  text;
  v_level text := 'info';
  v_tmp   text;
begin
  insert into audit_log (table_name, record_id, action, old_data, new_data, user_id, user_name)
  values (tg_table_name, r ->> 'id', lower(tg_op), o, n, v_uid, v_name);

  case tg_table_name
  when 'invoices' then
    if tg_op = 'INSERT' then
      if n ->> 'kind' = 'proforma' then
        v_title := 'فاتورة مبدئية جديدة ' || (n ->> 'number'); v_level := 'warning';
      else
        v_title := 'فاتورة بيع ' || (n ->> 'number'); v_level := 'success';
      end if;
      v_body := coalesce(n ->> 'customer_name', 'عميل نقدي') || ' — ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif tg_op = 'UPDATE' and (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := case n ->> 'status'
                   when 'converted' then 'تحويل المبدئية ' || (n ->> 'number') || ' لفاتورة نهائية'
                   when 'cancelled' then 'إلغاء فاتورة ' || (n ->> 'number')
                   else 'تحديث فاتورة ' || (n ->> 'number') end;
      v_level := case when n ->> 'status' = 'cancelled' then 'danger' else 'info' end;
      v_body := coalesce('السبب: ' || (n ->> 'cancel_reason'), n ->> 'customer_name');
    elsif tg_op = 'UPDATE' and n ->> 'kind' = 'proforma' and (n ->> 'total_sdg') is distinct from (o ->> 'total_sdg') then
      v_title := 'تعديل فاتورة مبدئية ' || (n ->> 'number');
      v_body := fmt((o ->> 'total_sdg')::numeric) || ' ← ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif tg_op = 'UPDATE' and (n ->> 'discount_sdg') is distinct from (o ->> 'discount_sdg') then
      v_title := 'تغيير خصم فاتورة ' || (n ->> 'number'); v_level := 'warning';
    else
      return null;
    end if;

  when 'purchases' then
    if tg_op = 'INSERT' then
      select name into v_tmp from suppliers where id = (n ->> 'supplier_id')::uuid;
      v_title := 'فاتورة مشتريات ' || (n ->> 'number');
      v_body := coalesce(v_tmp, 'بدون مورد') || ' — ' || fmt((n ->> 'total_sdg')::numeric) || ' ج.س';
    elsif (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := 'إلغاء مشتريات ' || (n ->> 'number'); v_level := 'danger';
      v_body := 'السبب: ' || coalesce(n ->> 'cancel_reason', '—');
    else return null; end if;

  -- المرتجع بيتسجل بصفر الأول وبعدين بيتحدّث بقيمته، فالإشعار مع التحديث
  when 'sales_returns' then
    if tg_op = 'UPDATE' and coalesce((o ->> 'total_sdg')::numeric, 0) = 0 and (n ->> 'total_sdg')::numeric > 0 then
      select number into v_tmp from invoices where id = (n ->> 'invoice_id')::uuid;
      v_title := 'مرتجع ' || (n ->> 'number') || ' من فاتورة ' || coalesce(v_tmp, '');
      v_body := fmt((n ->> 'total_sdg')::numeric) || ' ج.س'
             || case when (n ->> 'refund_sdg')::numeric > 0 then ' — رُدَّ للعميل ' || fmt((n ->> 'refund_sdg')::numeric) else '' end
             || ' — السبب: ' || (n ->> 'reason');
      v_level := 'warning';
    else return null; end if;

  when 'products' then
    if tg_op = 'INSERT' then
      v_title := 'صنف جديد: ' || (n ->> 'name'); v_body := 'كود ' || (n ->> 'code');
    elsif tg_op = 'DELETE' then
      v_title := 'حذف صنف: ' || (o ->> 'name'); v_level := 'danger';
    elsif (n ->> 'qty_on_hand')::numeric <= (n ->> 'min_qty')::numeric
          and (o ->> 'qty_on_hand')::numeric > (o ->> 'min_qty')::numeric then
      v_title := 'انخفاض المخزون: ' || (n ->> 'name'); v_level := 'warning';
      v_body := 'المتبقي ' || ((n ->> 'qty_on_hand')::numeric)::int || ' — كود ' || (n ->> 'code');
    elsif (n ->> 'price_usd') is distinct from (o ->> 'price_usd')
       or (n ->> 'margin_pct') is distinct from (o ->> 'margin_pct') then
      v_title := 'تغيير سعر: ' || (n ->> 'name');
      v_body := pct(o ->> 'price_usd') || '$ ← ' || pct(n ->> 'price_usd') || '$';
    elsif (n - 'qty_on_hand' - 'updated_at' - 'cost_usd' - 'image_v') is distinct from (o - 'qty_on_hand' - 'updated_at' - 'cost_usd' - 'image_v') then
      v_title := 'تعديل صنف: ' || (n ->> 'name');
    else return null; end if;

  when 'stock_movements' then
    if n ->> 'kind' in ('adjust_in', 'adjust_out', 'opening') then
      select name into v_tmp from products where id = (n ->> 'product_id')::uuid;
      v_title := case n ->> 'kind' when 'opening' then 'رصيد افتتاحي: ' else 'تسوية مخزون: ' end || coalesce(v_tmp, '');
      v_body := (case when (n ->> 'qty')::numeric > 0 then '+' else '' end) || ((n ->> 'qty')::numeric)::int
                || ' — ' || coalesce(n ->> 'note', '');
      v_level := case when n ->> 'kind' = 'adjust_out' then 'warning' else 'info' end;
    else return null; end if;

  when 'exchange_rates' then
    if tg_op <> 'INSERT' then return null; end if;
    v_title := 'سعر الدولار: ' || fmt((n ->> 'rate')::numeric) || ' ج.س';
    v_body := 'سعر صرف يوم ' || (n ->> 'rate_date');

  when 'payments' then
    if tg_op <> 'INSERT' then return null; end if;
    v_title := case when n ->> 'direction' = 'in' then 'تحصيل ' else 'دفع ' end || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_body := n ->> 'notes';
    v_level := case when n ->> 'direction' = 'in' then 'success' else 'info' end;

  when 'expenses' then
    if tg_op = 'INSERT' then
      select name into v_tmp from expense_categories where id = (n ->> 'category_id')::uuid;
      v_title := 'مصروف: ' || coalesce(v_tmp, '') || ' — ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
      v_body := n ->> 'description';
    elsif tg_op = 'DELETE' then
      v_title := 'حذف مصروف ' || fmt((o ->> 'amount_sdg')::numeric) || ' ج.س'; v_level := 'danger';
    else
      v_title := 'تعديل مصروف'; v_level := 'warning';
    end if;

  when 'delivery_permits' then
    if tg_op = 'INSERT' then
      v_title := 'إذن تسليم جديد ' || (n ->> 'number'); v_body := n ->> 'receiver_name';
    elsif (n ->> 'status') is distinct from (o ->> 'status') then
      v_title := case n ->> 'status' when 'delivered' then 'تم تسليم ' else 'إلغاء إذن ' end || (n ->> 'number');
      v_level := case n ->> 'status' when 'delivered' then 'success' else 'danger' end;
    else return null; end if;

  when 'attendance' then
    select full_name into v_tmp from employees where id = (r ->> 'employee_id')::uuid;
    if n ->> 'edited_by' is not null then
      v_title := 'تعديل حضور: ' || coalesce(v_tmp, ''); v_level := 'warning';
      v_body := 'يوم ' || (n ->> 'work_date');
    elsif tg_op = 'INSERT' then
      v_title := 'حضور: ' || coalesce(v_tmp, '');
      v_body := case when (n ->> 'late_minutes')::int > 0 then 'متأخر ' || (n ->> 'late_minutes') || ' دقيقة' else 'في الموعد' end;
      v_level := case when (n ->> 'late_minutes')::int > 0 then 'warning' else 'info' end;
    elsif (n ->> 'check_out') is distinct from (o ->> 'check_out') then
      v_title := 'انصراف: ' || coalesce(v_tmp, '');
    else return null; end if;

  when 'employees' then
    v_title := case tg_op when 'INSERT' then 'موظف جديد: ' when 'DELETE' then 'حذف موظف: ' else 'تعديل بيانات موظف: ' end
               || (r ->> 'full_name');
    if (n ->> 'base_salary') is distinct from (o ->> 'base_salary') and tg_op = 'UPDATE' then
      v_body := 'المرتب: ' || fmt((o ->> 'base_salary')::numeric) || ' ← ' || fmt((n ->> 'base_salary')::numeric);
      v_level := 'warning';
    end if;

  when 'salary_advances' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
    v_title := 'سلفة لـ ' || coalesce(v_tmp, '') || ': ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_level := 'warning';

  when 'salary_deductions' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
    v_title := 'خصم على ' || coalesce(v_tmp, '') || ': ' || fmt((n ->> 'amount_sdg')::numeric) || ' ج.س';
    v_body := n ->> 'reason';

  when 'payrolls' then
    if tg_op = 'UPDATE' and n ->> 'status' = 'paid' and o ->> 'status' <> 'paid' then
      select full_name into v_tmp from employees where id = (n ->> 'employee_id')::uuid;
      v_title := 'صرف مرتب ' || coalesce(v_tmp, '') || ' — ' || (n ->> 'period');
      v_body := 'الصافي ' || fmt((n ->> 'net')::numeric) || ' ج.س';
    else return null; end if;

  when 'shareholders' then
    v_title := case tg_op when 'INSERT' then 'مساهم جديد: ' when 'DELETE' then 'حذف مساهم: ' else 'تعديل مساهم: ' end
               || (r ->> 'full_name');
    v_level := case when tg_op = 'DELETE' or (n ->> 'is_active') = 'false' then 'danger' else 'info' end;

  when 'shareholder_terms' then
    if tg_op <> 'INSERT' then return null; end if;
    select full_name into v_tmp from shareholders where id = (n ->> 'shareholder_id')::uuid;
    v_title := 'نسب جديدة للمساهم ' || coalesce(v_tmp, '');
    v_body := 'مرتب ' || fmt((n ->> 'monthly_salary')::numeric) || ' — مبيعات ' || pct(n ->> 'sales_pct')
              || '% — أرباح ' || pct(n ->> 'profit_pct') || '% من ' || (n ->> 'effective_from');
    v_level := 'warning';

  when 'shareholder_payouts' then
    if tg_op = 'UPDATE' and n ->> 'status' = 'paid' and o ->> 'status' <> 'paid' then
      select full_name into v_tmp from shareholders where id = (n ->> 'shareholder_id')::uuid;
      v_title := 'صرف مستحقات ' || coalesce(v_tmp, '') || ' — ' || (n ->> 'period');
      v_body := fmt((n ->> 'total')::numeric) || ' ج.س';
    else return null; end if;

  when 'profiles' then
    if tg_op = 'INSERT' then
      v_title := 'مستخدم جديد: ' || (n ->> 'username');
    elsif tg_op = 'DELETE' then
      v_title := 'حذف المستخدم ' || (o ->> 'username'); v_level := 'danger';
    elsif (n ->> 'permissions') is distinct from (o ->> 'permissions') or (n ->> 'role') is distinct from (o ->> 'role') then
      v_title := 'تغيير صلاحيات: ' || (n ->> 'username'); v_level := 'warning';
    elsif (n ->> 'is_active') is distinct from (o ->> 'is_active') then
      v_title := case when (n ->> 'is_active')::boolean then 'تفعيل ' else 'إيقاف ' end || 'المستخدم ' || (n ->> 'username');
      v_level := 'danger';
    else return null; end if;

  when 'settings' then
    v_title := 'تعديل إعدادات الشركة'; v_level := 'warning';

  when 'customers' then
    v_title := case tg_op when 'INSERT' then 'عميل جديد: ' when 'DELETE' then 'حذف عميل: ' else 'تعديل عميل: ' end || (r ->> 'name');

  when 'suppliers' then
    v_title := case tg_op when 'INSERT' then 'مورد جديد: ' when 'DELETE' then 'حذف مورد: ' else 'تعديل مورد: ' end || (r ->> 'name');

  when 'categories' then
    v_title := case tg_op when 'INSERT' then 'قسم جديد: ' when 'DELETE' then 'حذف قسم: ' else 'تعديل قسم: ' end || (r ->> 'name');

  else
    return null;
  end case;
  if v_title is null then return null; end if;

  insert into notifications (type, level, title, body, entity_type, entity_id, actor_id, actor_name, data)
  values (tg_table_name || '.' || lower(tg_op), v_level, v_title, v_body, tg_table_name,
          (r ->> 'id')::uuid, v_uid, v_name, n);
  return null;
end $function$;
