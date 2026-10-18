-- Goal of the Week prize ("wins £50"): the amount for a week goes in gotw_prizes, in the dashboard, like gotw_sponsors.
-- No row, no prize shown. A week's prize is copied onto its winner row when the week is decided, so changing the table
-- later never rewrites what past winners were promised.

create table if not exists public.gotw_prizes (
  week date primary key,
  pence integer not null check (pence between 1 and 1000000)
);
alter table public.gotw_prizes enable row level security; -- filled in the dashboard

alter table public.gotw_winners add column if not exists prize_pence integer;

create or replace function private.gotw_settle() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare w date; b_id uuid; b_team uuid; b_votes integer;
begin
  for w in select distinct n.week from public.gotw_noms n
    where n.week < private.gotw_week() and not exists (select 1 from public.gotw_winners x where x.week = n.week) order by 1 loop
    b_id := null; b_team := null; b_votes := 0;
    select n.id, n.team_id, count(v.user_id)::integer into b_id, b_team, b_votes
      from public.gotw_noms n left join public.gotw_votes v on v.nom_id = n.id and v.week = w
      where n.week = w and n.removed_at is null
      group by n.id, n.team_id, n.created_at order by count(v.user_id) desc, n.created_at limit 1;
    insert into public.gotw_winners (week, nom_id, team_id, votes, sponsor, prize_pence)
    values (w, case when coalesce(b_votes, 0) > 0 then b_id end, case when coalesce(b_votes, 0) > 0 then b_team end, coalesce(b_votes, 0),
      (select s.name from public.gotw_sponsors s where s.week = w),
      (select p.pence from public.gotw_prizes p where p.week = w))
    on conflict (week) do nothing;
  end loop;
end $$;
revoke all on function private.gotw_settle() from public, anon, authenticated;

create or replace function public.gotw_board() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); w date := private.gotw_week(); last public.gotw_winners;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform private.gotw_settle();
  select * into last from public.gotw_winners x where x.week < w and x.nom_id is not null order by x.week desc limit 1;
  return jsonb_build_object(
    'week', w,
    'ends', (extract(epoch from ((w + 7)::timestamp at time zone 'Europe/London')) * 1000)::bigint,
    'sponsor', (select s.name from public.gotw_sponsors s where s.week = w),
    'prize', (select p.pence from public.gotw_prizes p where p.week = w),
    'voted', (select v.nom_id from public.gotw_votes v join public.gotw_noms n on n.id = v.nom_id and n.removed_at is null where v.week = w and v.user_id = uid),
    'votes', (select count(*) from public.gotw_votes v join public.gotw_noms n on n.id = v.nom_id and n.removed_at is null where v.week = w),
    'entries', coalesce((select jsonb_agg(private.gotw_entry(n) order by md5(n.id::text || uid::text)) from public.gotw_noms n where n.week = w and n.removed_at is null), '[]'::jsonb),
    'last', case when last.week is null then null else jsonb_build_object('week', last.week, 'votes', last.votes, 'sponsor', last.sponsor, 'prize', last.prize_pence, 'reel', last.reel,
      'notified', last.notified_at is not null, 'entry', (select private.gotw_entry(n) from public.gotw_noms n where n.id = last.nom_id and not n.pulled)) end);
end $$;
