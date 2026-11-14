import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrationStatus } from "./db/migrations.js";
import { checkRuntimeRole } from "./db/runtime-role.js";
import { buildApp } from "./app.js";
import { createSender, flushOutbox } from "./lib/mailer.js";
import { rescanUnscanned } from "./lib/quarantine.js";

const cfg = loadConfig();
// Lot H1 : le serveur ne migre plus. Les migrations sont appliquées avant le démarrage par la commande dédiée
// (`node dist/api/migrate.mjs`, rôle vyra_migrator). Le serveur vérifie seulement que la base est à jour.
if (cfg.isProd && process.env.MIGRATION_DATABASE_URL) {
  console.error("MIGRATION_DATABASE_URL ne doit pas être fourni au serveur : les identifiants de migration restent réservés à la commande de migration.");
  process.exit(1);
}
const db = createPool(cfg.DATABASE_URL);
const state = await migrationStatus(db);
if (state.pending.length || state.modified.length || state.orphans.length) {
  console.error(
    "Base de données pas à jour : lancez d'abord `npm run db:migrate`.\n" +
      JSON.stringify({ pending: state.pending, modified: state.modified, orphans: state.orphans }),
  );
  await db.end();
  process.exit(1);
}
const role = await checkRuntimeRole(db);
if (role.problems.length) {
  const msg = `Le rôle PostgreSQL de l'API (${role.role}) a des privilèges inutiles : ${role.problems.join(", ")}.`;
  if (cfg.isProd) {
    console.error(msg + " Démarrage refusé en production (utiliser vyra_app).");
    await db.end();
    process.exit(1);
  }
  console.warn(msg + " Accepté hors production uniquement.");
}
const app = await buildApp({ cfg, db });
rescanUnscanned(app).catch((e) => app.log.error(e));

// Envoi des e-mails en attente toutes les 15 secondes (transport réel uniquement).
const sender = createSender(cfg);
const mailTimer = setInterval(() => flushOutbox(db, cfg, sender).catch((e) => app.log.error(e)), 15_000);
// Purge des sessions et jetons expirés, toutes les heures.
const purgeTimer = setInterval(() => {
  db.query("DELETE FROM sessions WHERE expires_at < now()").catch((e) => app.log.error(e));
  db.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'").catch((e) => app.log.error(e));
  db.query("DELETE FROM rate_limits WHERE reset_at < now()").catch((e) => app.log.error(e));
  // Minimisation : les e-mails envoyés (adresse, contenu) ne sont gardés que 7 jours.
  db.query("DELETE FROM email_outbox WHERE sent_at < now() - interval '7 days'").catch((e) => app.log.error(e));
  db.query("DELETE FROM auth_throttle WHERE window_start < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())").catch((e) => app.log.error(e));
  db.query("DELETE FROM mfa_challenges WHERE expires_at < now()").catch((e) => app.log.error(e));
  rescanUnscanned(app).then((r) => (r.clean || r.infected || r.errors) && app.log.info(r, "analyse des fichiers anciens"), (e) => app.log.error(e));
  // Quarantaine : contenu des fichiers non analysables effacé après 24 h (la trace reste en base).
  db.query("SELECT id, storage_key FROM files WHERE scan_status IN ('error', 'pending') AND created_at < now() - interval '24 hours' AND deleted_at IS NULL")
    .then(async ({ rows }) => {
      for (const f of rows) {
        await app.storage.delete(f.storage_key).catch(() => {});
        await db.query("UPDATE files SET deleted_at = now() WHERE id = $1", [f.id]);
      }
    })
    .catch((e) => app.log.error(e));
  // Comptes jamais confirmés depuis 7 jours et sans projet : supprimés.
  db.query(
    "DELETE FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = users.id)",
  ).catch((e) => app.log.error(e));
}, 3600_000);

const stop = async () => {
  clearInterval(mailTimer);
  clearInterval(purgeTimer);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
