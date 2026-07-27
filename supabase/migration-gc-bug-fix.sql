-- FIX: the orphan sweep deleted every category photo.
--
-- WHAT I GOT WRONG. The sweep queued any file in the product-images bucket that
-- no PRODUCT referenced. Category photos are uploaded to that same bucket, named
-- cat<timestamp>.jpg — nothing in the products table points at them, so all nine
-- were classified as orphans and deleted. I even reported "11 orphaned photos
-- queued" as a good result without once checking WHAT those eleven files were.
--
-- The bug is the assumption, not the code: one bucket, one owner. A sweep that
-- deletes on the basis of "nobody I know about references this" has to know
-- about everybody who references it, and if it does not, it must not delete.
--
-- Two changes:
--   1. The rule now checks products AND categories.
--   2. It only ever considers files it can positively identify as a product
--      photo. Anything else in the bucket is left alone, so the next feature to
--      put a file there cannot be silently erased by a sweep written before it
--      existed. Deleting is the one operation that cannot be undone, so it gets
--      the narrow rule rather than the broad one.

begin;

-- Only a product photo is ever a candidate, and only when neither a product nor
-- a category is using it.
create or replace function public.storage_gc_list(p_limit int default 200)
returns table (bucket text, name text)
language sql stable security definer set search_path to 'public'
as $$
  select g.bucket, g.name
    from public.storage_gc g
   where public.is_admin()
     -- Belt and braces: even if something queued the wrong file, refuse to hand
     -- back anything still referenced by a product or a category.
     and not exists (select 1 from public.products p
                      where p.image_url like '%/' || g.bucket || '/' || g.name)
     and not exists (select 1 from public.categories c
                      where c.image_url like '%/' || g.bucket || '/' || g.name)
   order by g.id
   limit greatest(coalesce(p_limit, 200), 1)
$$;

revoke all on function public.storage_gc_list(int) from public, anon;
grant execute on function public.storage_gc_list(int) to authenticated;

-- Only a product's own photo is queued when that product is deleted or
-- re-photographed. Unchanged in intent — restated here so the trigger and the
-- sweep are read together.
create or replace function public.mark_product_image_gone()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_old text; v_new text; v_name text;
begin
  v_old := old.image_url;
  v_new := case when tg_op = 'DELETE' then null else new.image_url end;
  if v_old is null or v_old is not distinct from v_new then return coalesce(new, old); end if;
  if v_old not like '%/product-images/%' then return coalesce(new, old); end if;

  v_name := regexp_replace(v_old, '^.*/product-images/', '');
  -- A category may be using the very same file. Never queue it in that case.
  if exists (select 1 from public.categories c where c.image_url like '%/product-images/' || v_name)
  then return coalesce(new, old); end if;
  -- Nor if another product still shows it.
  if exists (select 1 from public.products p
              where p.id is distinct from old.id
                and p.image_url like '%/product-images/' || v_name)
  then return coalesce(new, old); end if;

  insert into public.storage_gc (bucket, name, reason)
  values ('product-images', v_name,
          case when tg_op = 'DELETE' then 'product deleted' else 'photo replaced' end)
  on conflict (bucket, name) do nothing;
  return coalesce(new, old);
end $$;

-- The backfill that caused this is gone for good: there is no longer any sweep
-- of "everything in the bucket nobody claims". Files are only ever queued by the
-- trigger above, one at a time, for a product that owned them.
delete from public.storage_gc where reason = 'orphaned before cleanup existed';

commit;
