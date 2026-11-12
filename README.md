# VYRA — MACHINE EMBROIDERY

*CREATE. EDIT. STITCH. SELL.*

Plateforme de broderie machine : **VYRA Studio** (création et édition de motifs) et **VYRA Market**
(place de marché, lots 5 à 7). Audit et décisions : [`docs/AUDIT.md`](docs/AUDIT.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). État des lots : [`docs/LIVRAISON.md`](docs/LIVRAISON.md).

## Démarrer en local

Prérequis : Node 22, PostgreSQL 16.

```bash
cd vyra && npm install
```

```bash
createdb vyra_dev   # rôle vyra / mot de passe vyra par défaut, voir .env.example
```

```bash
npm run build && WEB_DIST_DIR=$PWD/dist/web npm start
```

Ouvrir <http://127.0.0.1:8787/studio/>, créer un compte. Les e-mails (vérification, mot de passe oublié) ne
partent pas en développement : ils sont lisibles sur <http://127.0.0.1:8787/dev/mailbox>.

Développement de l'interface avec rechargement à chaud : `npm start` dans un terminal, puis
`npm run dev -w @vyra/studio` (Vite sur le port 5173, l'API est relayée).

## Tests

```bash
npm test             # moteur (empreintes v0.2.0), contrats, API sur PostgreSQL (base vyra_test), traductions
npm run test:e2e     # navigateur : ordinateur, tablette, mobile (base vyra_e2e)
npm run typecheck
```

```bash
PYTHON=python3 node packages/engine/scripts/verify-references.mjs   # relecture par pyembroidery (pip install pyembroidery==1.5.1)
```

## Le moteur

`packages/engine/src/generated/engine.js` est **généré** (`npm run engine:extract`) depuis le build v0.2 conservé
dans `legacy/vyra-studio-0.2/` : ne pas le modifier à la main. Toute modification du moteur doit garder vertes
les empreintes de `test/reference.test.ts`.
