-- Aggregate win count per player name (no auth, so the name itself is the identity).
create table public.player_wins (
  name_key text primary key,
  display_name text not null,
  wins int not null default 0,
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.player_wins to anon, authenticated;
grant all on public.player_wins to service_role;

alter table public.player_wins enable row level security;
create policy "player_wins_all" on public.player_wins for all using (true) with check (true);

-- Atomic upsert-increment so concurrent winners never clobber each other's count.
create or replace function public.increment_player_wins(p_name text)
returns int
language plpgsql
security invoker
as $$
declare
  v_key text := lower(trim(p_name));
  v_wins int;
begin
  insert into public.player_wins (name_key, display_name, wins, updated_at)
  values (v_key, trim(p_name), 1, now())
  on conflict (name_key) do update
    set wins = public.player_wins.wins + 1,
        display_name = excluded.display_name,
        updated_at = now()
  returning wins into v_wins;
  return v_wins;
end;
$$;

grant execute on function public.increment_player_wins(text) to anon, authenticated;
