-- The team pass: the Gaffer tier is paid for per team, not per player. Anyone on the team can buy it in the iPhone app
-- through Apple: "Pay for the month" (£4.99) covers the whole team for 30 days, and "Chip in" (69p) adds one player's
-- share, an eighth of a month, so eight chip-ins make a month. Both are one-off purchases, never subscriptions, so
-- nobody is charged again without choosing to. Each purchase adds its time to the team's "paid until"; a team that ran
-- out starts again from now.
--
-- The team-pass edge function checks each purchase with Apple (App Store Server API) before it counts, and is the only
-- thing that writes here (with the service role, through pass_credit below). The app reads it through team_pass(code).

create table if not exists public.team_pass (
  team_id uuid primary key references public.teams (id) on delete cascade,
  paid_until timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.team_pass enable row level security; -- no policies: only the functions below touch it

create table if not exists public.pass_purchases (
  transaction_id text primary key check (transaction_id ~ '^[0-9A-Za-z_-]{1,64}$'), -- Apple's transaction id: each counts once
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,                      -- who paid (null once they delete their account)
  product text not null check (product in ('month', 'chip')),
  hours integer not null check (hours > 0 and hours <= 24 * 31),
  environment text not null default 'Production' check (environment in ('Production', 'Sandbox', 'Xcode')),
  at timestamptz not null default now()
);
create index if not exists pass_purchases_team_idx on public.pass_purchases (team_id, at desc);
alter table public.pass_purchases enable row level security; -- no policies

-- Whether a team is paid up right now. For other SQL (the ads, the paid features) to ask.
create or replace function private.team_is_paid(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_pass where team_id = p_team and paid_until > now())
$$;
revoke all on function private.team_is_paid(uuid) from public, anon, authenticated;

-- The edge function, once Apple has said the purchase is real: adds its time to the team, once per transaction.
-- Returns { added, until } (added false when that transaction was already counted, for this team).
create or replace function public.pass_credit(p_team uuid, p_user uuid, p_tx text, p_product text, p_hours integer, p_env text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare was public.pass_purchases; n integer; u timestamptz;
begin
  select * into was from public.pass_purchases where transaction_id = p_tx;
  if found then
    if was.team_id <> p_team then raise exception 'That purchase was for another team' using errcode = '22023'; end if;
    select paid_until into u from public.team_pass where team_id = p_team;
    return jsonb_build_object('added', false, 'until', (extract(epoch from u) * 1000)::bigint);
  end if;
  insert into public.pass_purchases (transaction_id, team_id, user_id, product, hours, environment)
    values (p_tx, p_team, p_user, p_product, p_hours, p_env) on conflict (transaction_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return public.pass_credit(p_team, p_user, p_tx, p_product, p_hours, p_env); end if; -- (the same purchase claimed twice at once)
  insert into public.team_pass (team_id, paid_until) values (p_team, now() + make_interval(hours => p_hours))
    on conflict (team_id) do update set paid_until = greatest(public.team_pass.paid_until, now()) + make_interval(hours => p_hours), updated_at = now()
    returning paid_until into u;
  return jsonb_build_object('added', true, 'until', (extract(epoch from u) * 1000)::bigint);
end $$;
revoke all on function public.pass_credit(uuid, uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.pass_credit(uuid, uuid, text, text, integer, text) to service_role;

-- Anyone with the team's code: whether it's paid, until when, and who paid for the current stretch (first names as the
-- squad knows them, else their username, else "Someone"), newest first. Never amounts of money or anything about Apple.
create or replace function public.team_pass(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams; u timestamptz;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return null; end if;
  select paid_until into u from public.team_pass where team_id = t.id;
  return jsonb_build_object(
    'paid', u is not null and u > now(),
    'until', case when u is null then null else (extract(epoch from u) * 1000)::bigint end,
    'chips', coalesce((select jsonb_agg(x order by (x->>'at')::bigint desc) from (
      select jsonb_build_object('who', coalesce(
          (select nullif(p.name, '') from public.players p where p.team_id = t.id and p.user_id = b.user_id order by p.pid limit 1),
          (select f.username from public.profiles f where f.user_id = b.user_id), 'Someone'),
        'kind', b.product, 'at', (extract(epoch from b.at) * 1000)::bigint, 'me', b.user_id is not null and b.user_id = auth.uid()) as x
      from public.pass_purchases b
      where b.team_id = t.id and b.at > coalesce(u, now()) - interval '62 days'
      order by b.at desc limit 30) s), '[]'::jsonb));
end $$;
revoke all on function public.team_pass(text) from public, anon, authenticated;
grant execute on function public.team_pass(text) to anon, authenticated;
