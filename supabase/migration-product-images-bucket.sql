-- Public bucket for product photos (served via CDN, cached, lazy-loaded).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true;

-- Anyone can READ product images (they're public product photos).
drop policy if exists "product images public read" on storage.objects;
create policy "product images public read" on storage.objects
  for select using (bucket_id = 'product-images');

-- Only admins can add / change / remove product images.
drop policy if exists "product images admin write" on storage.objects;
create policy "product images admin write" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "product images admin update" on storage.objects;
create policy "product images admin update" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "product images admin delete" on storage.objects;
create policy "product images admin delete" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin());
