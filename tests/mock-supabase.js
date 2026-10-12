// In-browser stand-in for supabase-js, backed by localStorage so several tabs share one "database".
// Implements just what the app uses, with the same access rules as the real policies and functions.
(function () {
  const KEY = '__mockdb';
  const TABLES = ['teams', 'team_members', 'players', 'games', 'game_players', 'game_events', 'live_matches', 'goal_queue', 'users', 'fixtures', 'fixture_votes', 'clips', 'messages', 'reports', 'join_requests'];
  // tests/lib.mjs gives every phone its own browser profile, like real devices; then the database lives with the test runner (window.__mockRemote).
  const REMOTE = window.__mockRemote || null;
  const xhr = (method, body) => { const x = new XMLHttpRequest(); x.open(method, REMOTE, false); x.send(body || null); return x.responseText; };
  const load = () => { const d = JSON.parse((REMOTE ? xhr('GET') : localStorage.getItem(KEY)) || '{}'); TABLES.forEach((t) => { d[t] = d[t] || []; }); return d; };
  const store = (d) => { if (REMOTE) xhr('PUT', JSON.stringify(d)); else localStorage.setItem(KEY, JSON.stringify(d)); };
  const code = (n) => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
  const uid = () => (sessionStorage.getItem('__mockuser') || null);
  const isOrg = (d, team) => !!uid() && d.team_members.some((m) => m.team_id === team && m.user_id === uid());
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
        clips: d.clips.filter((c) => c.team_id === t.id),
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
      if (!isOrg(d, t.id)) d.team_members.push({ team_id: t.id, user_id: uid() }); store(d); return ok(t.code);
    }
    if (name === 'new_organiser_code') { const t = d.teams.find((x) => x.id === a.p_team); if (!t || !isOrg(d, t.id)) return fail('no', '42501'); t.organiser_code = code(10); store(d); return ok(t.organiser_code); }
    if (name === 'claim_player') {
      if (!uid()) return fail('Sign in first', '42501');
      const t = d.teams.find((x) => x.code === a.p_code); if (!t) return ok('missing');
      const p = d.players.find((x) => x.team_id === t.id && x.pid === a.p_pid); if (!p) return ok('missing');
      if (p.user_id && p.user_id !== uid()) return ok('taken');
      d.players.forEach((x) => { if (x.team_id === t.id && x.user_id === uid()) x.user_id = null; });
      if (['fwd', 'def', 'mix', 'gk'].indexOf(a.p_position) < 0) return ok('position');
      p.user_id = uid(); p.last_name = a.p_last_name || null; p.position = a.p_position; store(d); return ok('ok');
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
        d.players.push({ team_id: t.id, pid, name: r.name, position: r.position, shirt_number: r.shirt_number, user_id: r.user_id, last_name: r.last_name });
        t.settings = Object.assign({}, t.settings, { nextId: pid + 1 }); r.pid = pid;
      } else r.pid = have.pid;
      r.status = 'approved'; store(d); return ok('ok');
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
  const session = () => uid() ? { user: { id: uid(), email: sessionStorage.getItem('__mockemail') } } : null;
  const auth = {
    getSession: () => ok({ session: session() }),
    onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      const d = load(); const u = d.users.find((x) => x.email === email && x.password === password);
      if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
      sessionStorage.setItem('__mockuser', u.id); sessionStorage.setItem('__mockemail', email); authCbs.forEach((cb) => cb('SIGNED_IN', session())); return { data: { session: session() }, error: null };
    },
    async signUp({ email, password }) { const d = load(); d.users.push({ id: crypto.randomUUID(), email, password }); store(d); return { data: { session: null, user: {} }, error: null }; },
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
    d.files = d.files || []; d.files.push({ bucket, path, size: blob.size, type: blob.type }); store(d); return { data: { path }, error: null }; } }) };
  const functions = { invoke: async (name, o) => { const d = load(); d.calls = d.calls || []; d.calls.push({ name, body: o.body }); store(d); if (name === 'reel-voice') return { data: { audio: o.body.lines.map((l) => l ? 'QUJD' : null) }, error: null }; return { data: { sent: o.body.kind === 'nudge' ? 2 : 0, people: 2 }, error: null }; } };
  window.supabase = { createClient: () => ({ rpc, from, auth, channel, storage, functions, removeChannel() {} }) };
})();
