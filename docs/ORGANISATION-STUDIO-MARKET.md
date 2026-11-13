# VYRA — Inventaire, situation de référence, séparation Studio / Market, préparation du LOT 2

13/11/2026. Rapport de décision. Aucune branche créée, fusionnée, déplacée ou supprimée ; `main` intacte ;
moteur et fichiers de référence non modifiés ; rien déployé ; aucun compte fournisseur.

## 1. Inventaire

### 1.1 Méthode

| Source examinée | Moyen | Résultat |
|---|---|---|
| Clones locaux `vyra` et `optiteam` de cette session | branches, étiquettes, reflog, remise, arbres de travail, objets non atteignables (`git fsck`) | aucune trace de `refonte/ux-ui`, `c98b796`, `d3d9472` |
| Références distantes de `vivonswebdev/vyra` et `vivonswebdev/optiteam` | `git ls-remote` | aucune |
| 32 dépôts GitHub du compte | recherche GitHub (dépôts, code, commits, demandes de fusion) | VYRA seulement dans `vyra` ; « refonte » seulement dans d'autres produits (ParkQuest, mamanrose, construct-pro…) ; la recherche couvre les branches par défaut seulement |
| Sessions Claude du compte | liste des sessions cloud et des agents joignables | une seule session VYRA : celle-ci |
| Dossiers de vos ordinateurs (Remote Control) | liste des dossiers partagés | deux dossiers, « Developer » et « CLAUDE », **inaccessibles** : le nom de l'ordinateur contient des caractères non affichables |
| Messagerie | recherche des trois identifiants | aucune occurrence VYRA |
| Pages publiées (artifacts) | liste, puis lecture des pages VYRA / StitchStudio | **trois pages déterminantes** (ci-dessous) |

### 1.2 Ce que les pages publiées établissent

| Page | Contenu vérifié |
|---|---|
| « VYRA Studio » | Build publié de l'application navigateur v0.2.0. **Identique octet pour octet** au build figé `legacy/vyra-studio-0.2/index.html` (`ece66075…`), source de l'extraction du moteur. Son registre `empreintes-reference-v0.2.0.sha256` est identique au registre figé (`719ef6c6…`) et déclare : « 45 fichiers PES/DST de référence (étiquette v0.2.0, commit `d3d9472e…`) ». |
| « StitchStudio AI » | Autre build de la même application, publié plus tôt (`149a2206…`). Ses 8 motifs sont identiques aux motifs figés. **Exécuté dans Chromium : 24 exports sur 24 identiques au registre v0.2.0** (même moteur pour ces fichiers). |
| « Refonte StitchStudio — phases 1 et 2 » | Rapport d'une refonte UX/UI menée sur la **branche `refonte/ux-ui` du dépôt source StitchStudio, partie du commit `f4e4006`**. Ce dépôt contient les sources `src/engine/*.ts`, `App`, `i18n.ts`, 22 tests unitaires et 14 tests navigateur, l'étiquette `v0.2.0`, et range ses fichiers sous `00_ADMIN/`, `02_TOOLS/`, `13_EXPORTS/`, `16_BENCHMARKS/`. |

### 1.3 Conclusion de l'inventaire

- **`refonte/ux-ui`, `c98b796` et `d3d9472` existent**, dans le dépôt source d'origine de StitchStudio / VYRA.
  Ce dépôt n'est sur aucun des 32 dépôts GitHub accessibles. L'hypothèse la plus probable est un dépôt local sur
  votre ordinateur (dossiers « Developer » ou « CLAUDE »), travaillé par une session qui n'est pas dans le cloud.
  Je ne peux pas le confirmer sans y accéder.
- Correction de mon rapport précédent : `d3d9472` n'était pas inconnu du dépôt `vyra`. Le registre figé et
  `docs/REFERENCES.md` le citent depuis le lot 0 comme étiquette du dépôt source, dépôt déjà signalé introuvable.
- Je n'ai récupéré aucun code de ces sources. Les pages ont seulement été lues et comparées dans un dossier de
  travail temporaire.

### 1.4 Pour me donner accès au dépôt d'origine (à faire de votre côté, au choix)

