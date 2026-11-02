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
