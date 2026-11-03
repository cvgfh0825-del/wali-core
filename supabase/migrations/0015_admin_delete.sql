-- =====================================================================
--  WALI CORE — 0015: الحذف النهائي لمدير النظام
--  admin_delete(الجدول، المعرّف): بيمسح السجل وكل اللي مربوط بيه، وبيرجّع المخزن
--  (رصيد كل صنف بيتحسب تاني من حركات المخزن اللي فضلت). مدير النظام بس.
--  الحذف ده مش بيرجع — النسخة الاحتياطية اليومية هي الطريق الوحيد للاسترجاع.
-- =====================================================================

-- رصيد الأصناف = مجموع حركاتها
create or replace function public.recalc_stock(p_products uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('wali.stock_move', '1', true);
  update products p set qty_on_hand = coalesce((select sum(qty) from stock_movements m where m.product_id = p.id), 0)
   where p.id = any (p_products);
  perform set_config('wali.stock_move', '', true);
end $$;

create or replace function public.admin_delete(p_table text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_title text; v_row jsonb; v_prods uuid[] := '{}'; v_ids uuid[]; v_inv uuid;
begin
  if not is_admin() then raise exception 'الحذف النهائي متاح لمدير النظام فقط'; end if;
  if p_table not in ('invoices','delivery_permits','purchases','sales_returns','payments','expenses','customers','suppliers',
                     'products','employees','attendance','salary_advances','salary_deductions','salary_additions','payrolls',
                     'holidays','exchange_rates','notifications','shareholders','shareholder_payouts','categories','expense_categories') then
    raise exception 'لا يمكن حذف هذا النوع من البيانات';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1', p_table) into v_row using p_id;
  if v_row is null then raise exception 'السجل غير موجود'; end if;

  if p_table = 'invoices' then
    -- الفاتورة + أصنافها + دفعاتها + أذونات التسليم + المرتجعات + حركات المخزن
    select array_agg(id) into v_ids from sales_returns where invoice_id = p_id;
    select coalesce(array_agg(distinct product_id), '{}') into v_prods from stock_movements
     where (ref_type = 'invoice' and ref_id = p_id) or (ref_type = 'sales_return' and ref_id = any (coalesce(v_ids, '{}')));
    delete from stock_movements where (ref_type = 'invoice' and ref_id = p_id) or (ref_type = 'sales_return' and ref_id = any (coalesce(v_ids, '{}')));
    delete from payments where invoice_id = p_id;
    delete from delivery_items where permit_id in (select id from delivery_permits where invoice_id = p_id);
    delete from delivery_permits where invoice_id = p_id;
    delete from sales_return_items where return_id = any (coalesce(v_ids, '{}'));
    delete from sales_returns where invoice_id = p_id;
    update invoices set source_proforma_id = null where source_proforma_id = p_id;
    delete from invoice_items where invoice_id = p_id;
    delete from invoices where id = p_id;
    v_title := 'حذف فاتورة ' || (v_row ->> 'number');

  elsif p_table = 'delivery_permits' then
    -- لو كان اتسلّم: الكمية المسلّمة بترجع «غير مسلّمة» على الفاتورة
    if v_row ->> 'status' = 'delivered' then
      update invoice_items ii set delivered_qty = greatest(ii.delivered_qty - di.qty, 0)
        from delivery_items di where di.permit_id = p_id and di.invoice_item_id = ii.id;
    end if;
    delete from delivery_items where permit_id = p_id;
    delete from delivery_permits where id = p_id;
    v_title := 'حذف إذن تسليم ' || (v_row ->> 'number');

  elsif p_table = 'sales_returns' then
    v_inv := (v_row ->> 'invoice_id')::uuid;
    select coalesce(array_agg(distinct product_id), '{}') into v_prods from stock_movements where ref_type = 'sales_return' and ref_id = p_id;
    update invoice_items ii set returned_qty = greatest(ii.returned_qty - ri.qty, 0)
      from sales_return_items ri where ri.return_id = p_id and ri.invoice_item_id = ii.id;
    update invoices set returned_sdg = greatest(returned_sdg - (v_row ->> 'total_sdg')::numeric, 0),
                        returned_cost_sdg = greatest(returned_cost_sdg - (v_row ->> 'cost_sdg')::numeric, 0)
     where id = v_inv;
    delete from stock_movements where ref_type = 'sales_return' and ref_id = p_id;
    delete from sales_return_items where return_id = p_id;
    delete from sales_returns where id = p_id;
    v_title := 'حذف مرتجع ' || (v_row ->> 'number');

  elsif p_table = 'purchases' then
    select coalesce(array_agg(distinct product_id), '{}') into v_prods from stock_movements where ref_type = 'purchase' and ref_id = p_id;
    delete from stock_movements where ref_type = 'purchase' and ref_id = p_id;
    delete from payments where purchase_id = p_id;
    delete from purchase_items where purchase_id = p_id;
    delete from purchases where id = p_id;
    v_title := 'حذف فاتورة مشتريات ' || (v_row ->> 'number');

  elsif p_table = 'payrolls' then
    update salary_advances set payroll_id = null where payroll_id = p_id;
    update salary_deductions set payroll_id = null where payroll_id = p_id;
    update salary_additions set payroll_id = null where payroll_id = p_id;
    delete from expenses where ref_type = 'payroll' and ref_id = p_id;
    delete from payrolls where id = p_id;
    v_title := 'حذف مرتب ' || (v_row ->> 'period');

  elsif p_table = 'products' then
    -- الصنف لوحده بس (لو عليه فواتير أو مشتريات الحذف هيترفض)
    delete from stock_movements where product_id = p_id and ref_type in ('opening', 'adjust');
    delete from product_images where product_id = p_id;
    delete from products where id = p_id;
    v_title := 'حذف صنف ' || (v_row ->> 'name');

  else
    execute format('delete from public.%I where id = $1', p_table) using p_id;
    v_title := 'حذف نهائي من ' || p_table;
  end if;

  if array_length(v_prods, 1) > 0 then perform recalc_stock(v_prods); end if;

  insert into audit_log (table_name, record_id, action, old_data, new_data, user_id, user_name)
  values (p_table, p_id::text, 'delete', v_row - 'image', null, auth.uid(), actor_name());
  insert into notifications (type, level, title, body, entity_type, actor_id, actor_name)
  values ('admin.delete', 'danger', v_title, 'حذف نهائي من مدير النظام', p_table, auth.uid(), coalesce(actor_name(), 'النظام'));
  return jsonb_build_object('ok', true, 'title', v_title);
end $$;
revoke execute on function public.admin_delete(text, uuid) from anon;
revoke execute on function public.recalc_stock(uuid[]) from anon, authenticated;
