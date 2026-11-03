-- =====================================================================
--  WALI CORE — 0011: الرقم الضريبي للعميل على الفاتورة
--  بيتكتب في شاشة الفاتورة وبيتطبع في خانة «الرقم التعريفي الضريبي» الفاضية
-- =====================================================================
alter table public.invoices add column if not exists customer_tax_id text;

-- v_invoices فيها i.* فلازم تتعمل تاني عشان العمود الجديد يظهر
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
  v_ctax     text := nullif(trim(p ->> 'customer_tax_id'), '');

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

    update invoices set customer_id = v_cust, customer_name = v_cname, customer_phone = v_cphone, customer_tax_id = v_ctax,

           rate = v_rate, subtotal_sdg = v_sub, discount_sdg = v_disc, total_sdg = v_total,

           cost_sdg = v_cost, payment_type = v_ptype, notes = p ->> 'notes', invoice_date = local_today()

     where id = v_id returning * into v_inv;

  else

    insert into invoices (number, kind, status, customer_id, customer_name, customer_phone, customer_tax_id, rate,

                          subtotal_sdg, discount_sdg, total_sdg, cost_sdg, payment_type, notes,

                          source_proforma_id, salesperson_id, created_by, posted_at)

    values (next_doc_number(v_kind), v_kind, case when v_kind = 'final' then 'posted' else 'open' end,

            v_cust, v_cname, v_cphone, v_ctax, v_rate, v_sub, v_disc, v_total, v_cost, v_ptype, p ->> 'notes',

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

      'customer_phone', v_pf.customer_phone, 'customer_tax_id', v_pf.customer_tax_id, 'discount_sdg', v_pf.discount_sdg,

      'paid_sdg', coalesce(p_paid, 0), 'method', p_method, 'notes', v_pf.notes, 'items', v_items),

    true, p_id);



  update invoices set status = 'converted', converted_invoice_id = v_final.id where id = p_id;

  return v_final;

end $function$;
