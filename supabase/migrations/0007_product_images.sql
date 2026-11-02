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
