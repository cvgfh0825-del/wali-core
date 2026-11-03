-- =====================================================================
--  WALI CORE — 0014: المرتب بالساعات + الإجازات + الزيادات
--  سعر الساعة = المرتب الشهري ÷ (أيام العمل في الشهر × ساعات اليوم)
--  المستحق = سعر الساعة × (الساعات الفعلية + ساعات أيام الإجازة المعتمدة)
--  أيام العمل = أيام الشهر من غير العطلة الأسبوعية والعطلات الرسمية
--  الحساب بيبدأ من تاريخ بداية عمل الموظف (hired_at)، وكله بتوقيت السودان
-- =====================================================================

-- العطلة الأسبوعية (0 = الأحد … 5 = الجمعة، 6 = السبت)
alter table public.settings add column if not exists weekly_off int[] not null default '{5}';

create table if not exists public.holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- زيادة / مكافأة على المرتب (عكس الخصم)
create table if not exists public.salary_additions (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references public.employees(id) on delete cascade,
  amount_sdg    numeric(16,2) not null check (amount_sdg > 0),
  addition_date date not null default public.local_today(),
  reason        text,
  payroll_id    uuid,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

alter table public.payrolls add column if not exists earned          numeric(16,2) not null default 0;
alter table public.payrolls add column if not exists additions       numeric(16,2) not null default 0;
alter table public.payrolls add column if not exists worked_hours    numeric(10,2) not null default 0;
alter table public.payrolls add column if not exists scheduled_hours numeric(10,2) not null default 0;
alter table public.payrolls add column if not exists hourly_rate     numeric(16,4) not null default 0;
alter table public.payrolls add column if not exists leave_days      int not null default 0;

-- v_payrolls فيها p.* فلازم تتعمل تاني
drop view if exists public.v_payrolls;
create view public.v_payrolls with (security_invoker = on) as
select p.*, e.full_name as employee_name, e.job_title
  from public.payrolls p join public.employees e on e.id = p.employee_id;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
alter table public.holidays enable row level security;
drop policy if exists sel on public.holidays;
drop policy if exists ins on public.holidays;
drop policy if exists upd on public.holidays;
drop policy if exists del on public.holidays;
create policy sel on public.holidays for select to authenticated using (public.is_active_user());
create policy ins on public.holidays for insert to authenticated with check (public.has_perm('attendance', 'edit'));
create policy upd on public.holidays for update to authenticated using (public.has_perm('attendance', 'edit'));
create policy del on public.holidays for delete to authenticated using (public.has_perm('attendance', 'edit'));

alter table public.salary_additions enable row level security;
drop policy if exists sel on public.salary_additions;
drop policy if exists ins on public.salary_additions;
drop policy if exists upd on public.salary_additions;
drop policy if exists del on public.salary_additions;
create policy sel on public.salary_additions for select to authenticated using (public.has_perm('payroll', 'view'));
create policy ins on public.salary_additions for insert to authenticated with check (public.has_perm('payroll', 'create'));
create policy upd on public.salary_additions for update to authenticated using (public.has_perm('payroll', 'edit'));
create policy del on public.salary_additions for delete to authenticated using (public.has_perm('payroll', 'edit'));

-- إشعار للأدمن بالزيادات والعطلات
create or replace function public.notify_hr() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_table_name = 'salary_additions' then
    select full_name into v_name from employees where id = new.employee_id;
    insert into notifications (type, level, title, body, entity_type, entity_id, actor_id, actor_name)
    values ('salary_additions.insert', 'info', 'زيادة لـ ' || coalesce(v_name, '') || ': ' || to_char(new.amount_sdg, 'FM999,999,999,990') || ' ج.س',
            new.reason, 'salary_additions', new.id, auth.uid(), coalesce(public.actor_name(), 'النظام'));
  else
    insert into notifications (type, level, title, entity_type, entity_id, actor_id, actor_name)
    values ('holidays.insert', 'info', 'عطلة رسمية: ' || new.name || ' — ' || to_char(new.holiday_date, 'DD/MM/YYYY'),
            'holidays', new.id, auth.uid(), coalesce(public.actor_name(), 'النظام'));
  end if;
  return null;
end $$;
drop trigger if exists notify_hr on public.salary_additions;
create trigger notify_hr after insert on public.salary_additions for each row execute function public.notify_hr();
drop trigger if exists notify_hr on public.holidays;
create trigger notify_hr after insert on public.holidays for each row execute function public.notify_hr();

-- ---------------------------------------------------------------------
-- الحساب
-- ---------------------------------------------------------------------
create or replace function public.is_workday(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select not (extract(dow from p_day)::int = any (coalesce((select weekly_off from settings where id = 1), '{}')))
     and not exists (select 1 from holidays where holiday_date = p_day)
$$;

-- حساب موظف واحد في شهر (YYYY-MM)
create or replace function public.payroll_calc(p_period text, p_emp uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d1 date := month_start(p_period);
  d2 date := (month_start(p_period) + interval '1 month')::date;
  e employees; s settings;
  v_dayh numeric; v_mdays int; v_sched numeric; v_rate numeric;
  v_from date; v_to date; v_due int;
  v_present int; v_leave int; v_absent int; v_worked numeric; v_late int;
  v_sales numeric; v_comm numeric; v_add numeric; v_ded numeric; v_adv numeric;
  v_earned numeric; v_lated numeric;
begin
  select * into e from employees where id = p_emp;
  select * into s from settings where id = 1;
  v_dayh := greatest(extract(epoch from (s.work_end - s.work_start)) / 3600.0, 0);
  select count(*) into v_mdays from generate_series(d1, d2 - 1, interval '1 day') g where is_workday(g::date);
  v_sched := v_mdays * v_dayh;
  v_rate := case when v_sched > 0 then e.base_salary / v_sched else 0 end;

  -- الأيام المستحقة: من بداية عمل الموظف لحد النهارده (أو آخر الشهر)
  v_from := greatest(d1, coalesce(e.hired_at, d1));
  v_to := least(d2 - 1, local_today());
  select count(*) into v_due from generate_series(v_from, v_to, interval '1 day') g where v_from <= v_to and is_workday(g::date);

  select count(*) filter (where a.check_in is not null and a.status <> 'leave'),
         count(*) filter (where a.status = 'leave'),
         coalesce(sum(case when a.check_in is not null and a.check_out is not null and a.status <> 'leave'
                           then extract(epoch from (a.check_out - a.check_in)) / 3600.0 else 0 end), 0),
         coalesce(sum(a.late_minutes), 0)
    into v_present, v_leave, v_worked, v_late
    from attendance a
   where a.employee_id = p_emp and a.work_date >= v_from and a.work_date < d2;

  -- الغياب: يوم عمل مستحق مفيهوش حضور ولا إجازة
  select count(*) into v_absent
    from generate_series(v_from, v_to, interval '1 day') g
   where v_from <= v_to and is_workday(g::date)
     and not exists (select 1 from attendance a where a.employee_id = p_emp and a.work_date = g::date
                       and (a.check_in is not null or a.status = 'leave'));

  v_sales := case when e.commission_basis = 'total' then period_sales(d1, d2)
                  when e.user_id is null then 0 else period_sales(d1, d2, e.user_id) end;
  v_comm := round(v_sales * e.commission_pct / 100.0, 2);
  select coalesce(sum(amount_sdg), 0) into v_add from salary_additions
   where employee_id = p_emp and payroll_id is null and addition_date < d2;
  select coalesce(sum(amount_sdg), 0) into v_ded from salary_deductions
   where employee_id = p_emp and payroll_id is null and deduction_date < d2;
  select coalesce(sum(amount_sdg), 0) into v_adv from salary_advances
   where employee_id = p_emp and payroll_id is null and advance_date < d2;

  v_worked := round(v_worked, 2);
  v_earned := round(v_rate * (v_worked + v_leave * v_dayh), 2);
  v_lated := round(v_late * s.late_deduction_per_min, 2);

  return jsonb_build_object(
    'employee_id', e.id, 'employee_name', e.full_name, 'job_title', e.job_title, 'hired_at', e.hired_at,
    'base_salary', e.base_salary, 'day_hours', round(v_dayh, 2), 'month_workdays', v_mdays,
    'scheduled_hours', round(v_sched, 2), 'hourly_rate', round(v_rate, 4),
    'due_days', v_due, 'present_days', v_present, 'leave_days', v_leave, 'absent_days', v_absent,
    'worked_hours', v_worked, 'late_minutes', v_late, 'late_deduction', v_lated,
    'earned', v_earned, 'sales_base', v_sales, 'commission', v_comm,
    'additions', v_add, 'deductions', v_ded, 'advances', v_adv,
    'net', v_earned + v_comm + v_add - v_ded - v_adv - v_lated);
end $$;

-- كشف الحضور والمرتبات لكل الموظفين في شهر
create or replace function public.attendance_sheet(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('attendance', 'view') or has_perm('payroll', 'view')) then
    raise exception 'ليس لديك صلاحية لهذه العملية';
  end if;
  return coalesce((select jsonb_agg(payroll_calc(p_period, e.id) order by e.full_name)
                     from employees e
                    where e.is_active and coalesce(e.hired_at, '1900-01-01') < (month_start(p_period) + interval '1 month')::date), '[]');
end $$;

create or replace function public.generate_payroll(p_period text) returns int
language plpgsql security definer set search_path = public as $$
declare e employees; c jsonb; n int := 0;
begin
  perform ensure_perm('payroll', 'create');
  for e in select * from employees
            where is_active and coalesce(hired_at, '1900-01-01') < (month_start(p_period) + interval '1 month')::date loop
    if exists (select 1 from payrolls where period = p_period and employee_id = e.id and status = 'paid') then
      continue;
    end if;
    c := payroll_calc(p_period, e.id);
    insert into payrolls (period, employee_id, base_salary, earned, sales_base, commission, additions, deductions, advances,
                          late_minutes, late_deduction, absent_days, leave_days, worked_hours, scheduled_hours, hourly_rate, net)
    values (p_period, e.id, e.base_salary, (c ->> 'earned')::numeric, (c ->> 'sales_base')::numeric, (c ->> 'commission')::numeric,
            (c ->> 'additions')::numeric, (c ->> 'deductions')::numeric, (c ->> 'advances')::numeric,
            (c ->> 'late_minutes')::int, (c ->> 'late_deduction')::numeric, (c ->> 'absent_days')::int, (c ->> 'leave_days')::int,
            (c ->> 'worked_hours')::numeric, (c ->> 'scheduled_hours')::numeric, (c ->> 'hourly_rate')::numeric, (c ->> 'net')::numeric)
    on conflict (period, employee_id) do update
       set base_salary = excluded.base_salary, earned = excluded.earned, sales_base = excluded.sales_base,
           commission = excluded.commission, additions = excluded.additions, deductions = excluded.deductions,
           advances = excluded.advances, late_minutes = excluded.late_minutes, late_deduction = excluded.late_deduction,
           absent_days = excluded.absent_days, leave_days = excluded.leave_days, worked_hours = excluded.worked_hours,
           scheduled_hours = excluded.scheduled_hours, hourly_rate = excluded.hourly_rate, net = excluded.net, created_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.pay_payroll(p_id uuid) returns public.payrolls
language plpgsql security definer set search_path = public as $$
declare v payrolls; d2 date; v_cat uuid; v_name text; v_amount numeric;
begin
  perform ensure_perm('payroll', 'approve');
  select * into v from payrolls where id = p_id for update;
  if not found or v.status <> 'draft' then raise exception 'صُرف هذا المرتب من قبل'; end if;
  d2 := (month_start(v.period) + interval '1 month')::date;
  update salary_advances set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and advance_date < d2;
  update salary_deductions set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and deduction_date < d2;
  update salary_additions set payroll_id = p_id
   where employee_id = v.employee_id and payroll_id is null and addition_date < d2;
  update payrolls set status = 'paid', paid_at = now() where id = p_id returning * into v;

  select id into v_cat from expense_categories where name = 'رواتب';
  select full_name into v_name from employees where id = v.employee_id;
  -- المصروف الحقيقي = المستحق بالساعات + العمولة + الزيادات − الخصومات − التأخير (السلفة اتصرفت قبل كده)
  v_amount := v.earned + v.commission + v.additions - v.deductions - v.late_deduction;
  if v_amount > 0 then
    insert into expenses (category_id, amount_sdg, description, ref_type, ref_id, created_by)
    values (v_cat, v_amount, 'مرتب ' || v_name || ' — ' || v.period, 'payroll', v.id, auth.uid());
  end if;
  return v;
end $$;

-- النسخ الاحتياطي بيشمل الجداول الجديدة
create or replace function public.backup_tables() returns text[]
language sql immutable as $$
  select array['categories','products','product_images','customers','suppliers','exchange_rates','doc_counters',
               'purchases','purchase_items','invoices','invoice_items','sales_returns','sales_return_items',
               'delivery_permits','delivery_items','payments','expense_categories','expenses',
               'employees','attendance','holidays','salary_advances','salary_deductions','salary_additions','payrolls',
               'shareholders','shareholder_terms','shareholder_payouts','stock_movements']
$$;
