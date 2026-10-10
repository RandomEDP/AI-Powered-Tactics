-- A claimed player sets (or clears) their own shirt number.
create or replace function public.set_my_number(p_code text, p_number integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_number is not null and (p_number < 0 or p_number > 99) then return false; end if;
  update public.players p set shirt_number = p_number from public.teams t where t.id = p.team_id and t.code = upper(trim(p_code)) and p.user_id = uid;
  return found;
end $$;
revoke all on function public.set_my_number(text, integer) from public, anon, authenticated;
grant execute on function public.set_my_number(text, integer) to authenticated;
