// Migrations SQL versionnées, appliquées dans l'ordre, chacune dans une transaction.
// Une migration appliquée n'est jamais modifiée ni renommée : on en ajoute une nouvelle.
//
// Concurrence (lot H1) : le verrou consultatif est pris AVANT toute lecture du registre, sur la connexion qui
// applique ensuite les migrations. Un second processus attend le verrou, puis relit le registre à jour : il ne
// rejoue jamais ce que le premier a appliqué. Chaque fichier est encore revérifié dans sa propre transaction.
// Le registre est contrôlé avant toute application : empreinte de chaque migration appliquée (SHA-256 du
// contenu) et absence de migration « orpheline » (enregistrée sans fichier, par exemple après un renommage).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { Db } from "./pool.js";

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
/** Clé du verrou consultatif des migrations (inchangée depuis le lot 1). */
export const MIGRATION_LOCK_KEY = 7279431;
const FILE_RE = /^\d{3}_.+\.sql$/;

export interface MigrateOptions {
  /** Dossier des fichiers de migration (tests uniquement ; par défaut le dossier livré). */
  dir?: string;
  /**
   * Rôle pris au début de chaque transaction de migration (`SET LOCAL ROLE`). En production : `vyra_owner`, pour
   * que les objets créés appartiennent au rôle propriétaire sans connexion, et non au compte qui migre.
   */
  setRole?: string;
}

export interface MigrationState {
  applied: string[];
  pending: string[];
  /** Appliquées, mais le fichier a changé depuis : anomalie bloquante. */
  modified: string[];
  /** Enregistrées dans le registre sans fichier correspondant : anomalie bloquante. */
  orphans: string[];
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const quoteIdent = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Nom de rôle refusé : ${s}`);
  return `"${s}"`;
};

function readFiles(dir: string): { name: string; sql: string; sum: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), "utf8");
      return { name, sql, sum: sha256(sql) };
    });
}

async function readRegistry(q: Pick<pg.ClientBase, "query">): Promise<Map<string, string> | null> {
  const { rows } = await q.query("SELECT to_regclass('schema_migrations') AS t");
  if (!rows[0].t) return null;
  const r = await q.query("SELECT name, checksum FROM schema_migrations");
  return new Map(r.rows.map((x: { name: string; checksum: string }) => [x.name, x.checksum]));
}

function compare(files: { name: string; sum: string }[], done: Map<string, string>): MigrationState {
  const names = new Set(files.map((f) => f.name));
  const s: MigrationState = { applied: [], pending: [], modified: [], orphans: [] };
  for (const f of files) {
    if (!done.has(f.name)) s.pending.push(f.name);
    else if (done.get(f.name) !== f.sum) s.modified.push(f.name);
    else s.applied.push(f.name);
  }
  for (const n of done.keys()) if (!names.has(n)) s.orphans.push(n);
  s.orphans.sort();
  return s;
}

/** Applique les migrations en attente. Renvoie les noms appliqués par CET appel. */
export async function migrate(db: Db, log: (m: string) => void = () => {}, opts: MigrateOptions = {}): Promise<string[]> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const files = readFiles(dir);
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    // 1. Verrou d'abord : rien n'est lu avant de l'obtenir.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      // 2. Registre créé si besoin, sous le verrou, avec le rôle propriétaire le cas échéant.
      await client.query("BEGIN");
      if (opts.setRole) await client.query(`SET LOCAL ROLE ${quoteIdent(opts.setRole)}`);
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      // 3. Registre relu APRÈS le verrou (avec le même rôle que celui qui l'écrit), puis contrôlé.
      const registry = await readRegistry(client);
      await client.query("COMMIT");
      if (!registry) throw new Error("Registre des migrations illisible avec ce rôle.");
      const state = compare(files, registry);
      if (state.modified.length) throw new Error(`Migration(s) modifiée(s) après application : ${state.modified.join(", ")}.`);
      if (state.orphans.length)
        throw new Error(`Migration(s) enregistrée(s) sans fichier (renommée, supprimée, ou code plus ancien que la base) : ${state.orphans.join(", ")}.`);

      // 4. Application, une transaction par fichier, avec une dernière vérification dans la transaction.
      const applied: string[] = [];
      for (const f of files.filter((x) => state.pending.includes(x.name))) {
        try {
          await client.query("BEGIN");
          if (opts.setRole) await client.query(`SET LOCAL ROLE ${quoteIdent(opts.setRole)}`);
          const again = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f.name]);
          if (again.rowCount) {
            await client.query("ROLLBACK");
            continue;
          }
          await client.query(f.sql);
          await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [f.name, f.sum]);
          await client.query("COMMIT");
          applied.push(f.name);
          log(`migration appliquée : ${f.name}`);
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw new Error(`Échec de la migration ${f.name} : ${(e as Error).message}`);
        }
      }
      return applied;
    } catch (e) {
      // Une transaction éventuellement ouverte (création du registre) est annulée avant de rendre la main.
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      // 5. Libération du verrou, en cas de succès comme d'erreur.
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch((e) => (broken = e));
    }
  } finally {
    // Si le verrou n'a pas pu être relâché, la connexion est détruite (le serveur libère alors le verrou)
    // au lieu d'être rendue au pool avec un verrou encore tenu.
    client.release(broken);
  }
}

/**
 * État des migrations, sans rien créer ni modifier : utilisable avec le rôle de l'API (lecture du registre) ou
 * avec le migrateur (`setRole`, lecture dans une transaction en lecture seule sous le rôle propriétaire).
 */
export async function migrationStatus(db: Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "connect">>, opts: { dir?: string; setRole?: string } = {}): Promise<MigrationState> {
  const files = readFiles(opts.dir ?? MIGRATIONS_DIR);
  if (!opts.setRole || !db.connect) return compare(files, (await readRegistry(db)) ?? new Map<string, string>());
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL ROLE ${quoteIdent(opts.setRole)}`);
    const done = (await readRegistry(client)) ?? new Map<string, string>();
    await client.query("COMMIT");
    return compare(files, done);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
