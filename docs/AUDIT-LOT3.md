# Lot 3 — Audit de l'état réel et consolidation

Vérifications faites sur le code, pas sur le rapport précédent (12/11/2026).

## 1. État vérifié avant le lot 3

| Point | Constat |
|---|---|
| Branche | `claude/sleepy-knuth-uw65mf` d'`optiteam`, à jour avec l'origine, arbre propre |
| Commits annoncés | `bcfc294` et `fa88c6d` présents localement et sur GitHub |
| Fichiers hors `vyra/` | un seul : `.github/workflows/vyra.yml` (ajouté) |
| Reproduction propre (`git archive fa88c6d` + `npm ci`) | 0 vulnérabilité, types valides, 52 tests unitaires/intégration et 13 navigateur au vert |
| CI GitHub (`optiteam`, workflow VYRA, run #1) | réussie sur `fa88c6d` |
| OptiTeam | 53/53 tests, build identique, `dist/` sans `vyra/` ; workflows `compta` et `veille` non déclenchés |
| Migrations | 2, sommes de contrôle vérifiées ; **pas de verrou entre instances** |
| Sauvegarde / restauration | **inexistantes** |
| Accès aux projets et fichiers | contrôlés par propriétaire (testé) |
| CSRF, sessions, mots de passe | en-tête + Origin, cookies httpOnly hachés, scrypt OWASP (testés) |

## 2. Constats et suite donnée

| # | Constat | Gravité | Statut lot 3 |
|---|---|---|---|
| 1 | Le moteur s'exécutait dans le fil principal de l'API : un document piégé (densité nulle, millions de points) pouvait bloquer le serveur | Haute | **Corrigé** : pool de workers, délai, mémoire, file bornée ; validation stricte des documents |
| 2 | Boîte aux lettres de développement active dès que `NODE_ENV` ≠ production (expose les liens de réinitialisation) | Haute | **Corrigé** : option `DEV_MAILBOX` explicite, refusée en production |
| 3 | Aucune sauvegarde ni restauration | Haute | **Corrigé** : scripts + test de restauration complète |
| 4 | Production impossible sans clés Stripe alors que le Market n'existe pas | Moyenne | **Corrigé** : `PAYMENTS_PROVIDER=none` |
| 5 | Migrations sans verrou (deux instances au démarrage) | Moyenne | **Corrigé** : `pg_advisory_lock` |
| 6 | Pas de double authentification | Moyenne | **Fait** : TOTP, codes de secours, anti-rejeu |
| 7 | La réinitialisation par e-mail aurait contourné la 2FA (défaut trouvé pendant le lot) | Haute | **Corrigé** avant livraison, testé |
| 8 | Cookie de session sans préfixe `__Host-` en HTTPS | Faible | **Corrigé** |
| 9 | Pas de clé de chiffrement des secrets | Moyenne | **Fait** : `SECRET_KEY` obligatoire en production |
| 10 | Le verrouillage après 8 échecs répond « trop de tentatives » : il révèle qu'un compte existe | Faible | **Ouvert** (compromis accepté, à revoir) |
| 11 | Limitation de débit en mémoire (une seule instance) | Moyenne | **Ouvert** (Redis à prévoir pour plusieurs instances) |
| 12 | API exécutée avec `tsx` en production | Faible | **Ouvert** |
| 13 | Pas de supervision ni d'alertes | Moyenne | **Ouvert** |
| 14 | `ubuntu-latest` (26.04) n'a plus le client PostgreSQL 16 : CI en échec au run 3 | Moyenne | **Corrigé** : runner épinglé sur 24.04 |

## 3. Séparation, moteur, références

- Séparation : [`SEPARATION.md`](SEPARATION.md).
- Gel du moteur : `packages/engine/FROZEN.sha256` (34 fichiers) et `test/frozen.test.ts` (dont régénération à
  l'identique du moteur depuis le build d'origine).
- 45 références : [`REFERENCES.md`](REFERENCES.md) — 24 comparées à des exports réels par trois méthodes, 21 en
  empreinte seule. **Sources du moteur et script du kit XE1 introuvables** (dépôts GitHub, deux builds
  d'artifact sans carte de sources, messagerie).

## 4. RGPD

Export des données et suppression du compte sont implémentés et testés techniquement. Cela **ne constitue pas une
conformité RGPD** : registre des traitements, politique de confidentialité, base légale, durées de conservation
(journal d'audit anonymisé conservé), contrats de sous-traitance (hébergeur, Brevo, stockage), information des
utilisateurs et procédure de demande restent à établir avec un conseil.
