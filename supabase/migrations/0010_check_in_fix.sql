-- =====================================================================
--  WALI CORE — 0010: تسجيل الحضور لما يكون فيه سجل لليوم من غير وقت حضور
--  (مثلاً الأدمن عدّل حضور الموظف قبل ما يسجل) — بيكمّل السجل بدل ما يرفض
-- =====================================================================
create or replace function public.check_in() returns public.attendance
language plpgsql security definer set search_path = public as $$
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
  on conflict (employee_id, work_date) do update
    set check_in = excluded.check_in, late_minutes = excluded.late_minutes, status = 'present'
    where attendance.check_in is null
  returning * into a;
  if a.id is null then raise exception 'سجّلت حضورك اليوم من قبل'; end if;
  return a;
end $$;
