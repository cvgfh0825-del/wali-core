-- =====================================================================
--  WALI CORE — 0013: رقم المستند الجاي (للعرض بس) — بيظهر على شاشة الفاتورة قبل الحفظ
--  الرقم الفعلي بيتحجز وقت الحفظ (next_doc_number)، فلو اتنين حفظوا في نفس اللحظة كل واحد بياخد رقم
-- =====================================================================
create or replace function public.peek_doc_number(p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select case p_kind when 'proforma' then 'PF' when 'final' then 'INV' when 'return' then 'RT'
                     when 'purchase' then 'PO' when 'delivery' then 'DL' else upper(p_kind) end
         || '-' || lpad((extract(year from local_today())::int % 100)::text, 2, '0') || '-'
         || lpad((coalesce((select last from doc_counters where kind = p_kind and year = extract(year from local_today())::int), 0) + 1)::text, 5, '0')
$$;
revoke execute on function public.peek_doc_number(text) from anon;
