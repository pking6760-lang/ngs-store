-- ────────────────────────────────────────────────────────────────────────────
-- Rate-limit partner OTP sends: stop inbox spam and the "resend resets the
-- attempt counter" bypass. Track the last send and a rolling send window per
-- email. (verify already caps wrong guesses at 5.)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.partner_otps
  add column if not exists last_sent_at   timestamptz,
  add column if not exists sends_in_window int not null default 0,
  add column if not exists window_start   timestamptz;
