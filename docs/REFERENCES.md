# Les 45 fichiers PES/DST de référence v0.2.0

Registre : `packages/engine/fixtures/empreintes-reference-v0.2.0.sha256` (copie octet pour octet de
`legacy/vyra-studio-0.2/registre/`, sha256 du fichier `719ef6c6…770d2`), calculé à l'origine sur l'étiquette
`v0.2.0` (commit `d3d9472e`) du dépôt source StitchStudio, **dépôt toujours introuvable**.

Ni le registre, ni les fichiers de référence, ni les empreintes attendues ne sont modifiés : ils sont figés par
`packages/engine/FROZEN.sha256` et `packages/engine/test/frozen.test.ts`.

## Ce qui est réellement comparé

| Méthode | Ce qui est produit | Comparé à | Résultat (12/11/2026) |
|---|---|---|---|
| 1. Build d'origine dans Chromium (`scripts/verify-legacy-bundle.mjs`) | export par l'interface de la v0.2, 8 motifs × 3 formats | registre v0.2.0 | 24/24 identiques |
| 2. Moteur extrait sous Node (`test/reference.test.ts`, à chaque `npm test` et en CI) | `traceImage` → `buildPlan` → `writePES1` / `writePES6` / `writeDST` | registre v0.2.0 | 24/24 identiques |
| 3. Relecture indépendante (`scripts/verify-references.mjs` + pyembroidery 1.5.1) | lecture des 24 fichiers | lecteurs VYRA (points, changements de couleur, dimensions) | 24/24 concordants |
| 4. Export par l'API (`apps/api/test/projects.test.ts`) | export serveur du motif 02-fleur | encodeurs du moteur | octets identiques |

Les 24 fichiers « motifs » sont donc **reproduits et vérifiés octet pour octet**. Les 21 fichiers du kit d'essais
XE1 (`xe1-kit/T1` à `T7`) n'ont **jamais été comparés** : leurs octets ne sont pas disponibles et le script qui
les générait (dans `02_TOOLS/` du dépôt source) n'est pas dans le build. Leurs empreintes sont conservées telles
quelles pour une vérification future.

Recherches effectuées pour retrouver les sources et le script du kit (12/11/2026) : 29 dépôts du compte GitHub
(commits, PR, code), deux builds d'artifact (« VYRA Studio », « StitchStudio AI » : aucune carte de sources,
aucune chaîne du kit), messagerie (« StitchStudio », « pes-validator », « xe1-kit ») — **aucun résultat**.

## Les 45 références

| Fichier | Empreinte | Statut |
|---|---|---|
| `motifs/01-chat.dst` | `320e984e2a27f19e…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/01-chat.pes` | `dc5963b4d6fe04e7…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/01-chat.v6.pes` | `43d51fb62d632985…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/02-fleur.dst` | `c78e0c5b7b669b21…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/02-fleur.pes` | `2c3ad4431a9567fc…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/02-fleur.v6.pes` | `7b932bce2ac0fa13…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/03-papillon.dst` | `c7e5ba588c970018…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/03-papillon.pes` | `4128c6455c5fdb2a…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/03-papillon.v6.pes` | `825abd4ca48a0081…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/04-logo.dst` | `fb880bcb7e3cbe08…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/04-logo.pes` | `657f2db9225f731a…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/04-logo.v6.pes` | `15eca6ad652e2c43…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/05-prenom.dst` | `c56094a207074d5b…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/05-prenom.pes` | `330ebf39e51d270d…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/05-prenom.v6.pes` | `1c2485eb5e7606b7…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/06-motif-arabe.dst` | `b8f86cb6613e49a6…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/06-motif-arabe.pes` | `8559fda21c6708fd…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/06-motif-arabe.v6.pes` | `b10bcf3afb5e7cdb…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/07-geometrique.dst` | `53c2e69e9835dde1…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/07-geometrique.pes` | `297f02938abb79ef…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/07-geometrique.v6.pes` | `3f08f0b79f5c4c26…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/08-illustration.dst` | `2d7bee46a7b3d2a4…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/08-illustration.pes` | `5f99cfc908894033…` | **Comparé à un export réel** (3 méthodes) |
| `motifs/08-illustration.v6.pes` | `05552d7f698b23f3…` | **Comparé à un export réel** (3 méthodes) |
| `xe1-kit/T1-mesure.dst` | `ce876c02a4947371…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T1-mesure.pes` | `8314c7ee4877265b…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T1-mesure.v6.pes` | `fbc9305f52319fd6…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T2-couleurs-coupes.dst` | `e32b4a26951c71fd…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T2-couleurs-coupes.pes` | `bfa5ad0841d1e9db…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T2-couleurs-coupes.v6.pes` | `5e70cf734f0ef7a5…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T3-densite.dst` | `c9670a19237e3566…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T3-densite.pes` | `e6d27757eab74fee…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T3-densite.v6.pes` | `b95cd8430d625984…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T4-satin.dst` | `843c3d89c7d20ed5…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T4-satin.pes` | `58b6e8495c264b3c…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T4-satin.v6.pes` | `edc0782c221058f5…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T5-compensation.dst` | `3db8ba8ac3c5ddcd…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T5-compensation.pes` | `290293406c803ad3…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T5-compensation.v6.pes` | `a7cc6c32366c19ce…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T6-sous-couches.dst` | `b35e386b9d8c0abf…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T6-sous-couches.pes` | `a072e3eb08fb872b…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T6-sous-couches.v6.pes` | `e5076bee448cd0cf…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T7-petits-details.dst` | `f9e1014d71661887…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T7-petits-details.pes` | `a1cb32f495b1953e…` | Empreinte seule : fichier et générateur absents |
| `xe1-kit/T7-petits-details.v6.pes` | `bbe85d5e1f9e79aa…` | Empreinte seule : fichier et générateur absents |

Compter : 24 « comparé », 21 « empreinte seule ».

## Rejouer les vérifications

```bash
npx vitest run --project engine
node packages/engine/scripts/verify-legacy-bundle.mjs
PYTHON=python3 node packages/engine/scripts/verify-references.mjs
grep -v '^#' packages/engine/FROZEN.sha256 | sha256sum -c
```
