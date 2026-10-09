-- Lets a signed-in organiser delete their own account from inside the app (required by the App Store).
-- Teams they organise on their own are deleted with it; teams with other organisers carry on without them.
create or replace function public.delete_my_account() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  with solo as (
    select m.team_id from public.team_members m
    where m.user_id = uid
      and not exists (select 1 from public.team_members o where o.team_id = m.team_id and o.user_id <> uid)
  ), gone as (delete from public.teams t using solo where t.id = solo.team_id returning t.id)
  select count(*) into n from gone;
  delete from auth.users where id = uid; -- also removes their organiser memberships
  return n;
end $$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
