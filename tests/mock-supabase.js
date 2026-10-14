// In-browser stand-in for supabase-js, backed by localStorage so several tabs share one "database".
// Implements just what the app uses, with the same access rules as the real policies and functions.
(function () {
  const KEY = '__mockdb';
  const TABLES = ['teams', 'team_members', 'players', 'games', 'game_players', 'game_events', 'live_matches', 'goal_queue', 'users', 'fixtures', 'fixture_votes', 'clips', 'messages', 'reports', 'join_requests', 'team_streams', 'profiles', 'follows', 'blocks', 'profile_reports', 'clip_hides'];
  // tests/lib.mjs gives every phone its own browser profile, like real devices; then the database lives with the test runner (window.__mockRemote).
  const REMOTE = window.__mockRemote || null;
  const xhr = (method, body) => { const x = new XMLHttpRequest(); x.open(method, REMOTE, false); x.send(body || null); return x.responseText; };
  const load = () => { const d = JSON.parse((REMOTE ? xhr('GET') : localStorage.getItem(KEY)) || '{}'); TABLES.forEach((t) => { d[t] = d[t] || []; }); return d; };
  const store = (d) => { if (REMOTE) xhr('PUT', JSON.stringify(d)); else localStorage.setItem(KEY, JSON.stringify(d)); };
  const code = (n) => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
  const uid = () => (sessionStorage.getItem('__mockuser') || null);
  const isOrg = (d, team) => !!uid() && d.team_members.some((m) => m.team_id === team && m.user_id === uid());
  // (0028) someone joining a team follows everyone on it, and they follow them, accepted; not anyone either has blocked
  const followMates = (d, team, user) => { d.follows = d.follows || []; d.blocks = d.blocks || [];
    const us = [...new Set(d.players.filter((p) => p.team_id === team && p.user_id).map((p) => p.user_id).concat(d.team_members.filter((m) => m.team_id === team).map((m) => m.user_id)))];
    us.filter((o) => o !== user && !d.blocks.some((x) => (x.blocker === o && x.blocked === user) || (x.blocker === user && x.blocked === o))).forEach((o) => [[user, o], [o, user]].forEach(([a1, b1]) => {
      const f = d.follows.find((x) => x.follower === a1 && x.followee === b1); if (f) f.status = 'accepted'; else d.follows.push({ follower: a1, followee: b1, status: 'accepted', at: Date.now() }); })); };
  const teamOf = (d, table, row) => table === 'teams' ? row.id : (row.team_id || (d.games.find((g) => g.id === row.game_id) || {}).team_id);
  const ok = (data) => Promise.resolve({ data, error: null });
  const fail = (message, code) => Promise.resolve({ data: null, error: { message, code } });
  const heard = []; window.__rtRecv = (m) => heard.forEach((cb) => cb({ data: m }));
  const bc = REMOTE ? { postMessage: (m) => { if (!window.__offline) window.__rtSend(m); }, addEventListener: (n, cb) => heard.push(cb) } : new BroadcastChannel('__mockrt');
  window.__mockCalls = [];
  function rpc(name, a) {
    if (window.__offline) return fail('Failed to fetch', '');
    const d = load(); window.__mockCalls.push('rpc:' + name);
    if (name === 'get_team') {
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t) return ok(null);
      const org = isOrg(d, t.id);
      return ok({ team: Object.assign({}, t, { organiser_code: org ? t.organiser_code : null }), is_organiser: org,
        my_pid: (d.players.find((p) => p.team_id === t.id && uid() && p.user_id === uid()) || {}).pid ?? null,
        players: d.players.filter((p) => p.team_id === t.id).sort((x, y) => x.pid - y.pid).map((p) => ({ pid: p.pid, name: p.name, position: p.position || null, number: p.shirt_number ?? null, claimed: !!p.user_id, me: !!p.user_id && p.user_id === uid(),
          gaffer: !!p.user_id && d.team_members.some((mm) => mm.team_id === t.id && mm.user_id === p.user_id), last_name: org || p.user_id === uid() ? p.last_name || null : null })),
        games: d.games.filter((g) => g.team_id === t.id).sort((x, y) => x.seq - y.seq).map((g) => Object.assign({}, g, {
          players: d.game_players.filter((p) => p.game_id === g.id).map((p) => ({ pid: p.pid, mins: p.mins, goals: p.goals, assists: p.assists, scored_on: p.scored_on ?? null, conceded: p.conceded ?? null })),
          events: d.game_events.filter((e) => e.game_id === g.id).sort((x, y) => x.seq - y.seq) })),
        fixtures: d.fixtures.filter((f) => f.team_id === t.id && (f.status || 'open') === 'open').sort((x, y) => x.ko_at - y.ko_at).map((f) => Object.assign({}, f, { votes: d.fixture_votes.filter((v) => v.fixture_id === f.id).map((v) => ({ pid: v.pid, choice: v.choice })) })),
        clips: d.clips.filter((c) => c.team_id === t.id).map((c) => { const off = (d.clip_hides || []).filter((h) => h.game_id === c.game_id && h.at === c.at).map((h) => h.pid).sort((x, y) => x - y);
          return Object.assign({}, c, { pids: (c.pids || []).filter((x) => off.indexOf(x) < 0), off }); }),
        reels: (d.player_reels || []).filter((x) => x.team_id === t.id && x.path).sort((x, y) => x.pid - y.pid).map((x) => ({ pid: x.pid, path: x.path, store: x.store || null, marks: x.marks || [], made_at: x.made_at })),
        live: (d.live_matches.find((l) => l.team_id === t.id) || {}).state || null });
    }
    if (name === 'create_team') {
      if (!uid()) return fail('permission denied for function create_team', '42501');
      const t = { id: crypto.randomUUID(), code: code(6), organiser_code: code(10), name: a.p_name, short: a.p_short, color: a.p_color, crest: a.p_crest, settings: a.p_settings, followers_can_score: true };
      d.teams.push(t); d.team_members.push({ team_id: t.id, user_id: uid() });
      (a.p_players || []).forEach((p) => d.players.push({ team_id: t.id, pid: p.pid, name: p.name }));
      store(d); return ok({ id: t.id, code: t.code, organiser_code: t.organiser_code });
    }
    if (name === 'join_as_organiser') {
      if (!uid()) return fail('Sign in first', '42501');
      const t = d.teams.find((x) => x.organiser_code === a.p_organiser_code); if (!t) return ok(null);
      if (!isOrg(d, t.id)) { d.team_members.push({ team_id: t.id, user_id: uid() }); followMates(d, t.id, uid()); } store(d); return ok(t.code);
    }
    if (name === 'new_organiser_code') { const t = d.teams.find((x) => x.id === a.p_team); if (!t || !isOrg(d, t.id)) return fail('no', '42501'); t.organiser_code = code(10); store(d); return ok(t.organiser_code); }
    if (name === 'claim_player') {
      if (!uid()) return fail('Sign in first', '42501');
      const t = d.teams.find((x) => x.code === a.p_code); if (!t) return ok('missing');
      const p = d.players.find((x) => x.team_id === t.id && x.pid === a.p_pid); if (!p) return ok('missing');
      if (p.user_id && p.user_id !== uid()) return ok('taken');
      d.players.forEach((x) => { if (x.team_id === t.id && x.user_id === uid()) x.user_id = null; });
      if (['fwd', 'def', 'mix', 'gk'].indexOf(a.p_position) < 0) return ok('position');
      const was = p.user_id; p.user_id = uid(); p.last_name = a.p_last_name || null; p.position = a.p_position; if (was !== uid()) followMates(d, t.id, uid()); store(d); return ok('ok');
    }
    // ---------- profiles and following (0023), as the real functions behave
    const PEOPLE = ['username_status', 'set_profile', 'my_profile', 'find_people', 'get_profile', 'my_clips', 'set_pins', 'follow', 'unfollow', 'answer_follow', 'my_follows', 'my_feed', 'block_user', 'my_blocks', 'report_user', 'search_teams', 'view_team', 'create_post', 'remove_post', 'like_post', 'report_post', 'get_feed', 'user_posts', 'my_reels', 'team_people', 'tag_post', 'untag_post', 'user_tagged'];
    if (PEOPLE.includes(name)) {
      const RESERVED = d.reserved_usernames || ['edp', 'ethan', 'ethandp', 'e_d_p_1', 'gaffer', 'admin', 'support', 'official'].map((h) => ({ handle: h, user_id: null }));
      const prof = (u) => d.profiles.find((p) => p.user_id === u), byName = (n) => d.profiles.find((p) => p.username.toLowerCase() === String(n || '').trim().toLowerCase());
      const blocked = (a, b) => d.blocks.some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));
      const fol = (a, b) => (d.follows.find((f) => f.follower === a && f.followee === b) || {}).status || null;
      const status = (n, who) => !/^[A-Za-z0-9_]{3,20}$/.test(n || '') ? 'invalid' : RESERVED.some((r) => r.handle === n.toLowerCase() && (r.user_id == null || r.user_id !== who)) ? 'reserved' : d.profiles.some((p) => p.username.toLowerCase() === n.toLowerCase() && p.user_id !== who) ? 'taken' : 'ok';
      const inTeam = (team) => d.players.some((p) => p.team_id === team && p.user_id === uid()) || d.team_members.some((m) => m.team_id === team && m.user_id === uid());
      const when = (g) => g.finished_at || 0;
      const houseOf = (g, pid) => g.house ? { a: g.house.a, b: g.house.b, side: pid != null && g.house.side ? g.house.side[pid] || null : null } : null;
      const clipsOf = (u) => { const out = []; d.players.filter((p) => p.user_id === u).forEach((p) => { const t = d.teams.find((x) => x.id === p.team_id) || {};
        d.clips.filter((c) => c.team_id === p.team_id && (c.pids || []).includes(p.pid) && c.at != null && !(d.clip_hides || []).some((h) => h.game_id === c.game_id && h.at === c.at && h.pid === p.pid)).forEach((c) => { const g = d.games.find((x) => x.id === c.game_id) || {};
          out.push({ game_id: c.game_id, at: c.at, seq: c.seq, path: c.path, vpath: c.vpath || null, store: c.store || null, label: c.label, dur: c.dur, team: t.short, team_name: t.name, color: t.color, opp: g.opp, us: g.us, them: g.them, house: houseOf(g, p.pid), when: when(g) }); }); });
        return out.sort((a, b) => b.at - a.at); };
      const seeable = (p) => p.user_id === uid() || !p.private || fol(uid(), p.user_id) === 'accepted';
      const counts = (u) => ({ followers: d.follows.filter((f) => f.followee === u && f.status === 'accepted').length, following: d.follows.filter((f) => f.follower === u && f.status === 'accepted').length });
      if (name === 'username_status') return ok(status(String(a.p_username || '').trim(), uid()));
      if (!uid()) return fail('Sign in first', '42501');
      const mine = prof(uid());
      if (name === 'set_profile') {
        const u = String(a.p_username || '').trim(), st = status(u, uid()); if (st !== 'ok') return ok(st);
        const row = { user_id: uid(), username: u, name: String(a.p_name || '').replace(/\s+/g, ' ').trim().slice(0, 40), private: !!a.p_private };
        if (mine) Object.assign(mine, row); else d.profiles.push(Object.assign({ pins: [] }, row));
        if (!a.p_private) d.follows.forEach((f) => { if (f.followee === uid()) f.status = 'accepted'; });
        store(d); return ok('ok');
      }
      if (name === 'my_profile') return ok(mine ? Object.assign({ username: mine.username, name: mine.name, private: mine.private, pins: mine.pins || [], requests: d.follows.filter((f) => f.followee === uid() && f.status === 'pending').length }, counts(uid())) : null);
      if (name === 'find_people') { const t = String(a.p_query || '').trim().toLowerCase(); if (t.length < 2) return ok([]);
        return ok(d.profiles.filter((p) => (p.username.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)) && !blocked(uid(), p.user_id)).slice(0, 20)
          .map((p) => ({ username: p.username, name: p.name, private: p.private, me: p.user_id === uid(), follow: fol(uid(), p.user_id) }))); }
      if (name === 'get_profile') {
        const p = byName(a.p_username); if (!p || blocked(uid(), p.user_id)) return ok(null);
        const see = seeable(p), out = Object.assign({ username: p.username, name: p.name, private: p.private, me: p.user_id === uid(), can_see: see, follow: fol(uid(), p.user_id), follows_me: fol(p.user_id, uid()) }, counts(p.user_id));
        if (!see) return ok(out);
        const pls = d.players.filter((x) => x.user_id === p.user_id), rows = [];
        pls.forEach((pl) => d.game_players.filter((gp) => gp.pid === pl.pid).forEach((gp) => { const g = d.games.find((x) => x.id === gp.game_id && x.team_id === pl.team_id); if (g) rows.push({ g, gp, t: d.teams.find((x) => x.id === pl.team_id) || {} }); }));
        const won = (r) => !r.g.house ? r.g.us > r.g.them : (r.g.house.side || {})[r.gp.pid] === 'b' ? r.g.them > r.g.us : r.g.us > r.g.them;
        const cl = clipsOf(p.user_id), pins = p.pins || [];
        return ok(Object.assign(out, {
          teams: pls.map((pl) => d.teams.find((x) => x.id === pl.team_id)).filter(Boolean).map((t) => ({ id: t.listed !== false ? t.id : null, name: t.name, short: t.short, color: t.color, crest: t.crest || null })),
          stats: { games: rows.length, goals: rows.reduce((n, r) => n + (r.gp.goals || 0), 0), assists: rows.reduce((n, r) => n + (r.gp.assists || 0), 0), wins: rows.filter(won).length },
          results: rows.sort((x, y) => when(y.g) - when(x.g)).slice(0, 10).map((r) => ({ team: r.t.short, team_name: r.t.name, opp: r.g.opp, us: r.g.us, them: r.g.them, friendly: !!r.g.friendly, house: houseOf(r.g, r.gp.pid), goals: r.gp.goals || 0, assists: r.gp.assists || 0, when: when(r.g) })),
          clips: pins.map((v) => cl.find((c) => c.game_id === v.g && c.at === v.at)).filter(Boolean) }));
      }
      if (name === 'my_clips') return ok(clipsOf(uid()));
      // posts (0027)
      d.posts = d.posts || []; d.post_likes = d.post_likes || []; d.post_reports = d.post_reports || [];
      const postJson = (x) => { const pr = prof(x.user_id), t = d.teams.find((y) => y.id === x.team_id) || {}; if (!pr) return null;
        const c = x.kind === 'clip' ? d.clips.filter((y) => y.game_id === x.game_id && y.at === x.at).sort((a1, b1) => a1.seq - b1.seq)[0] : null;
        return { id: x.id, kind: x.kind, caption: x.caption, at: x.created_at, username: pr.username, name: pr.name, mine: x.user_id === uid(), team: t.name, short: t.short, color: t.color,
          video: x.kind === 'reel' ? { path: x.path, store: x.store, label: 'Player reel' } : c ? { path: c.path, vpath: c.vpath || null, store: c.store || null, label: c.label, dur: c.dur } : null,
          likes: d.post_likes.filter((l) => l.post_id === x.id && l.liked).length, liked: d.post_likes.some((l) => l.post_id === x.id && l.user_id === uid() && l.liked),
          tags: (d.post_tags || []).filter((g) => g.post_id === x.id && !g.removed && !blocked(uid(), g.user_id)).map((g) => prof(g.user_id)).filter(Boolean).map((tp) => ({ username: tp.username, name: tp.name })).sort((p1, p2) => p1.username < p2.username ? -1 : 1),
          tagged_me: (d.post_tags || []).some((g) => g.post_id === x.id && g.user_id === uid() && !g.removed) }; };
      // (0028) the squad's usernames; tags
      if (name === 'team_people') { const t = d.teams.find((x) => x.code === String(a.p_code || '').trim().toUpperCase());
        return ok(t ? d.players.filter((p) => p.team_id === t.id && p.user_id && prof(p.user_id) && !blocked(uid(), p.user_id)).sort((p1, p2) => p1.pid - p2.pid).map((p) => ({ pid: p.pid, username: prof(p.user_id).username })) : []); }
      if (name === 'tag_post') { const x = d.posts.find((y) => y.id === a.p_id && y.user_id === uid() && !y.removed_at); if (!x) return ok(null); d.post_tags = d.post_tags || [];
        const add = [...new Set((Array.isArray(a.p_tags) ? a.p_tags : []).map((n) => byName(n)).filter((pr) => pr && pr.user_id !== uid() && !blocked(uid(), pr.user_id)).map((pr) => pr.user_id))].filter((u) => !d.post_tags.some((g) => g.post_id === x.id && g.user_id === u));
        if (d.post_tags.filter((g) => g.post_id === x.id).length + add.length > 10) return fail('Up to 10 people a post', '22023');
        add.forEach((u) => d.post_tags.push({ post_id: x.id, user_id: u, removed: false })); store(d); return ok(d.post_tags.filter((g) => g.post_id === x.id && !g.removed).length); }
      if (name === 'untag_post') { const g = (d.post_tags || []).find((y) => y.post_id === a.p_id && y.user_id === uid() && !y.removed); if (!g) return ok(false); g.removed = true; store(d); return ok(true); }
      if (name === 'user_tagged') { const pr = byName(a.p_username); if (!pr || blocked(uid(), pr.user_id) || !seeable(pr)) return ok(null);
        return ok(d.posts.filter((x) => !x.removed_at && (d.post_tags || []).some((g) => g.post_id === x.id && g.user_id === pr.user_id && !g.removed) && prof(x.user_id) && seeable(prof(x.user_id)) && !blocked(uid(), x.user_id)).sort((x, y) => y.created_at - x.created_at).map(postJson).filter((x) => x)); }
      const live = (x) => !x.removed_at;
      if (name === 'create_post') { if (!mine) return ok({ error: 'no_profile' }); let team = null, path = null, st = null;
        if (a.p_kind === 'clip') { const c = clipsOf(uid()).find((y) => y.game_id === a.p_game && y.at === a.p_at); if (c) team = (d.clips.find((y) => y.game_id === c.game_id && y.at === c.at) || {}).team_id; }
        else if (a.p_kind === 'reel') { const r = (d.player_reels || []).find((y) => y.team_id === a.p_team && y.path && d.players.some((pl) => pl.team_id === y.team_id && pl.pid === y.pid && pl.user_id === uid())); if (r) { team = r.team_id; path = r.path; st = r.store; } }
        if (!team) return ok({ error: 'not_yours' });
        const row = { id: crypto.randomUUID(), user_id: uid(), team_id: team, kind: a.p_kind, game_id: a.p_kind === 'clip' ? a.p_game : null, at: a.p_kind === 'clip' ? a.p_at : null, path, store: st, caption: String(a.p_caption || '').replace(/\s+/g, ' ').trim().slice(0, 300), created_at: Date.now() + d.posts.length, removed_at: null };
        d.posts.push(row); store(d); return ok({ id: row.id }); }
      if (name === 'remove_post') { const x = d.posts.find((y) => y.id === a.p_id && y.user_id === uid() && live(y)); if (!x) return ok(false); x.removed_at = Date.now(); store(d); return ok(true); }
      if (name === 'like_post') { const x = d.posts.find((y) => y.id === a.p_id && live(y)); const au = x && prof(x.user_id); if (!x || !au || !seeable(au) || blocked(uid(), x.user_id)) return ok(null);
        let l = d.post_likes.find((y) => y.post_id === x.id && y.user_id === uid()); if (!l) { l = { post_id: x.id, user_id: uid() }; d.post_likes.push(l); } l.liked = a.p_like !== false; store(d);
        return ok({ likes: d.post_likes.filter((y) => y.post_id === x.id && y.liked).length, liked: l.liked }); }
      if (name === 'report_post') { const x = d.posts.find((y) => y.id === a.p_id); if (!x) return ok(false); const r = d.post_reports.find((y) => y.post_id === x.id && y.user_id === uid());
        if (r) r.reason = String(a.p_reason || ''); else d.post_reports.push({ post_id: x.id, user_id: uid(), reason: String(a.p_reason || '') }); store(d); return ok(true); }
      if (name === 'get_feed') return ok(d.posts.filter((x) => live(x) && (x.user_id === uid() || fol(uid(), x.user_id) === 'accepted') && !blocked(uid(), x.user_id)).sort((x, y) => y.created_at - x.created_at).slice(0, 20).map(postJson).filter((x) => x));
      if (name === 'user_posts') { const pr = byName(a.p_username); if (!pr || blocked(uid(), pr.user_id) || !seeable(pr)) return ok(null);
        return ok(d.posts.filter((x) => live(x) && x.user_id === pr.user_id).sort((x, y) => y.created_at - x.created_at).map(postJson).filter((x) => x)); }
      if (name === 'my_reels') return ok((d.player_reels || []).filter((r) => r.path && d.players.some((pl) => pl.team_id === r.team_id && pl.pid === r.pid && pl.user_id === uid()))
        .map((r) => { const t = d.teams.find((y) => y.id === r.team_id) || {}; return { team_id: r.team_id, team: t.name, short: t.short, path: r.path, store: r.store || null, moments: (r.marks || []).length, made_at: r.made_at }; }));
      if (name === 'search_teams') { const t = String(a.p_query || '').trim().toLowerCase(); if (t.length < 2) return ok([]);
        return ok(d.teams.filter((x) => x.listed !== false && (x.name.toLowerCase().includes(t) || (x.short || '').toLowerCase().includes(t))).slice(0, 20)
          .map((x) => ({ id: x.id, name: x.name, short: x.short, color: x.color, crest: x.crest || null, players: d.players.filter((p) => p.team_id === x.id).length, games: d.games.filter((g) => g.team_id === x.id).length }))); }
      if (name === 'view_team') { const t = d.teams.find((x) => x.id === a.p_team); if (!t || !(t.listed !== false || inTeam(t.id))) return ok(null);
        const gps = (pid) => d.game_players.filter((gp) => gp.pid === pid && d.games.some((g) => g.id === gp.game_id && g.team_id === t.id));
        return ok({ team: { id: t.id, name: t.name, short: t.short, color: t.color, crest: t.crest || null }, mine: inTeam(t.id),
          players: d.players.filter((p) => p.team_id === t.id).sort((x, y) => x.pid - y.pid).map((p) => { const pr = p.user_id && prof(p.user_id); return { pid: p.pid, name: p.name, number: p.shirt_number ?? null, position: p.position || null,
            username: pr && !blocked(uid(), p.user_id) ? pr.username : null, games: gps(p.pid).length, goals: gps(p.pid).reduce((n, x) => n + (x.goals || 0), 0), assists: gps(p.pid).reduce((n, x) => n + (x.assists || 0), 0) }; }),
          games: d.games.filter((g) => g.team_id === t.id).sort((x, y) => when(y) - when(x)).slice(0, 20).map((g) => ({ id: g.id, opp: g.opp, us: g.us, them: g.them, friendly: !!g.friendly, tournament: g.tournament || null,
            house: g.house ? { a: g.house.a, b: g.house.b } : null, when: when(g), scorers: d.game_players.filter((gp) => gp.game_id === g.id && gp.goals > 0).sort((x, y) => y.goals - x.goals || x.pid - y.pid).map((gp) => ({ pid: gp.pid, goals: gp.goals })) })),
          clips: d.clips.filter((c) => c.team_id === t.id && c.at != null).sort((x, y) => y.at - x.at).slice(0, 12).map((c) => ({ game_id: c.game_id, at: c.at, path: c.path, vpath: c.vpath || null, store: c.store || null, label: c.label, dur: c.dur })) }); }
      if (name === 'set_pins') { if (!mine) return ok('no_profile'); const list = a.p_pins || []; if (list.length > 3) return ok('too_many'); const cl = clipsOf(uid());
        if (!list.every((v) => cl.some((c) => c.game_id === v.g && c.at === +v.at))) return ok('not_yours'); mine.pins = list.map((v) => ({ g: v.g, at: +v.at })); store(d); return ok('ok'); }
      if (name === 'follow') { if (!mine) return ok('no_profile'); const p = byName(a.p_username); if (!p || blocked(uid(), p.user_id)) return ok('missing'); if (p.user_id === uid()) return ok('self');
        let f = d.follows.find((x) => x.follower === uid() && x.followee === p.user_id); if (!f) { f = { follower: uid(), followee: p.user_id, status: p.private ? 'pending' : 'accepted', at: Date.now() }; d.follows.push(f); } else if (f.status !== 'accepted') f.status = p.private ? 'pending' : 'accepted';
        store(d); return ok(f.status); }
      if (name === 'unfollow') { const p = byName(a.p_username); const n = d.follows.length; d.follows = d.follows.filter((f) => !(p && f.follower === uid() && f.followee === p.user_id)); store(d); return ok(d.follows.length < n); }
      if (name === 'answer_follow') { const p = byName(a.p_username); if (!p) return ok(false); const f = d.follows.find((x) => x.follower === p.user_id && x.followee === uid()); if (!f) return ok(false);
        if (a.p_accept) f.status = 'accepted'; else d.follows = d.follows.filter((x) => x !== f); store(d); return ok(true); }
      if (name === 'my_follows') { const pub = (u) => { const p = prof(u) || {}; return { username: p.username, name: p.name }; };
        return ok({ requests: d.follows.filter((f) => f.followee === uid() && f.status === 'pending').map((f) => pub(f.follower)),
          followers: d.follows.filter((f) => f.followee === uid() && f.status === 'accepted').map((f) => pub(f.follower)),
          following: d.follows.filter((f) => f.follower === uid()).map((f) => Object.assign(pub(f.followee), { status: f.status })) }); }
      if (name === 'my_feed') {
        const people = d.follows.filter((f) => f.follower === uid() && f.status === 'accepted' && !blocked(uid(), f.followee)).map((f) => prof(f.followee)).filter(Boolean), played = [];
        people.forEach((pe) => d.players.filter((pl) => pl.user_id === pe.user_id).forEach((pl) => d.game_players.filter((gp) => gp.pid === pl.pid).forEach((gp) => { const g = d.games.find((x) => x.id === gp.game_id && x.team_id === pl.team_id);
          if (g && !inTeam(g.team_id)) played.push({ g, pid: pl.pid, username: pe.username, name: pe.name, goals: gp.goals || 0, assists: gp.assists || 0 }); })));
        const games = [...new Set(played.map((x) => x.g))].sort((x, y) => when(y) - when(x)).slice(0, 30);
        return ok(games.map((g) => { const t = d.teams.find((x) => x.id === g.team_id) || {}, ps = played.filter((x) => x.g === g);
          return { game_id: g.id, code: t.code, team: t.short, team_name: t.name, color: t.color, opp: g.opp, us: g.us, them: g.them, friendly: !!g.friendly, house: g.house ? { a: g.house.a, b: g.house.b } : null, when: when(g),
            people: ps.map((x) => ({ username: x.username, name: x.name, goals: x.goals, assists: x.assists })),
            clips: d.clips.filter((c) => c.game_id === g.id && c.at != null && ps.some((x) => (c.pids || []).includes(x.pid) && !(d.clip_hides || []).some((h) => h.game_id === c.game_id && h.at === c.at && h.pid === x.pid)))
              .sort((x, y) => x.at - y.at).map((c) => ({ game_id: c.game_id, at: c.at, path: c.path, vpath: c.vpath || null, store: c.store || null, label: c.label, dur: c.dur })) }; }));
      }
      if (name === 'block_user') { const p = byName(a.p_username); if (!p || p.user_id === uid()) return ok(false);
        if (a.p_block !== false) { if (!d.blocks.some((x) => x.blocker === uid() && x.blocked === p.user_id)) d.blocks.push({ blocker: uid(), blocked: p.user_id }); d.follows = d.follows.filter((f) => !((f.follower === uid() && f.followee === p.user_id) || (f.follower === p.user_id && f.followee === uid()))); }
        else d.blocks = d.blocks.filter((x) => !(x.blocker === uid() && x.blocked === p.user_id));
        store(d); return ok(true); }
      if (name === 'my_blocks') return ok(d.blocks.filter((x) => x.blocker === uid()).map((x) => prof(x.blocked)).filter(Boolean).map((p) => ({ username: p.username, name: p.name })));
      if (name === 'report_user') { const p = byName(a.p_username); if (!p || p.user_id === uid()) return ok(false); const r = d.profile_reports.find((x) => x.reporter === uid() && x.reported === p.user_id);
        if (r) r.reason = String(a.p_reason || '').slice(0, 200); else d.profile_reports.push({ reporter: uid(), reported: p.user_id, reason: String(a.p_reason || '').slice(0, 200) }); store(d); return ok(true); }
    }
    if (name === 'save_player_reel') { // a player's reel on their card (0026): the player themselves or a gaffer, in their own folder
      if (!uid()) return fail('Sign in first', '42501');
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t || !d.players.some((p) => p.team_id === t.id && p.pid === a.p_pid)) return ok({ error: 'missing' });
      if (!(isOrg(d, t.id) || d.players.some((p) => p.team_id === t.id && p.pid === a.p_pid && p.user_id === uid()))) return ok({ error: 'not_allowed' });
      if (a.p_path != null && (!String(a.p_path).startsWith(t.id + '/players/' + a.p_pid + '/') || String(a.p_path).includes('..'))) return ok({ error: 'bad_path' });
      d.player_reels = d.player_reels || []; let r = d.player_reels.find((x) => x.team_id === t.id && x.pid === a.p_pid); const old = r ? r.path : null;
      if (!r) { r = { team_id: t.id, pid: a.p_pid }; d.player_reels.push(r); }
      Object.assign(r, { path: a.p_path ?? null, store: a.p_store === 'r2' ? 'r2' : null, marks: a.p_path == null ? [] : a.p_marks || [], made_by: uid(), made_at: Date.now() });
      store(d); return ok({ ok: true, old: old !== (a.p_path ?? null) && !(d.posts || []).some((x) => x.path === old && !x.removed_at) ? old : null });
    }
    if (name === 'hide_clip') { // Remove from my highlights (0022): only the player themselves, keyed by the game and the moment
      if (!uid()) return fail('Sign in first', '42501');
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t) return ok('no_clip');
      const p = d.players.find((x) => x.team_id === t.id && x.user_id === uid()); if (!p) return ok('not_in_squad');
      d.clip_hides = d.clip_hides || [];
      if (a.p_hide !== false) {
        if (!d.clips.some((c) => c.team_id === t.id && c.game_id === a.p_game && c.at === a.p_at)) return ok('no_clip');
        if (!d.clip_hides.some((h) => h.game_id === a.p_game && h.at === a.p_at && h.pid === p.pid)) d.clip_hides.push({ team_id: t.id, game_id: a.p_game, at: a.p_at, pid: p.pid });
      } else d.clip_hides = d.clip_hides.filter((h) => !(h.team_id === t.id && h.game_id === a.p_game && h.at === a.p_at && h.pid === p.pid));
      store(d); return ok('ok');
    }
    if (name === 'release_player') { const t = d.teams.find((x) => x.code === a.p_code); d.players.forEach((x) => { if (t && x.team_id === t.id && x.user_id === uid()) x.user_id = null; }); store(d); return ok(true); }
    if (['request_join', 'my_join_request', 'team_join_requests', 'decide_join'].includes(name)) { // asking to join when your name isn't in the squad
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase());
      const inTeam = (u) => !!t && !!u && (isOrg(d, t.id) && u === uid() || d.players.some((p) => p.team_id === t.id && p.user_id === u) || d.team_members.some((m) => m.team_id === t.id && m.user_id === u));
      if (name === 'request_join') {
        if (!uid()) return fail('Sign in first', '42501');
        const nm = String(a.p_name || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (!nm) return ok('name');
        if (['fwd', 'def', 'mix', 'gk'].indexOf(a.p_position) < 0) return ok('position');
        if (!t) return ok('missing'); if (inTeam(uid())) return ok('member');
        const num = typeof a.p_number === 'number' && a.p_number >= 0 && a.p_number <= 99 ? a.p_number : null, row = { name: nm, last_name: String(a.p_last_name || '').trim().slice(0, 40) || null, position: a.p_position, shirt_number: num };
        const r = d.join_requests.find((x) => x.team_id === t.id && x.user_id === uid());
        if (r) {
          if (r.status === 'pending') { Object.assign(r, row); store(d); return ok('pending'); }
          if (r.status === 'denied' && Date.now() - r.decided_at < 7 * 86400000) return ok('denied');
          Object.assign(r, row, { status: 'pending', pid: null, created_at: Date.now(), decided_at: null, notified_at: null }); store(d); return ok('ok');
        }
        if (d.join_requests.filter((x) => x.team_id === t.id && x.status === 'pending').length >= 30) return ok('full');
        d.join_requests.push(Object.assign({ id: crypto.randomUUID(), team_id: t.id, user_id: uid(), status: 'pending', created_at: Date.now() }, row)); store(d); return ok('ok');
      }
      if (name === 'my_join_request') { const r = t && uid() && d.join_requests.find((x) => x.team_id === t.id && x.user_id === uid()); return ok(r ? { status: r.status, name: r.name } : null); }
      if (name === 'team_join_requests') { if (!t || !isOrg(d, t.id)) return ok(null); return ok(d.join_requests.filter((x) => x.team_id === t.id && x.status === 'pending').sort((x, y) => x.created_at - y.created_at).map((r) => ({ id: r.id, name: r.name, last_name: r.last_name, position: r.position, number: r.shirt_number, at: r.created_at }))); }
      if (!t || !isOrg(d, t.id)) return ok('not_gaffer');
      const r = d.join_requests.find((x) => x.id === a.p_id && x.team_id === t.id); if (!r) return ok('missing'); if (r.status !== 'pending') return ok('closed');
      r.decided_at = Date.now();
      if (!a.p_allow) { r.status = 'denied'; store(d); return ok('ok'); }
      const have = d.players.find((p) => p.team_id === t.id && p.user_id === r.user_id);
      if (!have) {
        const pid = Math.max(d.players.filter((p) => p.team_id === t.id).reduce((m, p) => Math.max(m, p.pid), 0) + 1, +((t.settings || {}).nextId) || 0);
        d.players.push({ team_id: t.id, pid, name: r.name, position: r.position, shirt_number: r.shirt_number, user_id: r.user_id, last_name: r.last_name }); if (r.user_id) followMates(d, t.id, r.user_id);
        t.settings = Object.assign({}, t.settings, { nextId: pid + 1 }); r.pid = pid;
      } else r.pid = have.pid;
      r.status = 'approved'; store(d); return ok('ok');
    }
    if (name === 'team_stream') { // anyone with the code: the stream that's on now (never the camera link)
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()), st = t && d.team_streams.find((x) => x.team_id === t.id);
      if (!st || !st.started_at || Date.now() - st.started_at > 4 * 3600000) return ok(null);
      return ok({ hls: st.hls, gid: st.gid, started: st.started_at, on_air: st.on_air_at || null });
    }
    if (name === 'my_teams') return ok(!uid() ? [] : d.teams.filter((t) => isOrg(d, t.id) || d.players.some((p) => p.team_id === t.id && p.user_id === uid())).map((t) => ({ code: t.code, name: t.name, org: isOrg(d, t.id) })));
    if (name === 'set_my_number') { const t = d.teams.find((x) => x.code === a.p_code); const p = t && d.players.find((x) => x.team_id === t.id && x.user_id === uid()); if (!p) return ok(false); p.shirt_number = a.p_number; store(d); return ok(true); }
    if (name === 'set_my_position') { const t = d.teams.find((x) => x.code === a.p_code); const p = t && d.players.find((x) => x.team_id === t.id && x.user_id === uid()); if (!p) return ok(false); p.position = a.p_position; store(d); return ok(true); }
    if (name === 'vote_fixture') {
      if (!uid()) return fail('Sign in first', '42501');
      const f = d.fixtures.find((x) => x.id === a.p_fixture); if (!f) return ok('missing');
      if ((f.status || 'open') !== 'open') return ok('closed');
      const p = a.p_pid != null && isOrg(d, f.team_id) ? d.players.find((x) => x.team_id === f.team_id && x.pid === a.p_pid) : d.players.find((x) => x.team_id === f.team_id && x.user_id === uid());
      if (!p) return ok('not_player');
      const others = d.fixture_votes.filter((v) => v.fixture_id === f.id && v.pid !== p.pid);
      if (a.p_choice === 'gk' && others.some((v) => v.choice === 'gk')) return ok('gk_taken');
      if (a.p_choice === 'in' && others.filter((v) => v.choice === 'in').length >= f.max_outfield) return ok('full');
      const mine = d.fixture_votes.find((v) => v.fixture_id === f.id && v.pid === p.pid);
      if (mine) { if (mine.choice !== a.p_choice) { d.fixture_votes = others.concat([{ fixture_id: f.id, pid: p.pid, choice: a.p_choice }]); } } else d.fixture_votes.push({ fixture_id: f.id, pid: p.pid, choice: a.p_choice });
      store(d); return ok('ok');
    }
    if (name === 'queue_goal') {
      const t = d.teams.find((x) => x.code === a.p_code); if (!t || !t.followers_can_score) return ok(false);
      d.goal_queue.push({ id: crypto.randomUUID(), team_id: t.id, payload: a.p_payload }); store(d); return ok(true);
    }
    if (name === 'chat_list' || name === 'chat_send') {
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase());
      const who = t && uid() && d.players.find((p) => p.team_id === t.id && p.user_id === uid());
      if (!t || !uid() || !(who || isOrg(d, t.id))) return ok(null);
      if (name === 'chat_list') return ok(d.messages.filter((m) => m.team_id === t.id).sort((x, y) => x.at - y.at).slice(-80).map((m) => ({ id: m.id, pid: m.pid, name: m.name, body: m.body, play: m.play, play_name: m.play_name, at: m.at, mine: m.user_id === uid(), can_delete: m.user_id === uid() || isOrg(d, t.id) })));
      const body = String(a.p_body || '').trim().slice(0, 1000); if (!body && !a.p_play) return ok(null);
      const m = { id: crypto.randomUUID(), team_id: t.id, user_id: uid(), pid: who ? who.pid : null, name: who ? who.name : 'Gaffer', body, play: a.p_play || null, play_name: a.p_play_name || null, at: Date.now() };
      d.messages.push(m); store(d); return ok(m.id);
    }
    if (name === 'chat_delete') { const m = d.messages.find((x) => x.id === a.p_id); if (!m || (m.user_id !== uid() && !isOrg(d, m.team_id))) return ok(false); d.messages = d.messages.filter((x) => x.id !== a.p_id); store(d); return ok(true); }
    if (name === 'chat_report') { d.reports.push({ message_id: a.p_id, user_id: uid() }); store(d); return ok(true); }
    if (name === 'register_push') { d.push = d.push || []; if (uid() && d.push.indexOf(uid()) < 0) d.push.push(uid()); store(d); return ok(true); }
    if (name === 'report_stream') { const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!uid()) return { data: null, error: { message: 'Sign in first' } }; if (!t) return ok(false); d.stream_reports = (d.stream_reports || []).filter((r) => !(r.team_id === t.id && r.user_id === uid())); d.stream_reports.push({ team_id: t.id, user_id: uid(), reason: a.p_reason || '' }); store(d); return ok(true); }
    if (name === 'delete_my_account') { // as the real one: teams you run on your own go with you, your player is unclaimed, your profile, follows and posts go
      const me = uid(); if (!me) return { data: null, error: { message: 'Sign in first' } };
      const solo = d.team_members.filter((m) => m.user_id === me && !d.team_members.some((o) => o.team_id === m.team_id && o.user_id !== me)).map((m) => m.team_id);
      d.teams = d.teams.filter((t) => !solo.includes(t.id)); d.players = d.players.filter((p) => !solo.includes(p.team_id));
      d.team_members = d.team_members.filter((m) => m.user_id !== me && !solo.includes(m.team_id));
      d.players.forEach((p) => { if (p.user_id === me) p.user_id = null; });
      d.profiles = (d.profiles || []).filter((x) => x.user_id !== me); d.follows = (d.follows || []).filter((f) => f.follower !== me && f.followee !== me);
      d.posts = (d.posts || []).filter((x) => x.user_id !== me); d.push = (d.push || []).filter((u) => u !== me);
      d.users = d.users.filter((u) => u.id !== me); store(d); return ok(solo.length);
    }
    if (name === 'unregister_push') { d.push = (d.push || []).filter((u) => u !== uid()); store(d); return ok(true); }
    if (name === 'team_push') { const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t || !isOrg(d, t.id)) return ok(null); return ok(d.players.filter((p) => p.team_id === t.id && p.user_id && (d.push || []).indexOf(p.user_id) >= 0).map((p) => p.pid)); }
    if (['rival_home', 'set_home', 'find_teams', 'challenge_send', 'challenge_reply', 'my_challenges', 'challenge_result'].includes(name)) {
      d.riv = d.riv || {}; d.chal = d.chal || [];
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t) return ok(null);
      const org = isOrg(d, t.id), inTeam = org || (!!uid() && d.players.some((p) => p.team_id === t.id && p.user_id === uid())), r = d.riv[t.id] || {};
      const terms = (p) => ({ side: +p.side === 7 ? 7 : 5, half: Math.max(1, Math.min(60, Math.round(+p.half) || 15)), periods: +p.periods === 1 ? 1 : 2, subs: Math.max(0, Math.min(7, Math.round(+p.subs) || 0)), ko_at: +p.ko_at, location: String(p.location || '').slice(0, 120), note: String(p.note || '').slice(0, 200) });
      if (name === 'rival_home') return ok({ home: r.home || '', set: r.lat != null, elo: r.elo || 1000, games: r.games || 0 });
      if (name === 'set_home') { if (!org) return ok(false); d.riv[t.id] = Object.assign({ elo: 1000, games: 0 }, r, { home: a.p_name, lat: a.p_lat, lng: a.p_lng }); store(d); return ok(true); }
      if (!inTeam) return ok(null);
      if (name === 'find_teams') return ok(d.teams.filter((o) => o.id !== t.id && (d.riv[o.id] || {}).lat != null && (!a.p_query || o.name.toLowerCase().includes(a.p_query.toLowerCase()))).map((o) => ({ id: o.id, name: o.name, short: o.short, color: o.color, home: d.riv[o.id].home, elo: d.riv[o.id].elo || 1000, games: 0, km: r.lat == null ? null : Math.round(Math.hypot(r.lat - d.riv[o.id].lat, r.lng - d.riv[o.id].lng) * 1110) / 10 })));
      if (name === 'challenge_send') { if (!org) return fail('no', '42501'); const c = { id: crypto.randomUUID(), from_team: t.id, to_team: a.p_to, kind: a.p_kind === 'elo' ? 'elo' : 'friendly', terms: terms(a.p_terms), status: 'proposed', turn: a.p_to, rounds: 0, at: Date.now() }; d.chal.push(c); store(d); return ok(c.id); }
      if (name === 'my_challenges') return ok(d.chal.filter((c) => c.from_team === t.id || c.to_team === t.id).map((c) => { const o = d.teams.find((x) => x.id === (c.from_team === t.id ? c.to_team : c.from_team)); return { id: c.id, kind: c.kind, status: c.status, terms: c.terms, rounds: c.rounds, sent: c.from_team === t.id, my_turn: c.status === 'proposed' && c.turn === t.id, fixture: c.from_team === t.id ? c.fa || null : c.fb || null, my_score: (c.from_team === t.id ? c.fs : c.ts) || null, elo_change: null, other: { id: o.id, name: o.name, short: o.short, color: o.color, elo: (d.riv[o.id] || {}).elo || 1000 }, at: c.at }; }));
      const c = d.chal.find((x) => x.id === a.p_id); if (!c || !org) return ok('missing');
      if (name === 'challenge_result') { c[c.from_team === t.id ? 'fs' : 'ts'] = { us: a.p_us, them: a.p_them }; store(d); return ok(c.fs && c.ts ? 'played' : 'waiting'); }
      if (c.status !== 'proposed') return ok('closed');
      const other = c.from_team === t.id ? c.to_team : c.from_team;
      if (a.p_action === 'decline') { c.status = c.from_team === t.id ? 'cancelled' : 'declined'; store(d); return ok('ok'); }
      if (c.turn !== t.id) return ok('not_your_turn');
      if (a.p_action === 'counter') { c.terms = terms(a.p_terms); c.turn = other; c.rounds++; store(d); return ok('ok'); }
      const mk = (team, opp) => { const f = { id: crypto.randomUUID(), team_id: team, opp: d.teams.find((x) => x.id === opp).name, ko_at: c.terms.ko_at, location: c.terms.location, cost: '', max_outfield: c.terms.side - 1 + c.terms.subs, status: 'open', side: c.terms.side, kind: 'game', fmt: { side: c.terms.side, half: c.terms.half, sub: Math.min(5, c.terms.half), periods: c.terms.periods } }; d.fixtures.push(f); return f.id; };
      c.fa = mk(c.from_team, c.to_team); c.fb = mk(c.to_team, c.from_team); c.status = 'accepted'; store(d); return ok('ok');
    }
    return fail('unknown rpc ' + name);
  }
  function from(table) {
    let op = 'select', body = null; const filters = [];
    const b = {
      select() { op = op === 'select' ? 'select' : op; return b; },
      update(o) { op = 'update'; body = o; return b; }, upsert(o) { op = 'upsert'; body = o; return b; },
      insert(o) { op = 'insert'; body = o; return b; }, delete() { op = 'delete'; return b; },
      eq(c, v) { filters.push((r) => r[c] === v); return b; }, in(c, v) { filters.push((r) => v.indexOf(r[c]) >= 0); return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    const pk = { teams: ['id'], players: ['team_id', 'pid'], games: ['id'], game_players: ['game_id', 'pid'], game_events: ['game_id', 'seq'], live_matches: ['team_id'], goal_queue: ['id'], fixtures: ['id'], clips: ['game_id', 'seq'] }[table];
    function run() {
      if (window.__offline) return fail('Failed to fetch', '');
      if (window.__refuse && window.__refuse(table, op, body)) return fail('invalid input syntax for type bigint', '22P02'); // a test making the database turn a row down
      const d = load(); window.__mockCalls.push(op + ':' + table);
      const rows = d[table], allowed = (r) => isOrg(d, teamOf(d, table, r));
      if (op === 'select') return ok(rows.filter((r) => allowed(r) && filters.every((f) => f(r))));
      if (op === 'delete') { d[table] = rows.filter((r) => !(allowed(r) && filters.every((f) => f(r)))); store(d); return ok(null); }
      if (op === 'update') { rows.forEach((r) => { if (allowed(r) && filters.every((f) => f(r))) Object.assign(r, body); }); store(d); return ok(null); }
      const list = Array.isArray(body) ? body : [body];
      for (const r of list) {
        if (!allowed(r)) return fail('new row violates row-level security policy for table "' + table + '"', '42501');
        const i = rows.findIndex((x) => pk.every((k) => x[k] === r[k]));
        if (i >= 0) { if (op === 'insert') return fail('duplicate key', '23505'); rows[i] = Object.assign({}, rows[i], r); } else rows.push(Object.assign(table === 'fixtures' && !r.id ? { id: crypto.randomUUID(), status: 'open' } : {}, r));
      }
      store(d); return ok(null);
    }
    return b;
  }
  const authCbs = [];
  const session = () => uid() ? { user: { id: uid(), email: sessionStorage.getItem('__mockemail'), user_metadata: (load().users.find((u) => u.id === uid()) || {}).meta || {} } } : null;
  window.__recover = (email) => { const u = load().users.find((x) => x.email === email); if (!u) return false; sessionStorage.setItem('__mockuser', u.id); sessionStorage.setItem('__mockemail', email); authCbs.forEach((cb) => cb('PASSWORD_RECOVERY', session())); return true; };
  const auth = {
    getSession: () => ok({ session: session() }),
    onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      const d = load(); const u = d.users.find((x) => x.email === email && x.password === password);
      if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
      sessionStorage.setItem('__mockuser', u.id); sessionStorage.setItem('__mockemail', email); authCbs.forEach((cb) => cb('SIGNED_IN', session())); return { data: { session: session() }, error: null };
    },
    async signUp({ email, password, options }) { const d = load(); d.users.push({ id: crypto.randomUUID(), email, password, meta: (options && options.data) || {}, redirect: (options && options.emailRedirectTo) || null }); store(d); return { data: { session: null, user: {} }, error: null }; },
    async updateUser({ data, password }) { const d = load(); const u = d.users.find((x) => x.id === uid()); if (!u) return { data: {}, error: { message: 'Sign in first' } }; if (password) u.password = password; u.meta = Object.assign({}, u.meta || {}, data || {}); store(d); return { data: { user: session().user }, error: null }; },
    async resetPasswordForEmail(email, opts) { const d = load(); d.resets = (d.resets || []).concat({ email, to: opts && opts.redirectTo }); store(d); return { data: {}, error: null }; },
    async signOut() { sessionStorage.removeItem('__mockuser'); authCbs.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; }
  };
  function channel(name) {
    const handlers = [];
    const ch = {
      on(type, filter, cb) { handlers.push({ event: filter.event, cb }); return ch; },
      subscribe() { bc.addEventListener('message', (m) => { if (m.data.topic === name) handlers.filter((h) => h.event === m.data.event).forEach((h) => h.cb({ payload: m.data.payload })); }); return ch; },
      send(msg) { bc.postMessage({ topic: name, event: msg.event, payload: msg.payload }); return Promise.resolve('ok'); }
    };
    return ch;
  }
  const storage = { from: (bucket) => ({ upload: async (path, blob) => { const d = load(); const team = d.teams.find((t) => t.id === path.split('/')[0]);
    if (!team || !isOrg(d, team.id)) return { data: null, error: { message: 'new row violates row-level security policy' } };
    d.files = d.files || []; d.files.push({ bucket, path, size: blob.size, type: blob.type }); store(d); return { data: { path }, error: null }; },
    remove: async (paths) => { const d = load(); const mine = (paths || []).filter((p) => { const team = d.teams.find((t) => t.id === String(p).split('/')[0]); return team && isOrg(d, team.id); });
      d.files = (d.files || []).filter((f) => !(f.bucket === bucket && mine.includes(f.path))); store(d); return { data: mine.map((name) => ({ name })), error: null }; } }) };
  // The clip-store edge function (tests/clips.test.mjs runs the real one): upload links into the R2 bucket (here, an address
  // on this test server, PUT to by the app and caught below), deleting, and moving a clip from the old storage. Gaffers only.
  function clipStore(d, b) {
    const no = (status, error, reason) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error, reason }), { status }) } });
    const t = d.teams.find((x) => x.code === String(b.code || '').trim().toUpperCase());
    if (!uid()) return no(401, 'Sign in first.'); if (!t) return no(404, 'No such team.');
    if (!isOrg(d, t.id)) { // a player: only their own reel's folder, as the real function
      const me = d.players.find((p) => p.team_id === t.id && p.user_id === uid()), own = me ? t.id + '/players/' + me.pid + '/' : '';
      if (!own || !['upload', 'remove'].includes(b.action) || !(b.paths || []).length || !(b.paths || []).every((k) => String(k).startsWith(own))) return no(403, 'Only a gaffer can change the team\'s highlights.');
    }
    if (d.r2Off) return no(503, 'Clip storage isn\'t set up on Gaffer\'s server yet.', 'not_configured');
    const keys = b.paths || [];
    if (b.action !== 'adopt' && (!keys.length || !keys.every((k) => String(k).startsWith(t.id + '/')))) return no(400, 'Those files aren\'t in this team\'s folder.');
    if (b.action === 'upload') return { data: { urls: keys.map((k) => location.origin + '/__r2/' + k) }, error: null };
    if (b.action === 'remove') { d.files = (d.files || []).filter((f) => !(f.bucket === 'r2' && keys.includes(f.path))); store(d); return { data: { removed: keys.length }, error: null }; }
    if (b.action === 'adopt') {
      const c = d.clips.find((x) => x.team_id === t.id && x.game_id === b.game_id && x.seq === b.seq); if (!c) return no(404, 'No such clip.');
      if (c.store === 'r2') return { data: { moved: 0 }, error: null };
      const files = [c.path, c.vpath].filter(Boolean); (d.files || []).forEach((f) => { if (f.bucket === 'clips' && files.includes(f.path)) f.bucket = 'r2'; });
      c.store = 'r2'; store(d); return { data: { moved: files.length }, error: null };
    }
    return no(400, 'Unknown action.');
  }
  const realFetch = window.fetch.bind(window); // uploads to the R2 bucket: kept with the stand-in database's files
  window.fetch = async (url, init) => {
    const u = String(url && url.url || url);
    if (u.includes('/__r2/') && init && init.method === 'PUT') {
      if (window.__r2Fail) return new Response('', { status: 500 });
      const key = decodeURIComponent(u.split('/__r2/')[1]), body = init.body, d = load(); d.files = (d.files || []).filter((f) => !(f.bucket === 'r2' && f.path === key));
      d.files.push({ bucket: 'r2', path: key, size: body && body.size || 0, type: (init.headers || {})['Content-Type'] || '' }); store(d); return new Response('', { status: 200 });
    }
    if (/\.r2\.dev\//.test(u) && init && init.method === 'HEAD') { // (is a file there yet, at its public address?)
      const key = decodeURIComponent(u.split('.r2.dev/')[1].split('?')[0]);
      return new Response(null, { status: (load().files || []).some((f) => f.bucket === 'r2' && f.path === key) ? 200 : 404 });
    }
    return realFetch(url, init);
  };
  // The live-stream edge function (tests/stream.test.mjs runs the real one): the team's camera link, on only while live.
  // A test plugs the GoPro in with d.camera = true, and makes the server unready with d.streamOff.
  function liveStream(d, b) {
    const no = (status, error) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error }), { status }) } });
    const yes = (data) => { store(d); return { data, error: null }; };
    const t = d.teams.find((x) => x.code === String(b.code || '').trim().toUpperCase());
    if (!uid()) return no(401, 'Sign in first'); if (!t) return no(404, 'No such team');
    if (!isOrg(d, t.id)) return no(403, "Only a gaffer can stream the team's games");
    if (d.streamOff) return no(503, "Live streaming isn't set up on Gaffer's server yet.");
    let st = d.team_streams.find((x) => x.team_id === t.id); const on = !!st && !!st.started_at && Date.now() - st.started_at < 4 * 3600000;
    const make = () => { const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
      st = { team_id: t.id, input_uid: id, hls: 'https://customer-test.cloudflarestream.com/' + id + '/manifest/video.m3u8', gid: null, started_at: null, on_air_at: null, notified_at: null, enabled: false };
      d.team_streams = d.team_streams.filter((x) => x.team_id !== t.id).concat([st]); };
    const link = () => ({ url: 'rtmps://live.cloudflare.com:443/live/key' + st.input_uid.slice(0, 8), server: 'rtmps://live.cloudflare.com:443/live/', key: 'key' + st.input_uid.slice(0, 8) });
    if (b.action === 'link') { if (!st) make(); return yes(Object.assign(link(), { on })); }
    if (b.action === 'start') { if (!st) make(); st.enabled = true; if (!(on && st.gid === (b.gid || null))) Object.assign(st, { gid: b.gid || null, started_at: Date.now(), on_air_at: null, notified_at: null }); return yes(Object.assign(link(), { on: true, hls: st.hls })); }
    if (b.action === 'status') { if (!on) return yes({ on: false, on_air: false, first: false }); const live = !!d.camera && st.enabled; let first = false; if (live && !st.on_air_at) { st.on_air_at = Date.now(); first = true; } return yes({ on: true, on_air: live, first }); }
    if (b.action === 'stop') { if (st) Object.assign(st, { gid: null, started_at: null, on_air_at: null, enabled: false }); return yes({ on: false }); }
    if (b.action === 'renew') { if (on) return no(409, 'End the stream first, then make a new link.'); make(); return yes(Object.assign(link(), { on: false })); }
    return no(400, 'Nothing to do');
  }
  const functions = { invoke: async (name, o) => { if (name === 'live-stream' && window.__offline) return { data: null, error: { message: 'Failed to send a request to the Edge Function' } };
    const d = load(); d.calls = d.calls || []; d.calls.push({ name, body: o.body }); store(d); if (name === 'live-stream') return liveStream(d, o.body);
    if (name === 'clip-store') return clipStore(d, o.body);
    if (name === 'team-notify' && o.body.kind === 'live') { // sent once per stream, and only when the picture is really getting through (as the real one checks with Cloudflare)
      const t = d.teams.find((x) => x.code === String(o.body.code || '').trim().toUpperCase()), st = t && d.team_streams.find((x) => x.team_id === t.id);
      if (!st || !st.started_at || st.notified_at || !(d.camera && st.enabled)) return { data: { sent: 0 }, error: null };
      st.notified_at = Date.now(); st.on_air_at = st.on_air_at || st.notified_at; d.livePushes = (d.livePushes || 0) + 1; store(d); return { data: { sent: 2, people: 2 }, error: null };
    } if (name === 'reel-voice') return { data: { audio: o.body.lines.map((l) => l ? 'QUJD' : null) }, error: null }; return { data: { sent: o.body.kind === 'nudge' ? 2 : 0, people: 2 }, error: null }; } };
  window.supabase = { createClient: () => ({ rpc, from, auth, channel, storage, functions, removeChannel() {} }) };
})();
