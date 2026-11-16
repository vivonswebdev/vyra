# Sécurité de la base de données VYRA (socle, lots H1 à H6)

Ce document décrit ce que la base PostgreSQL garantit, ce qu'elle ne garantit pas, et comment l'exploiter :
rôles, rotation des mots de passe, migrations, sauvegarde et restauration, récupération d'un administrateur.
Le déploiement pas à pas est dans [DEPLOIEMENT.md](DEPLOIEMENT.md).

## 1. Rôles

| Rôle | Connexion | Usage | Contourne RLS |
|---|---|---|---|
| `vyra_owner` | non | possède le schéma `vyra` et tous ses objets | non (tables à RLS **forcée**) |
| `vyra_migrator` | oui | commande de migration seulement ; prend `vyra_owner` le temps de chaque migration | non |
| `vyra_app` | oui | requêtes faites pour l'utilisateur connecté (`DATABASE_URL`) | non |
| `vyra_system` | oui | authentification, liens reçus par e-mail, limitation de débit (`SYSTEM_DATABASE_URL`) | non |
| `vyra_worker` | oui | envoi des e-mails, purges, analyse antivirus, santé (`WORKER_DATABASE_URL`) | non |
| `vyra_market` | oui | module Market (aucun droit sur le socle) | non |
| `vyra_backup` | oui | sauvegarde, lecture seule (`pg_read_all_data`) | **oui** (seul) |

Les droits exacts de chaque rôle (table, colonne, séquence, fonction) sont la référence
`apps/api/test/support/privileges.txt` : le test P-PRIV-1 échoue à la moindre différence. Toute migration qui
change un droit doit mettre cette référence à jour, avec la raison dans la migration.