1. Renommer l'ordinateur (ou le dossier) dans le partage Remote Control avec des caractères simples ; je pourrai
   alors demander l'accès au dossier, en lecture.
2. Ou, depuis le dossier du dépôt sur votre ordinateur, envoyer l'état à vérifier :

```bash
git branch -a -vv
```

```bash
git log --oneline -12 refonte/ux-ui
```

```bash
git rev-parse v0.2.0 c98b796 f4e4006
```

3. Ou le pousser vers un **nouveau** dépôt privé GitHub (création de dépôt : votre décision).

## 2. Situation de référence

| Dépôt | Branche | Commit | Dernier lot présent | Présent | Absent | Moteur | Tests | Risques de divergence |
|---|---|---|---|---|---|---|---|---|
| Dépôt source StitchStudio / VYRA (local, emplacement non confirmé) | `main` | `d3d9472` (étiquette `v0.2.0`) ; au-delà : inconnu | v0.2.0 | Application navigateur seule : import d'image, analyse, éditeur, contrôle qualité (16 règles), simulation, exports PES v1 / v6 / DST, 4 langues, nuanciers, fiche | Comptes, serveur, projets multiples, sécurité serveur | **Sources TypeScript d'origine** (`src/engine/`) — référence | 22 unitaires + 14 navigateur (d'après le rapport, non vérifié) | Inaccessible ; seule copie des sources du moteur |
| même dépôt | `refonte/ux-ui` | `c98b796` (sous-lot 3.4 validé par vous) ; base `f4e4006` | Refonte UX, phase 3, sous-lots 3.3–3.4 | D'après le rapport et votre message : panneaux contextuels, Simple / Expert comme filtre d'affichage, pincement et deux doigts, barre de zoom | 3.5 (nouveau projet, suppressions confirmées, modes) | Annoncé inchangé | Non vérifiables par moi | Diverge de la plateforme : architecture, stockage (`stitchstudio.project.v1`), palette (vert profond, or, crème, rose poudré) |
| Page « VYRA Studio » | — | build `ece66075` | v0.2.0 publiée | Application v0.2.0 + registres | — | Identique au build figé | 24/24 (lot 3) | Aucun : instantané |
| Page « StitchStudio AI » | — | build `149a2206` | v0.2 (nom précédent) | Même application | — | 24/24 exports identiques (ce jour) | — | Faible : instantané plus ancien |
| `vivonswebdev/optiteam` | `claude/sleepy-knuth-uw65mf` | `fa88c6d` | VYRA lots 0–2, dans `vyra/` | = `vyra/main` (arbre identique) | — | Copie figée | — | **Copie obsolète** dans un dépôt d'une autre application ; à ne plus faire évoluer. `main` d'OptiTeam ne contient pas VYRA. |
| `vivonswebdev/vyra` | `main` | `e4ffbe1` | Lots 0–2 | Plateforme : API, comptes, projets, Studio React, exports serveur | Lot 3, 3.1, Market | Extrait figé | **Jamais passée en CI** (la CI date du lot 3) | En retard de 20 commits sur la branche de travail |
| `vivonswebdev/vyra` | `claude/sleepy-knuth-uw65mf` | `58dcdf2` | Studio 3.1 (`10893e5`) + Market 0–1 | Plateforme complète : 2FA, sessions, anti-énumération, antivirus, S3, e-mails, production compilée ; Studio : poignées, copier/coller, erreurs traduites ; Market : profils pro, permissions | Écrans Market, refonte UX | Figé, 34/34, registre `719ef6c6…` | 229 unitaires et API, 27 navigateur, archive en production ; **CI verte** | Mélange Studio et Market sur une branche ; non fusionnée |

### 2.1 Version de Studio qui doit servir de référence

Deux Studios coexistent et partagent **le même moteur v0.2.0** (prouvé par les empreintes) :

- **S1 — Studio navigateur d'origine** (`refonte/ux-ui`) : conception d'interface la plus avancée, validée par
  vous jusqu'au 3.4 ; application sans serveur.
- **S2 — Studio de la plateforme** (`vyra`) : comptes, projets en base, exports serveur, sécurité, CI ; base
  indispensable au Market.

**Recommandation.**
- **Référence technique : S2** (`vyra`, `10893e5`).
- **Référence d'expérience : S1 `refonte/ux-ui` à `c98b796`.** Sa conception (espaces en panneaux contextuels,
  Simple / Expert, gestes, confirmations) se **reporte** dans le Studio de S2, écran par écran, avec ses tests.
  Le code de S1 ne se fusionne pas : architectures, stockage et tests sont différents.
