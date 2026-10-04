-- =====================================================================
-- OPTIONAL: a few sample gifts so the family page has something to show
-- while you try things out. Only adds them to a list that is still empty.
-- Remove them later from the owner page (manage.html).
-- =====================================================================

insert into public.gifts (recipient, name, details, price, link, sort_order)
select v.recipient, v.name, v.details, v.price, v.link, v.sort_order
from (values
  ('clara', 'Cozy oversized blanket', 'Soft knit throw, big enough for the whole couch. Cream or sage, please — no bright colors.', '$35', 'https://example.com/blanket', 1),
  ('clara', 'A good mystery novel', 'Anything twisty. Bonus points for a hardcover.', '~$20', null, 2),
  ('clara', 'Winter candle set', 'Pine, cedar or cinnamon scents.', '$28', null, 3),
  ('clara', 'Loose-leaf tea sampler', null, '$18', null, 4),
  ('cameron', 'Wireless headphones', 'Over-ear, noise cancelling. Black.', '$90–120', 'https://example.com/headphones', 1),
  ('cameron', 'Bonsai pruning shears', 'Concave cutter, Japanese steel if possible.', '$30', null, 2),
  ('cameron', 'Fancy coffee beans', 'Whole bean, medium roast.', '$22', null, 3),
  ('cameron', 'Warm wool socks', 'Size L. Always welcome.', '$15', null, 4)
) as v(recipient, name, details, price, link, sort_order)
where not exists (select 1 from public.gifts g where g.recipient = v.recipient);
