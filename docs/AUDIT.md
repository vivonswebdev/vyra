# LOT 0 — Audit de l'existant et décision d'architecture

Date : 12/11/2026. Branche : `claude/sleepy-knuth-uw65mf` du dépôt `vivonswebdev/optiteam`.

## 1. Ce qui existait réellement

| Élément | Où | Constat |
|---|---|---|
| Dépôt Git attaché à la session | `vivonswebdev/optiteam` | Cockpit OptiTeam, OptiCompta, veille GitHub. **Aucune ligne de VYRA.** |
| Dépôt source de StitchStudio / VYRA (`src/engine/*.ts`, étiquette `v0.2.0`, commit `d3d9472e`) | Introuvable | Absent des 29 dépôts du compte GitHub accessibles ; aucun commit, aucune PR ne le mentionne. Probablement local ou sur un autre compte. |
| Artifact « VYRA Studio » | claude.ai | Build Vite/React d'un seul fichier (2,1 Mo) + 8 motifs PNG + registre d'empreintes v0.2.0 + registre d'essais XE1. **Seule source exploitable.** Copie conservée dans `legacy/vyra-studio-0.2/`. |
| Document « Refonte StitchStudio — phases 1 et 2 » | claude.ai | Audit fonctionnel de la v0.2 (inventaire, 22 tests unitaires, 14 tests navigateur décrits). |
| Document « VYRA — identité Warm Wood » | claude.ai | Palette, contrastes mesurés, typographies. Appliqué dans `packages/ui/src/tokens.css`. |

### Mesure du moteur existant

L'artifact a été exécuté dans Chromium sans modification : les 8 motifs de test exportés en PES v1, PES v6 et DST
donnent **24 fichiers identiques octet pour octet au registre d'empreintes v0.2.0**. Le moteur publié est donc
intact. Les 21 autres fichiers de référence (kit d'essais XE1, T1 à T7) étaient produits par un script du dépôt
source, absent du build : leurs empreintes sont conservées, pas leurs octets.

Ce que la v0.2 savait faire (vérifié dans le build) : analyse d'image déterministe (couleurs, zones, contours,
fond, choix du type de point), plan de couture (ordre, déplacements, coupes, arrêts), 8 types de point,
contrôle qualité (26 codes, 3 niveaux, blocage de l'export), encodeurs PES v1/v6/DST, rendu fidèle (fil
réaliste, directions, densité, types), simulation, profils machine (Brother XE1 sourcé, autres « à compléter »),
palette PEC, import de nuanciers CSV sourcés, traductions FR/NL/EN/AR des messages, registre d'essais.

Ce qui manquait : comptes, serveur, base de données, plus d'un projet, historique persistant, partage entre
appareils, Marketplace, paiements.

## 2. Matrice de décision

| Partie | Décision | Raison | Risque | Coût de maintenance |
|---|---|---|---|---|
| Moteur (analyse, plan, points, QC, encodeurs, rendu) | **Conserver tel quel**, extrait du build | Seule partie stratégique et prouvée ; aucune instruction modifiée ; 24 empreintes vérifiées | Code minifié : noms locaux illisibles | Faible tant qu'il est figé ; à remplacer par les sources d'origine dès qu'elles sont fournies |
| Façade typée du moteur | **Reconstruire** (`packages/engine/src/index.ts`) | L'interface et l'API doivent passer par un contrat typé, pas par le code minifié | — | Faible |
| Lecteurs PES/DST | **Créer** | Indispensables au Marketplace (fiche technique et aperçu des fichiers vendeurs) | Variantes PES non couvertes (fichiers d'autres logiciels) | Moyen ; validés contre pyembroidery sur 24 fichiers |
| Interface du Studio (App.tsx de 999 lignes) | **Reconstruire** | Sources indisponibles ; un seul composant ; un seul projet en `localStorage` | Régression d'ergonomie par rapport à la v0.2 | Moyen |
| Chargement d'images | **Conserver** (canvas, 1 600 px) + **remplacer** l'appel à pdf.js par le paquet `pdfjs-dist` | Même pixels que la v0.2 ; pdf.js à jour (faille corrigée) | — | Faible |
| Persistance `localStorage` (`stitchstudio.project.v1`) | **Remplacer** par PostgreSQL via l'API | Un seul projet, perdu au changement d'appareil | Les anciens projets locaux ne sont pas importés automatiquement (voir §5) | — |
| Traductions | **Conserver** celles du moteur ; **reconstruire** celles de l'interface | Tests de complétude dans les 4 langues | — | Faible |
| Thème | **Reconstruire** sur les jetons Warm Wood | Clair, sombre, automatique, enregistré dans le profil | — | Faible |
| Livraison dans claude.ai (`window.claude`, capacité *downloads*) | **Abandonner** | Remplacé par des téléchargements authentifiés servis par l'API | — | — |
| Cockpit OptiTeam, OptiCompta | **Ne pas toucher** | Hors périmètre ; VYRA vit dans `vyra/`, ignoré par le build Vercel d'optiteam | — | — |

## 3. Architecture retenue

```
vyra/
  packages/engine   moteur figé + façade typée + lecteurs PES/DST (navigateur et Node)
  packages/shared   contrats d'API (zod), rôles, argent en centimes
  packages/ui       identité Warm Wood, i18n, session, client d'API, écrans de compte
  apps/api          Fastify + PostgreSQL : comptes, projets, fichiers, exports (Market : lots 5 à 7)
  apps/studio       VYRA Studio (React, Vite)
  apps/market       VYRA Market (lots 5 à 7)
  e2e/              tests navigateur (Playwright)
  legacy/           build v0.2 d'origine, oracle de non-régression
```

Décisions détaillées : [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 4. Risques principaux

1. **Sources d'origine du moteur absentes.** Le moteur extrait est exact (empreintes) mais minifié : le faire
   évoluer sans les sources est risqué. Action demandée : attacher le dépôt StitchStudio/VYRA d'origine pour
   remplacer `src/generated/engine.js` par `src/engine/*.ts` et récupérer les 22 tests unitaires et le script du
   kit XE1.
2. **Dépôt d'accueil.** VYRA vit dans `vyra/` du dépôt `optiteam` faute d'autre dépôt accessible en écriture.
   Recommandation : créer `vivonswebdev/vyra` puis `git subtree split --prefix=vyra` (historique conservé).
3. **Paiements.** L'API Stripe n'est pas joignable depuis cet environnement ; aucun compte marchand n'est
   configuré (et ne le sera pas sans votre accord).
4. **TVA sur les ventes numériques dans l'UE** : une place de marché qui encaisse peut être réputée prestataire
   (règlement d'exécution 282/2011, art. 9 bis). À valider avec votre comptable avant le lot 7.
5. **Qualité physique.** Un fichier lisible par la machine n'est pas une broderie réussie : aucun essai n'est
   enregistré dans le registre XE1 (18 fichiers « Non testé »). L'interface ne parle jamais de « compatibilité ».

## 5. Points non repris de la v0.2 (à décider)

- Import automatique des projets enregistrés dans le navigateur par l'ancien Studio (`stitchstudio.project.v1`) :
  faisable (lecture du `localStorage` à la première connexion), non fait.
- Bibliothèque de nuanciers importés (CSV) : le moteur la sait faire (`parseChartCsv`), l'interface ne l'expose
  pas encore ; seule la palette PEC est proposée.
- Fiche de préparation imprimable (ordre des bobines) : à refaire dans le panneau Export.
- Modes d'affichage « directions / densité / types » : disponibles en mode Expert.
