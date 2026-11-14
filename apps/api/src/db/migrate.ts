// Commande de migration (lot H1) : seule à créer ou modifier le schéma, distincte du serveur.
//   node dist/api/migrate.mjs            applique les migrations en attente
//   node dist/api/migrate.mjs --status   affiche l'état sans rien créer ni modifier
//                                        (code 0 à jour, 1 en attente, 2 anomalie : modifiée ou orpheline)
// Connexion : MIGRATION_DATABASE_URL (rôle vyra_migrator) ; en développement, DATABASE_URL à défaut.
// En production, MIGRATION_DATABASE_URL et MIGRATION_SET_ROLE=vyra_owner sont obligatoires.
// Les migrations ne se défont pas : retour arrière = restauration de la sauvegarde prise juste avant
// (docs/DEPLOIEMENT.md).
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { migrate, migrationStatus } from "./migrations.js";

const cfg = loadConfig();
const statusOnly = process.argv.includes("--status");
if (cfg.isProd && !statusOnly && (!cfg.MIGRATION_DATABASE_URL || !cfg.MIGRATION_SET_ROLE)) {
  console.error("En production, MIGRATION_DATABASE_URL (rôle vyra_migrator) et MIGRATION_SET_ROLE=vyra_owner sont obligatoires.");
  process.exit(3);
}
const db = createPool(cfg.MIGRATION_DATABASE_URL ?? cfg.DATABASE_URL);
try {
  if (statusOnly) {
    const s = await migrationStatus(db, { setRole: cfg.MIGRATION_SET_ROLE });
    console.log(JSON.stringify(s, null, 2));
    process.exitCode = s.modified.length || s.orphans.length ? 2 : s.pending.length ? 1 : 0;
  } else {
    const applied = await migrate(db, console.log, { setRole: cfg.MIGRATION_SET_ROLE });
    console.log(applied.length ? `${applied.length} migration(s) appliquée(s).` : "Base à jour.");
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
