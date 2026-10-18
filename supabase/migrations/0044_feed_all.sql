-- Home has two feeds (Ethan, October 2026): Following (get_feed, 0027: people you follow and your own posts, newest
-- first) and All: posts from everyone whose profile is public, most liked first, so someone who's just downloaded Gaffer
-- and isn't in a team yet has something to watch. All can be read before signing in (the app opens on it for a new
-- phone); a private profile's posts are never in it, and nobody blocked with you is either. The app puts posts this phone
-- hasn't seen before the ones it has, each half still most liked first.

create or replace function public.public_feed(p_offset integer default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.n desc, x.c desc), '[]'::jsonb) from (
    select private.post_json(p) as j, p.created_at as c,
      (select count(*) from public.post_likes l where l.post_id = p.id and l.liked) as n
    from public.posts p join public.profiles pr on pr.user_id = p.user_id
    where p.removed_at is null and not pr.private
      and (auth.uid() is null or not private.blocked(auth.uid(), p.user_id))
    order by n desc, p.created_at desc
    limit 40 offset greatest(coalesce(p_offset, 0), 0)) x where x.j is not null;
$$;

revoke all on function public.public_feed(integer) from public, anon, authenticated;
grant execute on function public.public_feed(integer) to anon, authenticated;
