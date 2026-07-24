-- Rooms that never reach a 2nd player expire after 5 minutes: a cron job
-- sweeps them away so the invite link stops working (falls back to "sala
-- não encontrada"). The client also enforces this live, see room.$id.tsx.
create extension if not exists pg_cron;

select cron.schedule(
  'expire-waiting-rooms',
  '* * * * *',
  $$delete from public.rooms where status = 'waiting' and created_at < now() - interval '5 minutes';$$
);
