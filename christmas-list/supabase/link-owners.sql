-- =====================================================================
-- Link the two owner logins to their lists.
--
-- 1. Create both users first: Supabase > Authentication > Users > Add user.
-- 2. Replace the two email addresses below with the ones you used.
-- 3. Paste into SQL Editor > New query > Run.
--
-- The result table at the end should show both people. If one is missing,
-- the email doesn't match a user exactly.
-- =====================================================================

insert into public.list_owners (user_id, recipient)
select u.id, 'clara' from auth.users u where lower(u.email) = lower('clara@example.com')
on conflict (user_id) do update set recipient = excluded.recipient;

insert into public.list_owners (user_id, recipient)
select u.id, 'cameron' from auth.users u where lower(u.email) = lower('cameron@example.com')
on conflict (user_id) do update set recipient = excluded.recipient;

select o.recipient, u.email
from public.list_owners o
join auth.users u on u.id = o.user_id
order by o.recipient;
