-- Fix: let a partner re-submit their own registration regardless of current
-- status (rejected/approved), not only while 'pending'. The WITH CHECK still
-- forces the resulting row to 'pending' for non-admins, so a partner can never
-- self-approve — a re-submission simply goes back into review.
drop policy if exists "partners update own pending or admin" on public.partners;
create policy "partners update own or admin" on public.partners for update
  using (public.is_admin() or user_id = auth.uid())
  with check (public.is_admin() or (user_id = auth.uid() and status = 'pending'));
