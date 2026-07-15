-- Make the partner engine live everywhere: add the partner tables to the
-- Realtime publication so the customer web, admin and partner apps all receive
-- instant push updates (instead of falling back to the slow safety poll).
do $$
declare t text;
begin
  foreach t in array array['partners','partner_presence','partner_slots','wallet_ledger','partner_strikes','ops_config','product_ops']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
