-- Storage policies for the doc-images bucket (image uploads for the editor).
--
-- The bucket itself is created via the Storage API (public=true), which makes
-- objects publicly READABLE by URL. Uploads still go through RLS on
-- storage.objects, so authenticated users need an explicit INSERT policy.
-- Run this in the Supabase SQL Editor once.

-- Any authenticated user may upload into the doc-images bucket.
drop policy if exists doc_images_insert on storage.objects;
create policy doc_images_insert on storage.objects
for insert to authenticated
with check ( bucket_id = 'doc-images' );

-- Authenticated users may overwrite/update their uploads (optional).
drop policy if exists doc_images_update on storage.objects;
create policy doc_images_update on storage.objects
for update to authenticated
using ( bucket_id = 'doc-images' );

-- Public read is already granted by the bucket's public=true flag, but add an
-- explicit SELECT policy so signed/anon reads are unambiguous.
drop policy if exists doc_images_read on storage.objects;
create policy doc_images_read on storage.objects
for select to public
using ( bucket_id = 'doc-images' );

-- NOTE: deleting the image node from a document does NOT delete the stored
-- object. Garbage-collecting orphaned objects is a future enhancement.
