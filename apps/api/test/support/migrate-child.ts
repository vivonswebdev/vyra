// Processus enfant des tests de concurrence : applique les migrations avec le module indiqué et écrit le
// résultat en JSON sur la sortie standard. Usage : tsx migrate-child.ts <module migrations> <url base> [dossier]
import { pathToFileURL } from "node:url";
import pg from "pg";

const [mod, url, dir] = process.argv.slice(2);
const { migrate } = await import(pathToFileURL(mod).href);
const pool = new pg.Pool({ connectionString: url, max: 4 });
try {
  const applied: string[] = await migrate(pool, () => {}, dir ? { dir } : undefined);
  console.log(JSON.stringify({ ok: true, applied }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
