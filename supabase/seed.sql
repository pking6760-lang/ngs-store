-- ============================================================================
-- NGS Store — seed data (catalog + starter coupons)
-- Run this AFTER schema.sql. Safe to re-run (uses "on conflict do nothing").
-- Edit prices/stock from the admin app later; this is only the starting point.
-- ============================================================================

-- Categories
insert into public.categories (id, name, icon, color, sort) values ('dairy-bread','Dairy, Bread & Eggs','🥛','#fdf4e3',0) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('snacks','Snacks & Munchies','🍿','#fce8ec',1) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('beverages','Cold Drinks & Juices','🥤','#e6f0fb',2) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('instant','Instant & Frozen Food','🍜','#f3ecfb',3) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('bakery','Bakery & Sweets','🧁','#fdeae6',4) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('personal','Personal Care','🧴','#e7f6f6',5) on conflict (id) do nothing;
insert into public.categories (id, name, icon, color, sort) values ('household','Cleaning & Household','🧹','#eef2e6',6) on conflict (id) do nothing;

-- Products
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p9','Amul Toned Milk','500 ml',27,30,'🥛','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p10','Brown Bread','400 g',45,50,'🍞','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p11','Farm Eggs','6 pcs',66,78,'🥚','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p12','Amul Butter','100 g',56,60,'🧈','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p13','Paneer','200 g',89,99,'🧀','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p14','Curd (Dahi)','400 g',40,45,'🥣','dairy-bread',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p15','Lay''s Classic Salted','52 g',20,20,'🥔','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p16','Kurkure Masala Munch','90 g',20,20,'🌶️','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p17','Salted Peanuts','200 g',55,70,'🥜','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p18','Popcorn (Butter)','70 g',35,40,'🍿','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p19','Dark Chocolate','80 g',90,110,'🍫','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p20','Digestive Biscuits','250 g',45,55,'🍪','snacks',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p21','Coca-Cola','750 ml',40,45,'🥤','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p22','Orange Juice','1 L',99,120,'🧃','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p23','Mineral Water','1 L',20,22,'💧','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p24','Cold Coffee','180 ml',45,50,'☕','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p25','Green Tea','25 bags',150,199,'🍵','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p26','Fresh Lime Soda','300 ml',30,35,'🍋','beverages',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p27','Maggi Noodles','4 pack',55,60,'🍜','instant',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p28','Frozen Green Peas','500 g',85,100,'🫛','instant',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p29','Veg Momos','10 pcs',120,150,'🥟','instant',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p30','French Fries','420 g',99,130,'🍟','instant',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p31','Ready Poha Mix','200 g',45,55,'🍲','instant',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p32','Chocolate Muffin','2 pcs',60,75,'🧁','bakery',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p33','Fresh Croissant','1 pc',55,65,'🥐','bakery',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p34','Gulab Jamun','500 g',140,180,'🍮','bakery',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p35','Doughnut','1 pc',45,55,'🍩','bakery',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p36','Rasgulla Tin','1 kg',175,220,'🍥','bakery',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p37','Toothpaste','150 g',95,110,'🪥','personal',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p38','Handwash Refill','750 ml',99,145,'🧴','personal',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p39','Shampoo','340 ml',199,260,'🧴','personal',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p40','Bath Soap (4 pack)','4 x 100 g',120,160,'🧼','personal',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p41','Face Wash','100 ml',149,199,'🧴','personal',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p42','Dishwash Gel','750 ml',110,145,'🧽','household',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p43','Floor Cleaner','1 L',175,220,'🧹','household',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p44','Detergent Powder','1 kg',145,180,'🧺','household',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p45','Garbage Bags','30 pcs',99,130,'🗑️','household',50,true) on conflict (id) do nothing;
insert into public.products (id, name, unit, price, mrp, icon, category, stock, active) values ('p46','Toilet Cleaner','500 ml',89,110,'🚽','household',50,true) on conflict (id) do nothing;


-- Starter coupons (match the demo)
insert into public.coupons (code, type, value, min_order, category, active) values
  ('NISHA10','percent',10,199,'',true),
  ('FLAT30','flat',30,149,'',true),
  ('SNACK15','percent',15,99,'snacks',true)
on conflict (code) do nothing;
