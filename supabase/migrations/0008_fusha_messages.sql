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
