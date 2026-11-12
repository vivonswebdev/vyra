# Déploiement indépendant de VYRA Studio

**Rien n'est déployé publiquement.** Ce document décrit la procédure ; elle demande votre accord, un hébergeur,
un domaine et des secrets que je n'ai ni créés ni configurés.

## Ce qui a été vérifié ici

- Démarrage en `NODE_ENV=production` (12/11/2026) : migrations appliquées, `/api/health` répond, Studio servi,
  HSTS et CSP présents, cookie `__Host-vyra_session; HttpOnly; Secure; SameSite=Lax`, boîte aux lettres de
  développement absente.
- Configuration de production refusée si un réglage dangereux est présent (10 cas testés).
- Sauvegarde puis restauration complète dans une autre base et un autre dossier.

Non vérifié ici : image conteneur (pas de Docker dans cet environnement), envoi réel d'e-mails (Brevo), stockage
S3 réel (testé contre un serveur local qui vérifie les signatures), certificat TLS, sauvegardes planifiées.

## Architecture minimale

```
Internet ── HTTPS (proxy inverse : Caddy, Nginx ou plateforme) ── API Node 22 (sert aussi /studio/)
                                                                    ├── PostgreSQL 16 (UE)
                                                                    └── Stockage objet S3 privé (UE)
```

Hébergeurs européens possibles : Scaleway, OVHcloud, Clever Cloud (application) ; base gérée PostgreSQL du même
fournisseur ou Supabase (région UE) utilisée comme simple PostgreSQL.

## Variables d'environnement

| Variable | Obligatoire en production | Rôle |
|---|---|---|
| `NODE_ENV=production` | oui | active les garde-fous |
| `PUBLIC_URL` | oui, en `https://` | origine publique (cookies, liens des e-mails, CSRF) |
| `SECRET_KEY` | oui | 32 octets base64 (`openssl rand -base64 32`) : chiffrement des secrets 2FA |
| `DATABASE_URL` | oui | PostgreSQL 16 |
| `MAIL_TRANSPORT=brevo`, `BREVO_API_KEY`, `MAIL_FROM` | oui | e-mails de vérification et de réinitialisation |
| `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SSE` | recommandé | stockage privé ; sinon `STORAGE_DIR` sur un volume persistant |
| `TRUST_PROXY=true` | derrière un proxy | adresse IP réelle pour la limitation de débit |
| `ENGINE_WORKERS`, `ENGINE_TIMEOUT_MS`, `ENGINE_QUEUE`, `ENGINE_MEMORY_MB` | non | calculs du moteur (défauts : 2, 20 000 ms, 20, 512 Mo) |
| `PAYMENTS_PROVIDER=none` | — | tant que le Market n'est pas ouvert ; `sandbox` est refusé en production |
| `DEV_MAILBOX` | **interdit** | refusé au démarrage en production |

## Procédure

```bash
npm ci && npm run build
```

```bash
NODE_ENV=production WEB_DIST_DIR=$PWD/dist/web npm start
```

Le serveur applique les migrations au démarrage (verrou PostgreSQL : plusieurs instances peuvent démarrer
ensemble). Le compartiment S3 doit être **privé**, sans accès public ni politique de lecture anonyme.

## Sauvegardes

```bash
DATABASE_URL=… STORAGE_DIR=… node scripts/backup.mjs /chemin/sauvegardes
```

```bash
DATABASE_URL=<cible> STORAGE_DIR=<cible> node scripts/restore.mjs /chemin/sauvegardes/vyra-<date>
```

`pg_dump` et `pg_restore` doivent avoir la même version majeure que le serveur. Avec le stockage S3, activer le
versionnage et la réplication côté fournisseur. Planifier au moins une sauvegarde quotidienne hors du serveur et
**tester une restauration** à chaque changement de version.

## Limites connues

- L'API s'exécute avec `tsx` (TypeScript à la volée). Une compilation préalable réduirait le temps de démarrage.
- Pas encore de supervision (métriques, alertes) ni de journalisation centralisée.
- La limitation de débit est en mémoire : avec plusieurs instances, prévoir un stockage partagé (Redis).
