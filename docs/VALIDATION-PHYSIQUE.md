# Protocole de validation sur machine à broder

**Aucune compatibilité machine n'est annoncée par VYRA sans essai physique enregistré et contrôlé.**
À ce jour (12/11/2026), le registre `xe1-essais.json` compte 18 fichiers, **tous « Non testé »**.

## 1. Ce que prouvent les tests logiciels, et ce qu'ils ne prouvent pas

| Preuve logicielle (automatique, en CI) | Ce qu'elle établit | Ce qu'elle n'établit pas |
|---|---|---|
| Empreintes v0.2.0 (`test/reference.test.ts`, `verify-legacy-bundle.mjs`) | Le moteur produit exactement les mêmes octets que la v0.2.0 | Que ces octets donnent une bonne broderie |
| Relecture pyembroidery + lecteurs VYRA | Fichier bien formé, points, couleurs, dimensions cohérents | Qu'une machine donnée l'accepte |
| Contrôle qualité du moteur (densité, longueurs, cadre…) | Règles numériques respectées | Rendu sur un tissu réel |

**Seul un essai sur machine**, documenté selon ce protocole, peut faire passer un fichier de « Non testé » à
« Testé et accepté » ou « Validé pour Brother XE1 ». La lecture du fichier par la machine est enregistrée à part :
elle prouve que le fichier est lisible, jamais que la broderie est bonne.

## 2. Fichiers à essayer

Uniquement des fichiers dont l'empreinte figure au registre v0.2.0 (`docs/REFERENCES.md`) :

| Lot | Fichiers | Disponibilité |
|---|---|---|
| A — motifs | 8 motifs × PES v1, PES v6, DST (24 fichiers) | Régénérables octet pour octet : `node packages/engine/scripts/verify-references.mjs <dossier>` |
| B — kit XE1 (T1 mesure, T2 couleurs et coupes, T3 densité, T4 satin, T5 compensation, T6 sous-couches, T7 petits détails) | 21 fichiers | **Indisponibles** (script de génération perdu). À récupérer avec le dépôt source avant toute campagne B. |

Avant de copier un fichier sur la clé : vérifier son empreinte (`sha256sum`) contre `docs/REFERENCES.md`.
L'essai n'est valable que pour cette empreinte exacte (champ `sha256_fichier`).

## 3. Préparation (identique pour PES v1 et PES v6 d'un même motif)

Les essais v1 et v6 d'un même fichier doivent partager tissu, stabilisateur, aiguille, fils, tension, vitesse
et cadre ; sinon ils ne sont pas comparables (règle contrôlée automatiquement).

- Machine : modèle exact, version du micrologiciel (menu Réglages de la machine).
- Cadre : référence (ex. SA439S), dimensions intérieures **mesurées à la règle** (les dimensions métriques
  130 × 180 mm sont « à confirmer » dans le profil machine).
- Tissu : nature, grammage, couleur ; repassé, tendu, sans pli. Stabilisateur : type, grammage, nombre de couches.
- Aiguille neuve (type et taille), fil supérieur (marque, matière, poids), canette (marque, poids, couleur).
- Tension et vitesse : valeurs affichées par la machine, notées avant de commencer.

## 4. Déroulé d'un essai

1. **Lecture machine** : insérer la clé, ouvrir le fichier. Noter : fichier lu (oui/non), taille affichée,
   nombre de couleurs affiché, nombre de points affiché, noms de couleurs. Comparer à la fiche de préparation
   VYRA (`/studio/p/<id>/fiche`) : dimensions, points, changements de fil.
2. **Positionnement** : centrer, noter l'écart au centre du cadre mesuré après broderie.
3. **Broderie** : chronométrer ; noter chaque casse de fil, chaque arrêt, chaque coupe automatique observée et
   sa conformité à la séquence attendue (couleurs dans l'ordre de la fiche ; arrêts « même couleur »).
4. **Contrôle visuel** : photographier face et envers, à plat, lumière rasante, règle visible
   (`16_BENCHMARKS/essais/AAAA-MM-JJ/<fichier>-<v1|v6|dst>-face.jpg`).
5. **Mesures** : largeur et hauteur brodées (mm), écart de centre, écart de contour (superposition fond/contour),
   durée, casses de fil.
6. **Notes de qualité (0 à 3)** sur 8 critères : qualité des points, contours, fils visibles, déplacements
   cousus, coupes, densité, comportement des couleurs, lisibilité.
   0 inacceptable · 1 défaut visible · 2 acceptable · 3 aucun défaut visible.
7. **État du tissu après** : plis, fronces, gondolage, trous, marques du cadre.
8. **Anomalies** : code, description, gravité (mineure, majeure, bloquante), ouverte ou résolue.

## 5. Spécificités par format

| Format | À vérifier en plus |
|---|---|
| PES v1 | Format conseillé par défaut ; couleurs affichées = palette PEC la plus proche (pas les couleurs exactes). |
| PES v6 | Lecture par la machine (non garantie sur tous les modèles) ; noms et codes de fils affichés. |
| DST | Aucune couleur dans le fichier : la machine attribue les siennes ; vérifier les arrêts de changement de fil et les coupes (commandes de saut). |

## 6. Saisie et contrôle

Les essais sont saisis dans une **copie** du registre (le registre de référence reste figé), au format de
`exemple_essai`, puis contrôlés :

```bash
node packages/engine/scripts/check-registre.mjs chemin/vers/xe1-essais.json chemin/vers/dossier-photos
```

Le contrôleur refuse : statut sans essai, date absente ou future, empreinte différente du fichier de référence,
condition manquante, texte d'aide recopié, note hors de 0 à 3, photo hors de `16_BENCHMARKS/essais/` ou
introuvable, acceptation sans lecture machine / 8 notes / mesures / photo, validation avec anomalie ouverte ou
note < 2, essais v1/v6 non comparables.

## 7. Règles de communication

- « Validé pour Brother XE1 » ne vaut que pour **ce fichier**, **ce format** et **ces conditions**.
- Aucune mention « compatible » dans l'interface ou le Marketplace sans statut validé correspondant.
- Un résultat négatif s'enregistre (« Testé avec anomalie ») : il ne se supprime pas.

## 8. Contrôle matériel des appareils tactiles (restant à réaliser)

Les gestes du Studio (pincement avec zoom centré sur les doigts, déplacement à deux doigts, annulation d'un
geste en cours quand un second doigt se pose, poignées d'échelle et de rotation, boutons copier/coller) sont
testés dans Chromium avec des événements tactiles simulés (tests navigateur « tablette » et « mobile »). Cette
validation technique intermédiaire **ne remplace pas** un essai sur appareils réels.

| Appareil | Navigateur | Statut |
|---|---|---|
| iPhone (modèle et version d'iOS à noter) | Safari | **Non réalisé** |
| iPad (modèle et version d'iPadOS à noter) | Safari | **Non réalisé** |

À noter pour chaque essai : appareil, version du système, date, testeur, gestes essayés, résultat, captures.
Aucune mention de compatibilité iPhone ou iPad avant ces essais.