- **Référence du moteur : l'étiquette `v0.2.0` (`d3d9472`).** Une fois le dépôt d'origine accessible, ses
  sources `src/engine/*.ts` peuvent rejoindre `vyra` en lecture seule, si et seulement si leur compilation
  reproduit les 45 empreintes (transfert : votre accord).
- **Palette :** S1 utilise vert, or, crème et rose ; votre identité validée est Warm Wood. À trancher avant de
  reporter la refonte.

## 3. Architecture cible et séparation

### 3.1 Principe

```
              ┌──────────── VYRA Studio ────────────┐   ┌──────────── VYRA Market ────────────┐
apps          │ apps/studio  (/studio/)             │   │ apps/market (/market/)  apps/admin  │
              └───────────────┬─────────────────────┘   └───────────────┬─────────────────────┘
API           routes/studio/* │                          routes/market/* │  (désactivables)
              ────────────────┴────────── socle commun ─────────────────┴────────────────────
packages      platform : comptes, sessions, 2FA, permissions, fichiers + antivirus, stockage, e-mails,
              audit, limitation de débit, santé ; ui : identité, session, composants, langues ;
              shared : contrats ; engine : moteur figé (lecture seule)
```

**Règle de dépendance : Studio → socle ← Market.** Studio ne connaît pas le Market. Le Market lit le Studio
seulement par une interface publique : exporter un projet, créer un brouillon d'annonce.

### 3.2 Garanties que le Market ne bloque pas Studio

| Garantie | Mise en œuvre |
|---|---|
| Aucune importation de Market dans Studio | Test d'architecture en CI : échec si `apps/studio` ou `routes/studio` importe `market` |
| Studio déployable sans Market | `MARKET_ENABLED=false` : routes Market non enregistrées, application `/market/` non servie |
| Données séparées | Tables Market dans des migrations à part, sans clé étrangère depuis les tables Studio ; Studio ne lit aucune table Market |
| CI séparée | Jobs Studio / Market / socle, filtrés par chemins ; un échec Market ne bloque pas une version Studio qui ne touche pas au socle |
| Versions indépendantes | Étiquettes `studio-vX.Y.Z` et `market-vX.Y.Z` ; archives de version distinctes |
| Socle stable | Toute modification du socle exige les suites Studio **et** Market vertes |

### 3.3 Organisation Git proposée (rien n'est fait sans votre accord)

| Étape | Action | Nature |
|---|---|---|
| 1 | Revoir puis fusionner le lot 3.1 dans `main` **jusqu'à `10893e5` uniquement** | ✋ fusion |
| 2 | Créer `market/develop` depuis `main` fusionnée et y reporter `c36fc4b` et `58dcdf2` (Market 0–1), sans changement | ✋ création de branche |
| 3 | Travaux Studio sur `studio/<lot>`, Market sur `market/<lot>`, socle sur `platform/<sujet>`, intégration par `main` protégée | règle |
| 4 | Mettre en place le test d'architecture, l'option `MARKET_ENABLED` et les jobs de CI séparés | lot technique réversible |
| 5 | Ne plus faire évoluer la copie VYRA d'OptiTeam ; la signaler obsolète dans son README (sans suppression) | ✋ OptiTeam |
| 6 | Rattacher le dépôt d'origine (S1) : lecture, puis report de la refonte UX dans `studio/refonte-ux` | ✋ accès et transfert |

**Dépôts séparés ?** Pas maintenant. Un monorepo avec ces garanties évite de publier et versionner des paquets
du socle à chaque changement. Si le Market a un jour son équipe ou son rythme propre, `git subtree split` permet
d'extraire `apps/market` dans `vivonswebdev/vyra-market` avec l'historique, le socle étant alors publié comme
paquets privés. Coût : versions du socle à gérer, double CI. ✋ toute extraction.

