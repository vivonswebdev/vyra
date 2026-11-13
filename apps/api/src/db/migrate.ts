// Migrations : `node dist/api/migrate.mjs` applique ; `--status` affiche l'état sans rien modifier.
// Les migrations ne se défont pas : retour arrière = restauration de la sauvegarde prise juste avant (docs/DEPLOIEMENT.md).
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { migrate, migrationStatus } from "./migrations.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
try {
  if (process.argv.includes("--status")) {
    const s = await migrationStatus(db);
    console.log(JSON.stringify(s, null, 2));
    process.exitCode = s.modified.length ? 2 : s.pending.length ? 1 : 0;
  } else {
    const applied = await migrate(db, console.log);
    console.log(applied.length ? `${applied.length} migration(s) appliquée(s).` : "Base à jour.");
  }
} finally {
  await db.end();
}
