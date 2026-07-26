-- Let the owner choose, per coupon, whether the value is a ceiling or a promise.
--
-- Until now every coupon was capped at the cart's item margin, so a "₹49 OFF"
-- could pay out ₹31 on thin-margin items. That protects the shop but makes the
-- coupon read as "up to ₹49". Sometimes the owner genuinely wants the full
-- amount honoured — a welcome offer, an apology credit, a festival promo they
-- are happy to fund out of pocket.
--
-- guaranteed = false (default)  → "UP TO ₹49 OFF", never dips into the shop's cost
-- guaranteed = true             → "₹49 OFF", always paid in full, loss accepted

alter table public.coupons
  add column if not exists guaranteed boolean not null default false;

comment on column public.coupons.guaranteed is
  'true = always pay the full value even if it exceeds the cart margin (shop absorbs the loss); false = cap at the cart margin and advertise as "up to".';