## 4. LOT 2 — plan des écrans (non développés)

### 4.1 Écrans

| Écran | Adresse | Contenu | Données |
|---|---|---|---|
| Profil acheteur | `/market/compte` | Nom affiché, pays, langues, préférences ; liens vers sécurité (2FA, appareils) du socle | `users` + préférences ; adresses de livraison au lot 10 |
| Devenir vendeur | `/market/vendre` | Explication, puis formulaire : adresse publique avec vérification de disponibilité, type d'activité, professionnel ou particulier, pays, langues, présentation | `seller_profiles` (lot 1) |
| Tableau de bord vendeur | `/market/pro` | Carte de statut et liste de contrôle avant vérification (profil complet, 2FA, au moins un élément de portfolio, présentation) ; accès aux sections. **Aucun chiffre tant qu'il n'existe pas de donnée réelle** (ventes, revenus : lots 7-8) | profil, portfolio, statut |
| Présentation professionnelle | `/market/pro/presentation` | Nom, type, pays, langues, texte ; avertissement si une modification renvoie un profil vérifié en examen | `seller_profiles` |
| Portfolio | `/market/pro/portfolio` | Grille d'éléments : photos (quarantaine + antivirus), titre, description, support, technique, date ; ordre ; suppression **avec confirmation** | nouveau : `portfolio_items` |
| Services proposés | `/market/pro/services` | Catégories de services déclarées (numérisation, broderie sur vêtement, création de motif, vente de fichiers…). Les offres avec prix arrivent au lot 4. | nouveau : `seller_services` |
| Matériel | `/market/pro/materiel` | Machines, cadres, surface maximale **déclarée par le vendeur**, affichée comme telle | nouveau : `seller_equipment` |
| Statut de vérification | `/market/pro/verification` | Chronologie des statuts, motif d'un refus, éléments à corriger, soumission (avec activation de la 2FA si besoin). Bloc « identité légale du vendeur professionnel » : contenu exact après avis juridique ✋ | `seller_status_events` |
| Profil public | `/market/<adresse>` | En-tête (nom, type, pays, langues, membre depuis, badge « profil vérifié par VYRA » qui ne garantit pas la qualité), présentation, portfolio, services, matériel déclaré | profils vérifiés seulement |
| Examen des profils (minimal) | `/admin/vendeurs` | File d'attente, fiche, décision motivée, historique. Sans cet écran, la vérification reste réservée à l'API. | routes du lot 1 |

### 4.2 Responsive

| Largeur | Disposition |
|---|---|
| Ordinateur (≥ 1 200 px) | Espace pro : navigation latérale, contenu, carte de statut à droite. Profil public : deux colonnes, portfolio en 3–4 colonnes. |
| Tablette (768–1 199 px) | Navigation en onglets en haut, carte de statut en tête, portfolio en 2–3 colonnes, formulaires sur une colonne large. |
| Mobile (< 768 px) | Une colonne, sections accessibles par une liste, action principale fixée en bas, portfolio en 2 colonnes, cibles tactiles ≥ 44 px. |
| Tous | Arabe de droite à gauche (propriétés CSS logiques), trois thèmes, aucun défilement horizontal, états vide / chargement / erreur traduits, refus de permission expliqués avec l'action à faire (ex. activer la 2FA). |

### 4.3 Tests prévus

Permissions de chaque nouvelle route (propriétaire seul pour modifier, public seulement si vérifié) ;
parcours navigateur aux trois largeurs : création du profil, présentation, ajout d'une photo de portfolio
(antivirus), soumission avec 2FA, vérification par un modérateur, profil public ; suppression confirmée puis
annulable ; quatre langues dont l'arabe ; trois thèmes ; empreintes du moteur avant et après.

## 5. Décisions attendues

1. Accès au dépôt d'origine (§1.4).
2. Référence : S2 comme base technique, S1 `c98b796` comme référence d'expérience (§2.1), et palette à retenir.
3. Organisation Git (§3.3), dont la fusion du 3.1 jusqu'à `10893e5` et la branche `market/develop`.
4. Démarrage du LOT 2 selon le §4.
