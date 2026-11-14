# Déploiement indépendant de VYRA Studio

**Rien n'est déployé publiquement.** Ce document décrit la procédure ; elle demande votre accord, un hébergeur,
un domaine et des secrets que je n'ai ni créés ni configurés.

## Version de production reproductible

```bash
npm ci && npm run build            # Studio (Vite) + API compilée (esbuild) dans dist/
```

```bash
node scripts/release.mjs release/  # archive vyra-<version>-<commit>.tar.gz + empreinte .sha256
```

Sur le serveur : vérifier l'empreinte, extraire, puis

```bash
npm ci --omit=dev --ignore-scripts
```

```bash
NODE_ENV=production node dist/api/server.mjs
```

L'API compilée n'utilise plus `tsx`. Le moteur figé est intégré tel quel au worker de calcul
(`dist/api/worker.mjs`). `scripts/smoke-release.mjs` installe une archive comme en production et la vérifie avec
de vrais services (PostgreSQL, ClamAV, S3, SMTP) : exécuté en local et dans la CI.

## Configuration

Voir `.env.example`. La configuration de production est **refusée au démarrage** si : `SECRET_KEY` absent,
`PUBLIC_URL` non HTTPS, transport d'e-mails absent, antivirus absent (`FILE_SCAN=clamd` obligatoire),
limitation de débit en mémoire, boîte aux lettres de développement activée, paiement en bac à sable,
S3 incomplet. Aucun secret n'est versionné.

## Santé, supervision, journaux

| Point | Rôle |
|---|---|
| `GET /api/health` | vivacité du processus (sondes de redémarrage) |
| `GET /api/ready` | disponibilité : base, migrations à jour, stockage (écriture/lecture/suppression), moteur, antivirus, file d'e-mails ; 503 si l'un échoue |
| `GET /api/metrics` | métriques Prometheus (requêtes par statut, durée, tâches du moteur, file d'e-mails, fichiers par état d'analyse, mémoire) ; exige `Authorization: Bearer $METRICS_TOKEN` |
| `deploy/prometheus-alerts.yml` | 7 règles d'alerte (indisponibilité, 5xx, e-mails, moteur, antivirus, mémoire) — **préparées, non branchées** |

Journaux : JSON (pino) sur la sortie standard, un objet par ligne : `level`, `time`, `reqId`, `req.method`,
`req.url`, `res.statusCode`, `responseTime`, `msg`. Cookies et en-têtes d'autorisation masqués. Chaque réponse porte
`x-request-id` (repris du proxy s'il est sûr). Les événements de sécurité (connexions, 2FA, fichiers infectés,
suppressions) sont aussi dans la table `audit_log`.

## Rôles PostgreSQL et migrations (lot H1)

Une seule fois par instance PostgreSQL, par son administrateur :

```bash
psql "$ADMIN_URL/postgres" -f scripts/db/roles.sql
```

Puis définir un mot de passe distinct pour chaque rôle de connexion (`ALTER ROLE vyra_app PASSWORD …`, etc.),
et, une fois par base :

```bash
psql "$ADMIN_URL/vyra" -f scripts/db/database-setup.sql
```

| Rôle | Usage |
|---|---|
| `vyra_owner` | possède les objets ; aucune connexion |
| `vyra_migrator` | commande de migration seulement ; prend `vyra_owner` le temps de chaque migration |
| `vyra_app` | serveur (aujourd'hui seul rôle d'exécution utilisé) |
| `vyra_system`, `vyra_worker`, `vyra_market` | préparés ; utilisés à partir du lot H3 |
| `vyra_backup` | sauvegarde, lecture seule |

**Le serveur ne migre plus au démarrage.** Il vérifie que la base est à jour (sinon il refuse de démarrer) et, en
production, refuse un rôle superutilisateur, propriétaire, capable de créer des objets ou de prendre `vyra_owner`.

```bash
node dist/api/migrate.mjs --status   # code 0 à jour, 1 en attente, 2 anomalie (modifiée ou orpheline)
```

Procédure de mise à jour :

1. `node scripts/backup.mjs <dossier>` (base + stockage, manifeste d'empreintes) — voir la limite ci-dessous ;
2. `MIGRATION_DATABASE_URL=… MIGRATION_SET_ROLE=vyra_owner node dist/api/migrate.mjs` : un seul processus
   applique ; un second attend le verrou puis ne rejoue rien ;
3. `psql "$MIGRATION_DATABASE_URL" -f scripts/db/grants-h1.sql` (droits de transition, à réappliquer après chaque
   migration), puis `migrate.mjs --status` = 0 ;
4. redémarrer l'application (`DATABASE_URL` = `vyra_app`) et vérifier `/api/ready`.

**Limite connue (à corriger au lot H2)** : `scripts/backup.mjs` et `scripts/restore.mjs` utilisent
`--no-owner --no-privileges`. Une restauration perd le propriétaire `vyra_owner` et tous les droits de `vyra_app`.
Procédure vérifiée en test (`apps/api/test/db-roles.test.ts`) : `pg_dump` sans ces options par `vyra_backup`,
`pg_restore --role=vyra_owner` par `vyra_migrator` dans une base préparée.

Les migrations ne se défont pas (pas de « down ») : **retour arrière = arrêter la nouvelle version, restaurer la
sauvegarde de l'étape 1** (`node scripts/restore.mjs <sauvegarde> --remplacer`), redémarrer l'archive précédente.
Les données écrites entre la mise à jour et le retour arrière sont perdues : prévoir une fenêtre de maintenance.

## Sauvegardes

`scripts/backup.mjs` et `scripts/restore.mjs` gèrent la base et le stockage (dossier local ou S3, testés contre
MinIO). `pg_dump` / `pg_restore` doivent avoir la même version majeure que le serveur (16). Planifier une
sauvegarde quotidienne hors du serveur, activer le versionnage S3 chez le fournisseur, **tester une restauration**
à chaque version.

## Services externes requis

| Service | Testé avec | Reste à faire avant ouverture |
|---|---|---|
| PostgreSQL 16 | réel (local, CI) | instance gérée en UE, sauvegardes du fournisseur |
| Stockage S3 | MinIO réel (local, CI) | compartiment privé chez un fournisseur UE, test de conformité avec ses identifiants |
| SMTP | Mailpit réel (local, CI) | fournisseur d'envoi, SPF/DKIM/DMARC, envoi de chaque modèle |
| ClamAV | clamd réel, signatures de TEST | clamd + freshclam avec signatures officielles, supervisé |
| Supervision | métriques et règles prêtes | Prometheus/Grafana (ou équivalent) branché, destinataires des alertes |
