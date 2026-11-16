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
| `vyra_app` | serveur : requêtes faites pour l'utilisateur connecté (`DATABASE_URL`) |
| `vyra_system` | serveur : authentification, liens reçus par e-mail, limitation de débit (`SYSTEM_DATABASE_URL`) |
| `vyra_worker` | serveur : envoi des e-mails, purges, réanalyse antivirus, santé et métriques (`WORKER_DATABASE_URL`) |
| `vyra_market` | aucun droit sur les tables du socle |
| `vyra_backup` | sauvegarde, lecture seule (seul rôle qui contourne RLS) |

**Le serveur ne migre plus au démarrage.** Il vérifie que la base est à jour (sinon il refuse de démarrer) et, en
production, refuse un rôle superutilisateur, propriétaire, capable de créer des objets ou de prendre `vyra_owner`.

```bash
node dist/api/migrate.mjs --status   # code 0 à jour, 1 en attente, 2 anomalie (modifiée ou orpheline)
```

**Schéma dédié `vyra` (lot H2).** Toutes les tables vivent dans le schéma `vyra`, propriété de `vyra_owner`.
`database-setup.sql` crée ce schéma et règle le chemin de recherche `vyra, public` de chaque rôle dans la base ;
l'API l'impose aussi à chaque connexion. Les droits des rôles sont posés par la migration
`009_core_privileges` (matrice par table et par colonne) : il n'y a plus de script de droits à réappliquer.
**Trois connexions (lot H3).** Le serveur ouvre un pool par rôle ; en production, `DATABASE_URL` (vyra_app),
`SYSTEM_DATABASE_URL` (vyra_system) et `WORKER_DATABASE_URL` (vyra_worker) sont obligatoires et le serveur
refuse de démarrer si une connexion n'utilise pas le rôle attendu. La commande de migration lit la même
configuration : lui fournir les mêmes variables. La migration `010_core_privileges_split` retire à vyra_app les
droits transitoires du lot H2 : l'API d'une version antérieure à H3 ne fonctionne plus après elle.
Chaque requête faite pour un utilisateur connecté s'exécute dans une transaction qui porte son identifiant et
l'empreinte de sa session (`set_config(…, true)`).

**Sécurité au niveau des lignes (lot H5).** Les 13 tables rattachées à un utilisateur sont sous RLS **forcée**
(`013_core_rls`) : `vyra_app` ne voit et ne modifie que les lignes de l'utilisateur dont la session est confirmée
par `vyra.ctx_user()` (session non expirée de cet utilisateur, compte actif, avec cette empreinte) ; sans
contexte confirmé, aucune ligne et aucune écriture. `vyra_system` voit les tables de l'authentification ;
`vyra_worker` ne voit que les lignes de chaque purge. `mfa_challenges`, `auth_throttle`, `rate_limits` et le
registre restent hors RLS (aucun propriétaire de ligne, aucun accès de `vyra_app`). Les comptes des autres ne
sont lus ou modifiés que par les fonctions `vyra.admin_*` (`012_core_ctx_functions`), réservées à un
administrateur ayant saisi un TOTP depuis moins de 15 minutes. Une session révoquée ou un compte suspendu
pendant une requête : la requête suivante reçoit 401 (`session_expired`). Après `013`, les routes `/api/admin`
d'une API antérieure à H5 échouent (`vyra_app` n'a plus le droit d'écrire directement les rôles) ; le reste d'une
API antérieure n'a pas été essayé sur une base en `013` : déployer H5 en même temps que ses migrations.

**Migrations de données sur une table à RLS forcée.** Le propriétaire est filtré lui aussi : un `UPDATE` exécuté
par une migration toucherait 0 ligne **sans erreur**. Règle, dans la même migration (donc la même transaction) :

```sql
ALTER TABLE vyra.projects NO FORCE ROW LEVEL SECURITY;
UPDATE vyra.projects SET …;            -- reprise de données
ALTER TABLE vyra.projects FORCE ROW LEVEL SECURITY;
```

Les migrations de structure (colonnes, index, contraintes) ne sont pas concernées. La sauvegarde (`vyra_backup`,
`BYPASSRLS`) est complète ; la restauration recrée politiques et forçage, et son contrôle compte les lignes en
levant le forçage dans une transaction annulée.

Procédure de mise à jour :

