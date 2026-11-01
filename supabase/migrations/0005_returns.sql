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