En production, le serveur refuse de démarrer si une connexion n'a pas le rôle attendu, si son rôle peut prendre
`vyra_owner`, est superutilisateur ou propriétaire d'objets, si `MIGRATION_DATABASE_URL` lui est fourni, ou si
une migration est en attente (vérifié par le test de fumée de l'archive).

## 2. Contexte utilisateur et RLS

- L'API pose `vyra.user_id` et `vyra.session` (empreinte SHA-256 du cookie de session) par
  `set_config(…, true)`, dans une transaction, à un seul endroit du code (`withUser`, `apps/api/src/db/pool.ts`).
- `vyra.ctx_user()` ne retient l'utilisateur que si une session **non expirée de cet utilisateur**, compte
  **actif**, porte cette empreinte. Sinon `NULL` : aucune ligne visible, aucune écriture. Un contexte forgé
  (identifiant d'un autre compte) échoue, faute de connaître l'empreinte de sa session.
- 13 tables rattachées à un utilisateur sont sous RLS **activée et forcée** (`013_core_rls`, `014`) ; une
  politique par rôle et par opération, jamais pour PUBLIC. Hors RLS : `mfa_challenges`, `auth_throttle`,
  `rate_limits`, `schema_migrations` (aucun accès de `vyra_app`, sauf la lecture du registre) et
  `admin_guard_lock`, `admin_guard_tx` (propriétaire seulement).
- Une session révoquée ou un compte suspendu pendant une requête : l'instruction suivante ne voit plus rien et
  l'API répond 401 (`session_expired`).

## 3. Fonctions `SECURITY DEFINER`

Toutes : propriétaire `vyra_owner`, chemin de recherche vide, noms qualifiés, aucun `EXECUTE` public.

| Fonction | Rôle | Exécutable par |
|---|---|---|
| `ctx_user()` | utilisateur du contexte, vérifié | `vyra_app` |
| `has_staff_role(rôle, minutes, totp)` | rôle du personnel + second facteur récent sur la session courante | `vyra_app` |
| `admin_find_user`, `admin_set_role`, `admin_reset_mfa` | seul passage vers les comptes des autres (administrateur, TOTP < 15 min) | `vyra_app` |
| `admin_guard_lock`, `admin_guard_is_last`, `admin_guard_counts` | garde du dernier administrateur côté API | `vyra_app` |
| `admin_guard_count`, `admin_guard_note`, `admin_guard_check` | garde du dernier administrateur côté base (déclencheurs différés) | aucun |

## 4. Ce que la base garantit, et ses limites

Garanti, même si l'API contient une injection SQL exécutée sous `vyra_app` dans le contexte d'un utilisateur :
les lignes des **autres** utilisateurs ne sont ni lues ni modifiées ; aucun fichier d'autrui ne peut être relié à
un projet ; aucune session éternelle, aucun lien de réinitialisation du mot de passe ne peut être créé ; un
fichier ne peut pas être déclaré « sain » ; le journal ne peut qu'être anonymisé ; aucune modification de
structure ; la plateforme garde au moins un administrateur actif avec double authentification (toute
transaction, même d'un superutilisateur, qui retirerait le dernier est annulée).

Limites connues (risques résiduels acceptés, à surveiller) :

1. **La base ne peut pas vérifier un code TOTP** (le secret est chiffré par la clé du serveur). Une injection
   dans la session d'un **administrateur** peut marquer cette session « vérifiée maintenant » et passer
   `has_staff_role`. La barrière en base protège contre les autres comptes et contre une vérification datée du
   futur ; pour un administrateur, l'API reste l'autorité.
2. **`vyra_system` voit tous les comptes et sessions** (inhérent à l'authentification). Son mot de passe est le
   plus sensible après celui de `vyra_backup`.
3. Une injection dans le contexte d'un utilisateur peut supprimer ses **propres** alertes de sécurité encore en
   file (droit nécessaire à la suppression de compte).
4. Sauvegarde : la copie du stockage suit l'instantané de la base. Un fichier déposé pendant la sauvegarde peut
   manquer à la restauration (il reste « en attente » et est purgé au bout de 24 h).
5. Compromission complète du processus API : il détient les identifiants de trois rôles ; RLS ne protège pas de
   ce cas.

## 5. Exploitation

### 5.1 Rotation des mots de passe des rôles

Un rôle PostgreSQL n'a qu'un mot de passe : la rotation coupe les **nouvelles** connexions avec l'ancien, pas
les connexions ouvertes. Procédure, un rôle à la fois :

1. générer un mot de passe long et aléatoire (au moins 32 caractères), le placer dans le gestionnaire de secrets ;
2. administrateur : `ALTER ROLE vyra_app PASSWORD '…';` ;
3. mettre à jour la variable correspondante (`DATABASE_URL`, `SYSTEM_DATABASE_URL`, `WORKER_DATABASE_URL`,
   ou celles de la migration et de la sauvegarde) et redémarrer l'application (ou la commande) ;
4. vérifier `/api/ready` ; en cas d'échec, remettre l'ancien mot de passe (étape 2) et redémarrer.

Fréquence conseillée : tous les 6 mois, et immédiatement après tout départ d'une personne qui les connaissait ou
tout soupçon de fuite. Jamais de mot de passe dans le dépôt, les journaux ou les tickets.

### 5.2 Migrations

Voir [DEPLOIEMENT.md](DEPLOIEMENT.md). Règle propre à RLS : une migration qui **modifie des données** d'une table
à RLS forcée lève puis rétablit le forçage dans la même migration (sinon 0 ligne modifiée, sans erreur).

### 5.3 Sauvegarde et restauration

`scripts/backup.mjs` (rôle `vyra_backup`) et `scripts/restore.mjs` (rôle `vyra_migrator`, base neuve seulement).
La restauration recrée droits, RLS, politiques et fonctions, et compare tout à l'instantané de contrôle pris
pendant la sauvegarde (structure, lignes, sommes de contrôle ; séquences supérieures ou égales). Faire une
restauration d'essai avant chaque mise à jour.

### 5.4 Récupération d'un administrateur

1. **Il lui reste un code de secours** : connexion possible ; aucune opération sur les rôles avant d'avoir
   réactivé la double authentification et saisi un code TOTP.
2. **Plus aucun facteur, un autre administrateur existe** : celui-ci (TOTP de moins de 15 min) réinitialise sa
   double authentification (`POST /api/admin/users/:id/2fa/reset`) ; alerte e-mail à l'intéressé, journal,
   sessions fermées.
3. **Seul administrateur, plus aucun facteur** : procédure hors application, sur décision explicite du
   responsable à chaque fois, à deux personnes, avec une trace écrite hors de la base. C'est une modification
   d'un compte de production : elle n'est jamais faite sans cette décision.

   ```bash
   psql "<url vyra_migrator>" -v ON_ERROR_STOP=1 --single-transaction -v email='admin@exemple.be' -f scripts/db/recover-last-admin.sql
   ```

   Une seule transaction : double authentification, codes de secours et sessions de ce compte effacés, trace
   dans le journal d'audit ; la garde du dernier administrateur et le forçage RLS ne sont levés que pendant la
   transaction. Refus sans rien modifier si l'adresse ne désigne pas exactement un administrateur actif (vérifié
   par `security-review.test.ts`). L'intéressé se connecte ensuite par mot de passe et réactive immédiatement la
   double authentification. Recommandation : **toujours au moins deux administrateurs**.

## 6. Performances (mesure H6)

`scripts/bench-api.mts`, base locale jetable, requêtes en mémoire (sans réseau), médianes de plusieurs passages,
même machine. Médiane / 95e centile en millisecondes :

| Route | H4 (sans RLS) | H5 (RLS) | H6 (RLS + revue) |
|---|---|---|---|
| `GET /api/projects` (20 projets) | 2,50 / 3,50 | 2,74 / 3,92 | 2,74 / 3,69 |
| `GET /api/projects/:id` | 1,96 / 2,69 | 2,11 / 2,92 | 2,27 / 3,20 |
| `PATCH /api/projects/:id` | 3,10 / 4,56 | 3,85 / 5,10 | 4,12 / 5,63 |
| `GET /api/me/sessions` | 2,10 / 2,93 | 2,40 / 3,14 | 2,33 / 3,22 |
| `GET /api/auth/me` (sans transaction utilisateur) | 1,41 / 1,79 | 1,42 / 1,89 | 1,36 / 1,75 |
| Débit, 20 requêtes simultanées (req./s) | 1 191 | 1 025 | 1 127 |

Surcoût de RLS : de 0,1 à 1 ms par requête (vérification de la session par `ctx_user()` à chaque instruction),
soit 5 à 15 % de débit en moins sur ce banc. Le bruit entre deux passages est d'environ ±5 %. Mesure locale,
sans charge concurrente réelle ni latence réseau : à refaire sur l'hébergement retenu.
