-- Store the scanned barcode on the product, for future in-store scanning / POS.
-- Public column (barcodes are printed on the pack — not sensitive).
alter table public.products add column if not exists barcode text;
create index if not exists products_barcode_idx on public.products (barcode) where barcode is not null;
