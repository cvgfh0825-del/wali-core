-- =====================================================================
--  WALI CORE — 0009: مخزن خاص للنسخ الاحتياطية التلقائية (نسخة الموقع)
--  النسخة اليومية بتترفع هنا بدل ما تتحفظ على الجهاز، والأدمن بس اللي يشوفها
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/json'])
on conflict (id) do nothing;

drop policy if exists "backups: admin read" on storage.objects;
drop policy if exists "backups: admin write" on storage.objects;
drop policy if exists "backups: admin delete" on storage.objects;

create policy "backups: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_admin());
create policy "backups: admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and public.is_admin());
create policy "backups: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and public.is_admin());