1. sauvegarde (voir ci-dessous) **et restauration d'essai** de cette sauvegarde dans une base jetable ;
2. administrateur : `roles.sql`, puis `database-setup.sql` sur la base (idempotents) ;
3. `MIGRATION_DATABASE_URL=… MIGRATION_SET_ROLE=vyra_owner node dist/api/migrate.mjs` : un seul processus
   applique ; un second attend le verrou puis ne rejoue rien ; `migrate.mjs --status` = 0 ensuite ;
4. redémarrer l'application (`DATABASE_URL` = `vyra_app`) et vérifier `/api/ready`.

Passage d'une base du lot H1 (tables dans `public`) : mêmes étapes. `008_core_schema_vyra` déplace les 16 tables et
le registre (catalogue seulement, aucune copie ; verrou bref, `lock_timeout` 10 s) ; une table présente dans les
deux schémas annule la migration. Prévoir une courte fenêtre de maintenance.

**Retour arrière.** Les migrations ne se défont pas (pas de « down ») ; la voie normale est le retour en avant
(nouvelle migration corrective). Revenir au code du lot H1 après 007-013 est impossible tel quel (le serveur H1
verrait des migrations orphelines et refuserait de démarrer). Deux possibilités, API arrêtée :
- `psql "<url vyra_migrator>" -v ON_ERROR_STOP=1 --single-transaction -f scripts/db/rollback-h2.sql` : RLS
  désactivée et politiques retirées (013), fonctions de 012 et 011 retirées, tables et registre remis dans
  `public`, droits du lot H1 rétablis, lignes 007-013 retirées du registre, schéma `vyra` (vide) supprimé ; **aucune perte de données** (aller-retour vérifié en test : `db-roles.test.ts`) ;
- ou restauration de la sauvegarde de l'étape 1 dans une base neuve (les écritures postérieures sont perdues).

## Sauvegardes

```bash
BACKUP_DATABASE_URL=<url vyra_backup> [STORAGE_DIR=… | STORAGE_DRIVER=s3 …] node scripts/backup.mjs <dossier>
RESTORE_DATABASE_URL=<url vyra_migrator, base NEUVE préparée> [STORAGE_DIR=…] node scripts/restore.mjs <sauvegarde> [--remplacer]
```

- **Sauvegarde** par `vyra_backup` seulement (tout autre rôle est refusé) : `pg_dump` **avec** propriétaires et
  droits, plus un instantané de contrôle (`controle.json` : propriétaires, droits par table et par colonne,
  séquences, fonctions, contraintes, index, politiques, nombre de lignes et somme de contrôle par table), pris
  dans le **même instantané** de la base que `pg_dump`. Le stockage est copié ensuite. Manifeste SHA-256.
- **Restauration** par `vyra_migrator` seulement, **uniquement dans une base neuve** préparée par l'administrateur
  (`CREATE DATABASE`, `database-setup.sql`). Une base qui contient le moindre objet, dans n'importe quel schéma, est
  refusée sans aucune écriture ; `--remplacer` ne concerne plus que le stockage (dossier ou préfixe S3 non vide).
  Le stockage cible est vérifié avant la base. `pg_restore --single-transaction --role=vyra_owner` : tout ou rien.
- **Contrôle** après restauration : l'instantané de la sauvegarde est comparé à la base restaurée ; toute différence
  donne le code 5 et la consigne de ne pas basculer l'API. Bascule ensuite (changement de `DATABASE_URL`) :
  l'ancienne base reste intacte jusque-là.
- Les rôles ne sont pas dans la sauvegarde : ils viennent de `roles.sql` (mots de passe posés par l'exploitant).
- `pg_dump` / `pg_restore` doivent avoir la même version majeure que le serveur (16). Planifier une sauvegarde
  quotidienne hors du serveur, activer le versionnage S3 chez le fournisseur, **tester une restauration** à chaque
  version. Une sauvegarde antérieure au lot H2 (sans `controle.json`) est refusée par ce script.

## Services externes requis

| Service | Testé avec | Reste à faire avant ouverture |
|---|---|---|
| PostgreSQL 16 | réel (local, CI) | instance gérée en UE, sauvegardes du fournisseur |
| Stockage S3 | MinIO réel (local, CI) | compartiment privé chez un fournisseur UE, test de conformité avec ses identifiants |
| SMTP | Mailpit réel (local, CI) | fournisseur d'envoi, SPF/DKIM/DMARC, envoi de chaque modèle |
| ClamAV | clamd réel, signatures de TEST | clamd + freshclam avec signatures officielles, supervisé |
| Supervision | métriques et règles prêtes | Prometheus/Grafana (ou équivalent) branché, destinataires des alertes |
