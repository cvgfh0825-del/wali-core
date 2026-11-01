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
    elsif (n - 'qty_on_hand' - 'updated_at' - 'cost_usd') is distinct from (o - 'qty_on_hand' - 'updated_at' - 'cost_usd') then
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
