-- Custom category photos (uploaded by the admin, stored in the product-images
-- CDN bucket). Falls back to the built-in line icon when empty.
alter table public.categories add column if not exists image_url text;
