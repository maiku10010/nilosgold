const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig } = require('../dist/databaseConfig');
const ref = 'kzupjvycvcspinpctmty';
const env = { DEMO_SUPABASE_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` };

test('demo accepts only direct or pooler connections for its pinned project', () => {
  for (const url of [
    `postgresql://user:pass@db.${ref}.supabase.co:5432/postgres`,
    `postgresql://user.${ref}:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  ]) assert.equal(databaseConfig(url, env).connectionString, url);
  for (const production of ['zbckqjrlaeozkzdpvtog', 'irmukorxbdbmpjznzvca']) {
    for (const url of [
      `postgresql://user:pass@db.${production}.supabase.co:5432/postgres`,
      `postgresql://user.${production}:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
    ]) assert.throws(() => databaseConfig(url, env), /does not match/);
  }
  assert.throws(() => databaseConfig('postgresql://user:pass@localhost/postgres', env), /does not match/);
});

test('demo rejects a different public Supabase endpoint', () => {
  assert.throws(() => databaseConfig(`postgresql://user:pass@db.${ref}.supabase.co/postgres`, { ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }), /API URL does not match/);
});

test('demo branch rejects inherited shop credentials even without an explicit pin', () => {
  assert.throws(() => databaseConfig('postgresql://user:pass@db.zbckqjrlaeozkzdpvtog.supabase.co/postgres', { VERCEL_GIT_COMMIT_REF: 'feature/white-label-demo' }), /does not match/);
});

test('custom CA keeps certificate verification enabled and removes conflicting URL TLS options', () => {
  const config = databaseConfig(`postgresql://user:pass@db.${ref}.supabase.co/postgres?sslmode=no-verify&sslrootcert=other&application_name=demo`, { ...env, DATABASE_SSL_CA: 'test CA' });
  assert.deepEqual(config.ssl, { ca: 'test CA', rejectUnauthorized: true });
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(config.connectionString).searchParams.has('sslrootcert'), false);
  assert.equal(new URL(config.connectionString).searchParams.get('application_name'), 'demo');
});
