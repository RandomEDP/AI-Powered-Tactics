// A real Postgres, in memory, loaded with every migration in supabase/migrations: the database tests run the actual
// functions and security rules, signed in as different people, without touching the live project.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';
import { ROOT } from './lib.mjs';

// The parts of Supabase the migrations lean on: its roles, auth.users and auth.uid(), and the storage tables.
export const SUPABASE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema storage;
grant usage on schema auth, extensions, storage, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant all on all tables in schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function database() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  const dir = path.join(ROOT, 'supabase/migrations'), applied = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); applied.push(f); } catch (e) { throw new Error(`${f} does not apply: ${e.message}`); }
  }
  const lit = (v) => v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
  /// Runs `sql` as that person would through the app: signed in (role "authenticated") or not (role "anon").
  const as = async (user, sql) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ? user.id : ''}', false); select set_config('request.jwt.claim.role', '${user ? 'authenticated' : 'anon'}', false); set role ${user ? 'authenticated' : 'anon'};`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
  };
  return {
    db, applied,
    user: async (email) => (await db.query(`insert into auth.users (email) values ($1) returning id, email`, [email])).rows[0],
    as,
    /// Calls a database function the way the app does; returns its result, or throws with the database's message.
    rpc: async (user, name, args = {}) => { const rows = await as(user, `select public.${name}(${Object.keys(args).map((k) => `${k} => ${lit(args[k])}`).join(', ')}) as r`); return rows.length === 1 ? rows[0].r : rows.map((x) => x.r); },
    /// Straight into the database, past every rule (what only the server can do).
    admin: async (sql, params) => (await db.query(sql, params)).rows,
    fails: async (p) => { try { await p; return ''; } catch (e) { return e.message || 'failed'; } },
    close: () => db.close(),
  };
}
