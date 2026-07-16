-- Add the 4 seasons (North-India timing) as season-start greeting campaigns,
-- plus starter messages. Dates recur ~yearly; admin can adjust in Schedule.
insert into public.notification_campaigns (label, bucket, hour_ist, dow, on_date, enabled) values
  ('Spring begins', 'spring', 9, null, '2027-02-15', true),
  ('Summer begins', 'summer', 9, null, '2027-04-01', true),
  ('Autumn begins', 'autumn', 9, null, '2026-10-01', true),
  ('Winter begins', 'winter', 9, null, '2026-12-01', true)
on conflict do nothing;

insert into public.notification_templates (bucket, title, body) values
  ('spring', 'Spring is here 🌸',  'Mausam suhana ho gaya! Fresh fruits aur seasonal veggies NGS se, ghar par. 🌷'),
  ('spring', 'Basant vibes 🌸',    'Khilte mausam me fresh grocery ka maza — NGS se 10 min me mangao.'),
  ('summer', 'Garmi aa gayi ☀️',   'Thanda-thanda cool-cool! Cold drinks, ice-cream, nimbu-pani ka saamaan NGS par. 🧊'),
  ('summer', 'Beat the heat ☀️',   'Chilled aur fresh — summer essentials ghar baithe NGS se paao. 🍹'),
  ('autumn', 'Autumn vibes 🍂',    'Suhana mausam, fresh grocery! Ghar ka saara saamaan NGS se, ek order me. 🍁'),
  ('autumn', 'Sharad ritu 🍂',     'Mausam badla, zaroorat nahi! Daily essentials NGS par hazir. 🍁'),
  ('winter', 'Sardi aa gayi ❄️',   'Garam chai, soup aur dry-fruits — winter essentials NGS se ghar par. ☕'),
  ('winter', 'Winter is here ❄️',  'Thandi me bahar kyun? Fresh grocery ghar baithe NGS se mangao. 🧣')
on conflict do nothing;
