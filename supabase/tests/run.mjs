// Applies the migrations to an in-memory Postgres (PGlite) and runs game_rules.sql on it.
// Exists because `supabase test db` needs Docker. Any failed assert throws and exits 1.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const db = new PGlite();
await db.exec(read('tests/supabase_stub.sql'));
for (const file of readdirSync(new URL('migrations/', root)).sort()) {
  await db.exec(read(`migrations/${file}`));
}
await db.exec(read('tests/game_rules.sql'));
console.log('game rules: ok');
