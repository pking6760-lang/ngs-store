-- ════════════════════════════════════════════════════════════════════════════
-- "At least 10 notifications a day."
--   • 12 daily time-slots spread across waking hours, each from a different
--     group so the day never feels samey.
--   • Enough messages seeded per group that rotation gives a week+ of variety
--     before anything repeats.
-- (Weather + festival messages fire ON TOP of these on the days they apply.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── More messages for the groups used by the daily slots (Hinglish, emoji) ───
insert into public.notification_templates (bucket, title, body) values
  ('morning',  'Naya din, nayi energy 🌅','Aaj ka pehla kaam — ghar ka saamaan check karo, NGS se mangao. 🛒'),
  ('morning',  'Breakfast ready? 🍳',     'Doodh, bread, anda kam hai? 10 min me ghar par. 🥚'),
  ('morning',  'Subah subah ☀️',          'Din ki achhi shuruaat NGS ke saath — jo chahiye, turant.'),
  ('morning',  'Good morning ji 🌞',      'Chai-nashta ka saamaan short? NGS se abhi mangao.'),

  ('playful',  'Kuch meetha ho jaaye? 🍫','Chocolate, ice cream, biscuit — man kare toh NGS se! 😋'),
  ('playful',  'Chai time = snacks time ☕','Namkeen khatam? NGS se turant, chai ke saath. 🍪'),
  ('playful',  'Mood off? Snacks on! 🍿', 'Thoda chatpata ho jaaye — NGS se 10 min me. 😄'),
  ('playful',  'Bored ho rahe? 🎈',       'Kuch mangwa ke khaao — NGS hai na! 😁'),

  ('forgot',   'Ek baar phir check karo 🔍','Namak, cheeni, tel... kuch reh to nahi gaya? NGS se mangao.'),
  ('forgot',   'List complete? 📋',       'Aaj ki zaroorat ki cheezein order kar li? NGS ready hai. ✅'),
  ('forgot',   'Doodh laana bhool gaye? 🥛','Koi baat nahi — NGS 10 min me ghar tak. 🛵'),
  ('forgot',   'Kal ke liye ready? 🌙',   'Subah ke liye zaroorat ka saamaan aaj hi mangwa lo.'),

  ('lunch',    'Lunch time 🍛',           'Dopahar ka khaana ready? Jo missing hai, NGS se 10 min me.'),
  ('lunch',    'Khaana ban raha? 🍲',     'Sabzi, masala, tel kam? NGS se turant mangao. 🧅'),
  ('lunch',    'Bhookh lag gayi? 🍚',     'Lunch ka saamaan short? NGS ghar tak laayega jaldi.'),
  ('lunch',    'Dopahar ki bhookh 🥗',    'Fresh sabzi aur zaroorat ka saamaan — NGS se abhi.'),
  ('lunch',    'Roti-sabzi ready? 🫓',    'Aata, sabzi, dahi — sab NGS par, ghar baithe.'),
  ('lunch',    'Lunch break! 🍱',         'Khaane ka saamaan mangwa lo, NGS 10 min me. 😋'),

  ('teasing',  'Phir bahar se mangwaoge? 😏','Ghar ka saamaan bhi chahiye — NGS se mangwa lo na!'),
  ('teasing',  'Aalasi mat bano 😜',      'Ek tap aur saamaan ghar par. NGS ready hai. 😎'),
  ('teasing',  'Fridge dekha? 👀',        'Khaali lag raha hai... NGS se bhar lo, jaldi. 🧺'),
  ('teasing',  'Soch kya rahe ho? 🤨',    'Order karo, baaki hum sambhaal lenge. NGS. 🛒'),

  ('alone',    'Solo day? 🎧',            'Comfort food aur zaroorat ka saamaan — NGS ghar tak.'),
  ('alone',    'Apna khayal rakho 💚',    'Fruits, snacks, jo pasand ho — NGS se mangao.'),
  ('alone',    'Netflix + snacks? 🍿',    'Movie night ka saamaan NGS se, 10 min me. 🎬'),

  ('travel',   'Trip plan hai? 🗺️',       'Nikalne se pehle zaroorat ka saamaan mangwa lo. ✈️'),
  ('travel',   'Ghar wapas? 🏡',          'Fridge khaali hoga — restock karo NGS se, turant. 🧺'),
  ('travel',   'Long drive? 🛣️',          'Raaste ke liye snacks aur pani NGS se. 🥤'),

  ('evening',  'Din dhal raha 🌆',        'Shaam ki zaroorat ka saamaan — NGS se 10 min me.'),
  ('evening',  'Chai-pakode? ☔',         'Evening cravings NGS se poori karo, ghar baithe. 😋'),
  ('evening',  'Sunset snacks 🌇',        'Thoda kuch mangwa lo — NGS ready hai.'),
  ('evening',  'Shaam ho gayi 🍵',        'Chai ke saath kuch chahiye? NGS se turant.'),

  ('dinner',   'Dinner ready? 🍽️',        'Raat ke khaane ka saamaan reh gaya? NGS abhi khula hai!'),
  ('dinner',   'Raat ka khaana 🌙',       'Sabzi, roti, dahi — jo chahiye NGS se, 10 min me.'),
  ('dinner',   'Khaane me kya? 🍲',       'Dinner ka saamaan short? NGS ghar tak laayega.'),
  ('dinner',   'Family dinner? 👨‍👩‍👧',      'Sabke liye khaane ka saamaan NGS se, ek order me.'),
  ('dinner',   'Late dinner? 🍜',         'Der ho gayi? NGS abhi bhi hai — mangwa lo.'),

  ('urgent',   'Turant chahiye? ⚡',       'NGS se 10 min me ghar par — abhi order karo!'),
  ('urgent',   'Mehmaan aa rahe? 🔔',     'Jaldi se saamaan mangwa lo — NGS 10 min me. 🏃'),
  ('urgent',   'Abhi ke abhi! 🚨',        'Emergency saamaan? NGS turant ghar tak. 🛵'),

  ('night',    'So-ne se pehle 😴',       'Subah ke liye doodh-bread mangwa lo, aaj hi.'),
  ('night',    'Raat ki craving? 🌃',     'Ice cream, chips, kuch bhi — NGS se 10 min me. 🍦'),
  ('night',    'Din khatam 🌜',           'Kal ki taiyari — zaroorat ka saamaan aaj mangwa lo.'),
  ('night',    'Good night se pehle ✨',  'Kuch reh gaya? NGS se jaldi mangwa lo.')
on conflict do nothing;

-- ── 12 daily slots. Existing morning/afternoon/evening/night stay; enable
--    night; add the rest. Each guarded by label so re-running is safe. ────────
update public.notification_campaigns set enabled = true
  where bucket in ('afternoon','night') and dow is null and on_date is null;

insert into public.notification_campaigns (label, bucket, hour_ist, dow, on_date, enabled, recur_md)
select v.label, v.bucket, v.hour, null, null, true, false
from (values
  ('Playful · daily',  'playful', 9),
  ('Forgot · daily',   'forgot',  11),
  ('Lunch · daily',    'lunch',   12),
  ('Teasing · daily',  'teasing', 13),
  ('Me-time · daily',  'alone',   15),
  ('Travel · daily',   'travel',  16),
  ('Urgent · daily',   'urgent',  17),
  ('Dinner · daily',   'dinner',  19)
) as v(label, bucket, hour)
where not exists (
  select 1 from public.notification_campaigns c where c.label = v.label
);
