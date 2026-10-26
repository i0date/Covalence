-- =============================================================================
-- COVALENCE — PRIVATE EVIDENCE BUCKET
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run. Safe to re-run.
-- =============================================================================
-- Before: cov-evidence was a public bucket, so anyone holding a document's URL
-- could open it forever.
-- After:  the bucket is private. The browser can still UPLOAD (insert only) but
-- cannot read, list, overwrite or delete. Documents open through
-- /api/evidence-url, which signs a 5-minute link with the service-role key.
--
-- The bucket did not exist in the original project ("Bucket not found" on
-- upload), so this creates it — private from the start, 10 MB per file.
-- If it already exists it is switched to private.
-- =============================================================================

-- 1. Create the bucket private, or make an existing one private
insert into storage.buckets (id, name, public, file_size_limit)
values ('cov-evidence', 'cov-evidence', false, 10485760)
on conflict (id) do update set public = false;

-- 2. Remove every existing policy that touches this bucket
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%cov-evidence%' or coalesce(with_check, '') ilike '%cov-evidence%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- 3. Upload only — no read, list, update or delete from the browser
create policy cov_evidence_anon_insert on storage.objects
  for insert to anon
  with check (bucket_id = 'cov-evidence');


-- =============================================================================
-- VERIFY — expect: public = false, and exactly one policy (INSERT) for the bucket
-- =============================================================================
select id, public from storage.buckets where id = 'cov-evidence';
select policyname, cmd, roles from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%cov-evidence%' or coalesce(with_check, '') ilike '%cov-evidence%');
