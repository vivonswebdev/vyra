# VYRA — MACHINE EMBROIDERY

*CREATE. EDIT. STITCH. SELL.*

Plateforme de broderie machine : **VYRA Studio** (création et édition de motifs) et, plus tard, **VYRA Market**
(place de marché, non commencée). Documents :

- [`docs/LIVRAISON.md`](docs/LIVRAISON.md) — état réel des lots et fonctions restantes
- [`docs/ORGANISATION-STUDIO-MARKET.md`](docs/ORGANISATION-STUDIO-MARKET.md) — inventaire des dépôts, référence Studio, séparation Studio / Market, plan du LOT 2
- [`docs/LOT-3.1.md`](docs/LOT-3.1.md) — rapport du lot 3.1 : corrections, tests avec de vrais services, points à valider
- [`docs/AUDIT.md`](docs/AUDIT.md), [`docs/AUDIT-LOT3.md`](docs/AUDIT-LOT3.md) — audits et constats
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — décisions d'architecture
- [`docs/REFERENCES.md`](docs/REFERENCES.md) — les 45 fichiers de référence v0.2.0 et leur statut
- [`docs/VALIDATION-PHYSIQUE.md`](docs/VALIDATION-PHYSIQUE.md) — protocole d'essai sur machine
- [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md), [`docs/SEPARATION.md`](docs/SEPARATION.md)

## Démarrer en local

Prérequis : Node 22, PostgreSQL 16.

```bash
npm ci
```

```bash
createdb vyra_dev   # rôle vyra / mot de passe vyra par défaut, voir .env.example
```

```bash
npm run build && DEV_MAILBOX=1 WEB_DIST_DIR=$PWD/dist/web npm start
```

Ouvrir <http://127.0.0.1:8787/studio/>, créer un compte. Les e-mails (vérification, mot de passe oublié) ne
partent pas en développement : avec `DEV_MAILBOX=1`, ils sont lisibles sur <http://127.0.0.1:8787/dev/mailbox>
(option refusée en production).

Développement de l'interface avec rechargement à chaud : `npm start` dans un terminal, puis
`npm run dev -w @vyra/studio` (Vite sur le port 5173, l'API est relayée).

## Tests

```bash
npm test             # gel du moteur, empreintes v0.2.0, performance, API sur PostgreSQL (bases vyra_test, vyra_restore), traductions
npm run test:e2e     # navigateur : ordinateur, tablette, mobile (base vyra_e2e)
npm run typecheck
```

```bash
PYTHON=python3 node packages/engine/scripts/verify-references.mjs   # relecture par pyembroidery (pip install pyembroidery==1.5.1)
```

```bash
node packages/engine/scripts/verify-legacy-bundle.mjs      # le build v0.2 d'origine, dans Chromium, contre le registre
```

## Le moteur (figé)

`packages/engine/src/generated/engine.js` est **généré** (`npm run engine:extract`) depuis le build v0.2 conservé
dans `legacy/vyra-studio-0.2/` : ne pas le modifier à la main. Le moteur, le build d'origine, les registres, les
motifs et les outils de référence sont figés par `packages/engine/FROZEN.sha256` ; toute modification fait
échouer `test/frozen.test.ts`. Les sources d'origine du moteur restent introuvables.
