-- For gaffers: which of the team's claimed players have a phone signed up for notifications, so the rest can be chased.
create or replace function public.team_push(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.teams;
begin
  select * into t from public.teams where code = upper(trim(p_code));
  if not found or not private.is_organiser(t.id) then return null; end if;
  return coalesce((select jsonb_agg(p.pid order by p.pid) from public.players p
    where p.team_id = t.id and p.user_id is not null and exists (select 1 from public.push_tokens k where k.user_id = p.user_id)), '[]'::jsonb);
end $$;
revoke all on function public.team_push(text) from public, anon, authenticated;
grant execute on function public.team_push(text) to authenticated;
