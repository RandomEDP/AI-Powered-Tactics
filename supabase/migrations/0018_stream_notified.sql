-- "We're live" is now sent by the server, once per stream, when any phone on the team sees the picture getting through
-- (the gaffer's own phone may be busy in GoPro Quik or an iPhone streaming app). This records when it went, so a second
-- phone seeing the same stream doesn't send it again; getting the link ready for a new game clears it.
alter table public.team_streams add column if not exists notified_at timestamptz;
