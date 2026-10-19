/** Keep demo credentials pinned to their own Supabase project and verify TLS. */
export function databaseConfig(connectionString: string, env: NodeJS.ProcessEnv = process.env) {
  const url = new URL(connectionString);
  const project = env.DEMO_SUPABASE_PROJECT_REF || (env.VERCEL_GIT_COMMIT_REF === 'feature/white-label-demo' ? 'kzupjvycvcspinpctmty' : undefined);
  if (project) {
    const direct = url.hostname === `db.${project}.supabase.co`;
    const pooled = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${project}`);
    if (!direct && !pooled) throw new Error('Demo database URL does not match the configured demo Supabase project.');
    if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${project}.supabase.co`) throw new Error('Demo Supabase API URL does not match the configured demo project.');
  }
  if (env.DATABASE_SSL_CA) {
    // pg connection-string SSL parameters override explicit ssl options.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    return { connectionString: url.toString(), ssl: { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true } };
  }
  return { connectionString };
}
