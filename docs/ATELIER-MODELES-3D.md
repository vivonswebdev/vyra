# Atelier vêtement — importer un modèle 3D

L'atelier affiche trois sortes de vêtements 3D (réglage **Apparence → Modèle 3D**) :

| Modèle | Ce que c'est |
| --- | --- |
| Maquette | Forme sculptée par l'atelier (T-shirt, sweat, hoodie). Valeur par défaut. |
| Simulation | Tissu simulé, qu'on peut tirer à la main. |
| Importé | Votre propre modèle 3D, chargé depuis un fichier. |

Ce guide décrit le troisième : comment préparer un fichier, ce que l'atelier en fait, et ses limites.

## Préparer le fichier

- **Format** : `.glb` (glTF binaire, un seul fichier) ou `.obj`.
- **Taille** : 40 Mo et 600 000 triangles au plus.
- **Contenu** : un vêtement seul, sans mannequin, sans décor.
- **Orientation** : debout, axe Y vers le haut, devant du vêtement vers +Z. C'est la convention glTF, et
  l'export par défaut de Blender. Si le modèle arrive de dos, le réglage « Inverser devant et dos » le retourne.
- **Unités** : indifférentes (mètres, centimètres…). L'atelier remet le modèle à l'échelle.
- **Sans compression** : la géométrie compressée (Draco, Meshopt) est refusée. Décochez la compression à l'export.
- **Un seul fichier** : un `.glb` qui dépend de fichiers externes (`.bin` séparé) est refusé.

Exports qui conviennent :

- **Marvelous Designer / CLO** : exporter le vêtement seul en OBJ ou glTF (`.glb`), « Single Object », sans avatar.
- **Blender** : Fichier → Exporter → glTF 2.0, format « glTF Binary (.glb) », compression décochée.

## Ce que fait l'atelier

1. **Lecture, dans le navigateur.** Le fichier n'est jamais envoyé au serveur. Il est gardé dans ce navigateur
   (IndexedDB), un modèle par projet, et relu à la réouverture de l'atelier.
2. **Nettoyage.** Seule la forme est gardée. Les textures, matières, animations et caméras du fichier sont
   retirées avant lecture ; aucune adresse externe n'est chargée.
3. **Mise à l'échelle.** Le corps du vêtement est repéré à l'ourlet, centré, puis mis à la largeur du vêtement
   choisi (T-shirt, sweat ou hoodie). Le haut des épaules est posé sous le cintre.
4. **Matière.** Le modèle reçoit la matière tissu de l'atelier : coloris, maille, éclairage de studio.
5. **Impressions.** Elles sont projetées à plat : la face avant reçoit la pièce « Devant » du patron, la face
   arrière la pièce « Dos ». Au milieu du buste, 1 cm de patron fait 1 cm sur le modèle.

## Limites actuelles

- **Manches unies.** Les impressions placées sur « Manche G », « Manche D » ou « Tout le vêtement » ne
  s'affichent pas sur les manches d'un modèle importé. Devant et dos seulement.
- **Projection à plat.** Sur les côtés du buste, là où le tissu tourne, une impression très large se resserre.
- **Dépliage du modèle ignoré.** Les coordonnées de texture (UV) du fichier ne sont pas utilisées. Un modèle
  livré avec un dépliage calé sur le patron de l'atelier pourrait porter les impressions partout, manches
  comprises : c'est l'évolution prévue.
- **Pas d'ombre des creux.** Le curseur « Plis et ombres » n'agit pas sur un modèle importé : ses plis
  viennent de sa forme et de l'éclairage.
- **Aperçu seulement.** Le modèle importé sert à l'aperçu 3D et à la photo. Il ne change ni le patron, ni les
  dimensions, ni les fichiers de production.

## Licence

Un modèle acheté ou téléchargé reste soumis à sa licence. Avant de publier des images faites avec, vérifiez
qu'elle autorise un usage commercial. Les maquettes fournies par l'atelier sont des formes propres à VYRA.

## Messages d'erreur

| Message | Cause |
| --- | --- |
| Fichier refusé : il faut un .glb ou un .obj. | Autre format (FBX, .gltf en plusieurs fichiers, image…). |
| Modèle trop lourd | Plus de 40 Mo ou de 600 000 triangles : simplifier le maillage. |
| Ce fichier ne contient aucune forme 3D. | Fichier vide, ou sans maillage. |
| Modèle compressé (Draco ou Meshopt) | Réexporter sans compression. |
| Ce .glb dépend de fichiers externes | Réexporter en un seul fichier `.glb`. |
| Modèle illisible | Fichier abîmé ou variante de format non prise en charge. |

## Code

- `apps/studio/src/atelier/importModel.ts` — nettoyage du `.glb`, lecture, ajustement et projection.
- `apps/studio/src/atelier/modelStore.ts` — stockage dans le navigateur.
- `apps/studio/test/atelier-import.test.ts` et `e2e/studio-atelier.spec.ts` — tests.
