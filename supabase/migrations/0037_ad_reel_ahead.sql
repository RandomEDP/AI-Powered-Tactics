-- Rewarded ads: the reel is made while the ad plays (Ethan asked). The phone picks the new reel's file name first and the ad
-- unlocks that name, so when the reel lands on the player's card it's already unlocked. ad_ticket (0035) only took the
-- player's current reel; now it also takes a name for a new reel in their own folder (<team>/players/<pid>/reel-<n>.mp4),
-- which save_player_reel would accept, named in the last week (the number is the time it was picked, in milliseconds, so an
-- old reel's name can't be asked for). A name that never becomes a reel unlocks nothing anyone can see.
create or replace function public.ad_ticket(p_code text, p_kind text, p_target text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare t public.teams; v_pid integer; v_id uuid; v_ms numeric;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into t from public.teams where code = upper(trim(p_code));
  if not found then return jsonb_build_object('error', 'no_team'); end if;
  if p_kind is distinct from 'reel' then return jsonb_build_object('error', 'not_allowed'); end if;
  select p.pid into v_pid from public.players p where p.team_id = t.id and p.user_id = auth.uid();
  if v_pid is null then return jsonb_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from public.player_reels r where r.team_id = t.id and r.pid = v_pid and r.path = p_target) then
    if coalesce(p_target, '') !~ ('^' || t.id::text || '/players/' || v_pid::text || '/reel-[0-9]{1,16}\.mp4$') then return jsonb_build_object('error', 'no_reel'); end if;
    v_ms := substring(p_target from '/reel-([0-9]+)\.mp4$')::numeric;
    if v_ms < extract(epoch from now()) * 1000 - 7 * 86400000 or v_ms > extract(epoch from now()) * 1000 + 86400000 then return jsonb_build_object('error', 'no_reel'); end if;
  end if;
  if exists (select 1 from public.ad_unlocks u where u.user_id = auth.uid() and u.team_id = t.id and u.kind = 'reel' and u.target = p_target and u.granted_at is not null)
    then return jsonb_build_object('error', 'not_needed'); end if;
  insert into public.ad_unlocks (team_id, user_id, kind, target) values (t.id, auth.uid(), 'reel', p_target) returning id into v_id;
  return jsonb_build_object('ticket', v_id);
end $$;
revoke all on function public.ad_ticket(text, text, text) from public, anon, authenticated;
grant execute on function public.ad_ticket(text, text, text) to authenticated;
