// In-browser stand-in for supabase-js, backed by localStorage so several tabs share one "database".
// Implements just what the app uses, with the same access rules as the real policies and functions.
(function () {
  const KEY = '__mockdb';
  const TABLES = ['teams', 'team_members', 'players', 'games', 'game_players', 'game_events', 'live_matches', 'goal_queue', 'users', 'fixtures', 'fixture_votes', 'clips'];
  const load = () => { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); TABLES.forEach((t) => { d[t] = d[t] || []; }); return d; };
  const store = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const code = (n) => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
  const uid = () => (sessionStorage.getItem('__mockuser') || null);
  const isOrg = (d, team) => !!uid() && d.team_members.some((m) => m.team_id === team && m.user_id === uid());
  const teamOf = (d, table, row) => table === 'teams' ? row.id : (row.team_id || (d.games.find((g) => g.id === row.game_id) || {}).team_id);
  const ok = (data) => Promise.resolve({ data, error: null });
  const fail = (message, code) => Promise.resolve({ data: null, error: { message, code } });
  const bc = new BroadcastChannel('__mockrt');
  window.__mockCalls = [];
  function rpc(name, a) {
    const d = load(); window.__mockCalls.push('rpc:' + name);
    if (name === 'get_team') {
      const t = d.teams.find((x) => x.code === String(a.p_code).trim().toUpperCase()); if (!t) return ok(null);
      const org = isOrg(d, t.id);
      return ok({ team: Object.assign({}, t, { organiser_code: org ? t.organiser_code : null }), is_organiser: org,
        my_pid: (d.players.find((p) => p.team_id === t.id && uid() && p.user_id === uid()) || {}).pid ?? null,
        players: d.players.filter((p) => p.team_id === t.id).sort((x, y) => x.pid - y.pid).map((p) => ({ pid: p.pid, name: p.name, position: p.position || null, claimed: !!p.user_id, me: !!p.user_id && p.user_id === uid(),
          gaffer: !!p.user_id && d.team_members.some((mm) => mm.team_id === t.id && mm.user_id === p.user_id), last_name: org || p.user_id === uid() ? p.last_name || null : null })),
        games: d.games.filter((g) => g.team_id === t.id).sort((x, y) => x.seq - y.seq).map((g) => Object.assign({}, g, {
          players: d.game_players.filter((p) => p.game_id === g.id).map((p) => ({ pid: p.pid, mins: p.mins, goals: p.goals, assists: p.assists })),
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
    if (name === 'my_teams') return ok(!uid() ? [] : d.teams.filter((t) => isOrg(d, t.id) || d.players.some((p) => p.team_id === t.id && p.user_id === uid())).map((t) => ({ code: t.code, name: t.name, org: isOrg(d, t.id) })));
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
  const functions = { invoke: async (name, o) => { const d = load(); d.calls = d.calls || []; d.calls.push({ name, body: o.body }); store(d); return { data: { sent: o.body.kind === 'nudge' ? 2 : 0, people: 2 }, error: null }; } };
  window.supabase = { createClient: () => ({ rpc, from, auth, channel, storage, functions, removeChannel() {} }) };
})();
