-- Your own short clips (Ethan, October 2026: "upload custom short clips to Gaffer, max 30 seconds long, and post them to
-- your profile / feed"). A video from your phone, 30 seconds at most, goes straight from the phone to Cloudflare R2 (the
-- clip-store function gives an upload link into your own folder, "users/<your account>/"), then becomes a post of kind
-- 'own'. It isn't in any team, so posts.team_id may be empty for it. Everything else about posts stays as it was: who can
-- see one follows who can see your profile, it's in Following and All, and it can be liked, commented on, tagged, taken
-- down by you and reported to Gaffer.

alter table public.posts alter column team_id drop not null;
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('clip', 'reel', 'own'));
alter table public.posts add column if not exists dur real check (dur is null or (dur > 0 and dur <= 31));
alter table public.posts drop constraint if exists posts_team_check;
alter table public.posts add constraint posts_team_check check (team_id is not null or kind = 'own');

-- One post as the app shows it. As 0039, with the team found by a left join (an own clip has none) and an own clip's video.
create or replace function private.post_json(p public.posts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'caption', p.caption, 'at', (extract(epoch from p.created_at) * 1000)::bigint,
    'username', pr.username, 'name', pr.name, 'mine', p.user_id = auth.uid(),
    'team', t.name, 'short', t.short, 'color', t.color,
    'video', case when p.kind = 'reel' then jsonb_build_object('path', p.path, 'store', p.store, 'label', 'Player reel')
      when p.kind = 'own' then jsonb_build_object('path', p.path, 'store', p.store, 'label', 'Own clip', 'dur', p.dur)
      else (select jsonb_build_object('path', c.path, 'vpath', c.vpath, 'store', c.store, 'label', c.label, 'dur', c.dur) from public.clips c where c.game_id = p.game_id and c.at = p.at order by c.seq limit 1) end,
    'likes', (select count(*) from public.post_likes l where l.post_id = p.id and l.liked),
    'liked', exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = auth.uid() and l.liked),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('username', tp.username, 'name', tp.name) order by tp.username)
      from public.post_tags g join public.profiles tp on tp.user_id = g.user_id
      where g.post_id = p.id and not g.removed and (auth.uid() is null or not private.blocked(auth.uid(), g.user_id))), '[]'::jsonb),
    'tagged_me', exists (select 1 from public.post_tags g where g.post_id = p.id and g.user_id = auth.uid() and not g.removed),
    'comments', (select count(*) from public.post_comments m where m.post_id = p.id and m.removed_at is null
      and (auth.uid() is null or not private.blocked(auth.uid(), m.user_id))))
  from public.profiles pr left join public.teams t on t.id = p.team_id where pr.user_id = p.user_id;
$$;
revoke all on function private.post_json(public.posts) from public, anon, authenticated;

-- Post a clip you've uploaded: p_path is its file in your own folder ("users/<your account>/<name>.mp4", already in R2),
-- p_dur its length in seconds (30 at most). Returns {id} or {error}: 'no_profile' (pick a username first), 'not_yours'
-- (not a file in your folder), 'too_long', 'too_many' (30 posts a day, counting every kind).
create or replace function public.create_own_post(p_path text, p_dur real, p_caption text default '') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_cap text := left(trim(regexp_replace(coalesce(p_caption, ''), '\s+', ' ', 'g')), 300); new_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where user_id = uid) then return jsonb_build_object('error', 'no_profile'); end if;
  if p_path is null or left(p_path, char_length('users/' || uid::text || '/')) <> 'users/' || uid::text || '/' or p_path like '%..%'
    or p_path !~ '^users/[0-9a-f-]+/[A-Za-z0-9_-]{1,80}\.mp4$' then return jsonb_build_object('error', 'not_yours'); end if;
  if p_dur is null or p_dur <= 0 or p_dur > 30.5 then return jsonb_build_object('error', 'too_long'); end if;
  if (select count(*) from public.posts where user_id = uid and created_at > now() - interval '1 day') >= 30 then return jsonb_build_object('error', 'too_many'); end if;
  if exists (select 1 from public.posts where path = p_path and removed_at is null) then return jsonb_build_object('error', 'not_yours'); end if;
  insert into public.posts (user_id, team_id, kind, path, store, dur, caption)
  values (uid, null, 'own', p_path, 'r2', p_dur, v_cap)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

revoke all on function public.create_own_post(text, real, text) from public, anon, authenticated;
grant execute on function public.create_own_post(text, real, text) to authenticated;
