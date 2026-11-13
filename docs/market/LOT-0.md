# VYRA Market — LOT 0 : audit, architecture, risques, plan d'exécution

13/11/2026. Document de décision : rien de ce qui est décrit ici n'est déployé, aucun compte marchand n'existe,
aucun paiement n'est activé. Les points marqués ✋ demandent votre accord avant exécution.

## 0. En bref

- **Le socle existe déjà** : comptes, double authentification, sessions, rôles (`seller`, `moderator`, `admin`),
  fichiers privés avec quarantaine et antivirus, stockage S3, e-mails, journal d'audit, arithmétique monétaire
  en centimes, 4 langues, 3 thèmes, moteur figé consultable par une façade typée. Le Market s'ajoute à ce socle,
  dans le même dépôt et la même API, comme le prévoyaient les ADR-001, 005, 006, 007 et 008.
- **Architecture proposée** : une application web `/market/` (acheteurs et vendeurs) et une application
  `/admin/` (back-office), à côté de `/studio/` ; des modules d'API `market/*` et `admin/*` ; PostgreSQL ;
  paiements derrière une interface `PaymentProvider` (bac à sable pour les tests, Stripe Connect en mode test
  ensuite ✋).
- **Principe directeur** : le Market **montre ce qui est vérifié et dit d'où vient chaque information**. Les
  métadonnées techniques d'un fichier (points, dimensions, couleurs) sont *calculées* par les lecteurs du moteur
  à partir du fichier déposé ; tout le reste est *déclaré* par le vendeur et affiché comme tel ; une
  compatibilité machine n'apparaît que si un essai physique est enregistré.
- **Risques majeurs** : obligations légales d'une place de marché dans l'UE (à valider avec un juriste),
  contrefaçon, fraude aux paiements, charge de modération. Aucun n'est bloquant pour les lots 1 à 7, qui restent
  réversibles.

## 1. Audit de l'existant

### 1.1 État Git vérifié avant intervention

| Élément | Constat |
|---|---|
| Dépôt `vivonswebdev/vyra` | `main` = `e4ffbe1` ; branche de travail `claude/sleepy-knuth-uw65mf` = `10893e5` (lot 3.1, CI verte, non fusionnée) |
| Branche `refonte/ux-ui`, commit `c98b796`, tag `v0.2.0` sur `d3d9472…` | Absents de `vivonswebdev/vyra` et `vivonswebdev/optiteam`. Ils appartiennent au dépôt source d'origine de StitchStudio / VYRA, non accessible : voir [`../ORGANISATION-STUDIO-MARKET.md`](../ORGANISATION-STUDIO-MARKET.md) |
| Moteur figé avant travaux | `FROZEN.sha256` : 34/34 fichiers conformes ; registre des 45 empreintes : `719ef6c6…770d2` |

### 1.2 Ce qui est réutilisable tel quel

| Besoin Market | Existant | Écart |
|---|---|---|
| Un compte pour acheter, vendre, créer | `users`, sessions, 2FA, anti-énumération, suppression et export RGPD | profil professionnel distinct à créer (lot 1-2) |
| Rôles | table `user_roles` (`seller`, `moderator`, `admin`), `hasRole` | matrice de permissions explicite, garde d'API, attribution journalisée (lot 1) |
| Fichiers vendeurs | `files` (types `product_file`, `product_preview`, `product_image` déjà prévus), quarantaine ClamAV, S3 privé, URL temporaires | droits de téléchargement liés aux commandes, journal des téléchargements (lot 9) |
| Lecture des PES/DST déposés | `readEmbroidery` (lecteurs PES/DST de la façade du moteur, validés sur les 24 exports de référence) | calcul et stockage des métadonnées « vérifiées » (lot 3) |
| Aperçus | rendu du plan par le moteur (navigateur), miniatures SVG côté serveur | aperçu d'un fichier déposé (lot 3) ; aucun changement du moteur |
| Publication depuis Studio | exports PES v1, PES v6, DST côté serveur, versions de projet | brouillon d'annonce créé depuis un export (lot 13) |
| Argent | `Money` en centimes, `commissionCents` (testé), config `PAYMENTS_PROVIDER` (`none` par défaut, bac à sable interdit en production) | tables de commandes, paiements, commissions, versements (lots 7-8) |
| Messages transactionnels | file d'envoi SMTP sans doublon, alertes | modèles Market (devis reçu, commande payée…) |
| Sécurité | CSRF, limitation de débit partagée, audit, CSP, en-têtes, tests | contrôles d'accès par ressource (vendeur propriétaire, acheteur de la commande) |
| Langues, thèmes, responsive | FR, NL, EN, AR (RTL), clair/sombre/auto, 3 largeurs testées | textes Market |

### 1.3 Ce qui n'existe pas

Catalogue, offres de services, configurateur, demandes de devis, messagerie, commandes, paiements, versements,
licences, suivi de production et d'expédition, avis, signalements, litiges, back-office, affiliation.

## 2. Architecture proposée

### 2.1 Applications et modules

```
apps/studio   /studio/   création (existant)
apps/market   /market/   vitrine, recherche, fiches, configurateur, espace acheteur, espace vendeur
apps/admin    /admin/    back-office (modération, vérification, litiges, remboursements, statistiques)
apps/api      /api/      modules : auth, me, projects (existants) + market/*, orders/*, payments/*, admin/*
packages/ui              identité Warm Wood, session, composants, traductions communes
packages/shared          contrats zod, rôles, permissions, argent, états des commandes
packages/engine          moteur figé : consommé en lecture (lecteurs, rendu, exports), jamais modifié
```

Le back-office est une application séparée : son code n'est jamais chargé par un visiteur, et l'accès exige
le rôle `moderator` ou `admin` **et** la double authentification active.

### 2.2 Identités et permissions

- Tout compte peut acheter et utiliser le Studio. Devenir vendeur = créer un **profil professionnel**
  (`seller_profiles`) : type d'activité, présentation, pays, langues, matériel, portfolio. Le rôle `seller`
  est accordé à ce moment ; publier des offres exigera la vérification du profil (lot 2) et la 2FA.
- Types de vendeur : brodeur indépendant, atelier, designer de motifs, digitaliseur, créateur de fichiers
  PES/DST, influenceur, marque, entreprise de personnalisation textile.
- Rôles d'équipe (plusieurs membres par atelier) : prévus dans le modèle, livrés plus tard (VYRA Business).
- Les permissions sont une matrice unique dans `@vyra/shared` (action × rôle), testée, utilisée par l'API et
  par les interfaces pour masquer ce qui n'est pas permis — le serveur reste la seule autorité.
- Créateur, vendeur et prestataire sont trois rôles distincts sur une même vente (collaborations
  influenceur-atelier) : chaque annonce porte un `creator_id`, un `seller_id` et, pour une prestation, un
  `provider_id`, avec une répartition des revenus explicite.

### 2.3 Modèle de données (créé lot par lot, migrations additives)

| Domaine | Tables (lot) |
|---|---|
| Profils | `seller_profiles`, `seller_equipment`, `portfolio_items` (1-2) |
| Catalogue numérique | `listings` (type `design`), `listing_files` (fichier + métadonnées calculées), `listing_media`, `licenses` (types et texte versionné), `collections` (3) |
| Offres de services | `service_offers`, `offer_tiers` (basic, standard, premium), `offer_options` (supplément par dimension, couleurs, quantité…) (4) |
| Configurateur | `customization_specs` (support, vêtement, taille, position, dimensions souhaitées, texte, police, couleurs, fichiers joints, quantité, date, budget) (5) |
| Devis | `quote_requests`, `quote_proposals` (prix, délai, description technique, formats, questions) (6) |
| Échanges | `conversations`, `messages` (pièces jointes en quarantaine) (7) |
| Commandes | `orders`, `order_items`, `order_events` (historique complet, horodaté, auteur) (7) |
| Argent | `payments`, `commission_rules`, `payouts`, `refunds` (8) |
| Droits | `entitlements` (droit de téléchargement né d'une commande payée), `download_log` (9) |
| Production | `shipments`, `production_steps` (10) |
| Confiance | `reviews` (une par ligne de commande terminée), `reports`, `moderation_actions`, `disputes` (11) |
| Croissance | `promo_codes`, `affiliate_links`, `affiliate_conversions` (8 et 12) |

### 2.4 Cycle de commande

```
Prestation : demande → devis → accepté → paiement en attente → payé → en production → contrôle
             → expédié → reçu → terminé (avis possible)
Fichier    : panier → paiement en attente → payé → droit de téléchargement → terminé
Sorties    : annulé (avant production), remboursé (total ou partiel), en litige → résolu
```

Chaque transition est une fonction serveur unique qui vérifie l'état de départ, l'auteur et ses droits, écrit
`order_events` et le journal d'audit. **« Payé » ne s'obtient que par un événement signé du prestataire de
paiement**, jamais par le navigateur.

### 2.5 Paiements (lots 8 et suivants)

- Interface `PaymentProvider` : `createCheckout`, `confirm` (webhook), `refund`, `transferToSeller`.
- Fournisseur **bac à sable** local pour les tests automatisés (déjà interdit en production par la configuration).
- **Stripe Connect** (comptes vendeurs Express, vérification d'identité par Stripe, charges et transferts
  séparés pour retenir les fonds jusqu'à la livraison) en mode test — à confirmer avec la documentation Stripe
  et votre conseil. Mangopay reste l'alternative européenne. ✋ création de compte, clés, passage en réel.
- VYRA ne voit ni ne stocke jamais de numéro de carte ou de coordonnées bancaires.
- Commission en points de base configurable (`commission_rules` : défaut, catégorie, vendeur, période), calculée
  en centimes par `commissionCents`.

### 2.6 Fichiers, métadonnées et licences

- Dépôt → quarantaine → ClamAV → **lecture par `readEmbroidery`** : un fichier illisible est refusé ; un
  fichier lu donne nombre de points, changements de couleur, dimensions de l'emprise. Ces valeurs sont
  affichées « calculées à partir du fichier ». Le vendeur ne peut pas les modifier.
- Formats : ceux que le moteur sait lire et vérifier (PES, DST). Un autre format peut être joint mais affiché
  « non vérifié par VYRA ».
- **Compatibilité machine** : affichée seulement si un essai physique est enregistré (même registre que
  `VALIDATION-PHYSIQUE.md`), avec machine, date, auteur. Sinon : « aucun essai physique enregistré ».
- Licences : personnelle, commerciale limitée, professionnelle, étendue — texte versionné, accepté à l'achat,
  inclus dans le téléchargement. Le vendeur déclare détenir les droits à chaque publication (horodaté).
- Téléchargement : droit vérifié → URL temporaire courte → journal (qui, quand, quel fichier, adresse IP
  tronquée) → limite de fréquence.

### 2.7 Configurateur

Il recueille l'intention du client (support, position, dimensions souhaitées, texte, police, couleurs, visuels,
quantité, date, budget) et produit une demande précise. L'aperçu est une **simulation visuelle** avec la mention
permanente « simulation, pas une garantie du résultat brodé ». Il n'affiche aucun nombre de points, aucune
compatibilité, aucune dimension « brodable » : ces valeurs viennent du professionnel ou du moteur lorsqu'un
fichier existe.

### 2.8 Recherche, langues, devise

Recherche plein texte PostgreSQL (par langue, sans accents) avant tout moteur externe. Contenus vendeurs dans
leur langue, interface en FR, NL, EN, AR. Prix en euros au départ (`Money`), autres devises plus tard.

### 2.9 Studio ↔ Market

« Publier dans Market » depuis un projet Studio crée une **annonce brouillon** avec les exports produits par le
serveur (même moteur, mêmes octets que l'export Studio), l'aperçu et la provenance (projet, version). Aucun
changement du moteur ; aucune donnée Studio n'est publiée sans action explicite du créateur.

## 3. Risques

| Risque | Impact | Réponse proposée | Décision |
|---|---|---|---|
| Obligations d'une place de marché dans l'UE (DSA : traçabilité des vendeurs professionnels, signalement et motivation des décisions ; P2B ; DAC7 : déclaration des revenus des vendeurs ; droit de la consommation : rétractation, exceptions pour contenu numérique et produits personnalisés ; TVA ; sécurité des produits physiques) | Juridique, bloquant pour l'ouverture | Données et écrans prévus dès les lots 1-2 et 11 ; **validation par un juriste et un fiscaliste avant ouverture** | ✋ vous |
| Contrefaçon (logos de marques, personnages) | Juridique, réputation | Déclaration de droits, signalement, retrait, historique ; refus des logos sans autorisation documentée | ✋ politique |
| Fraude, rétrofacturations, comptes vendeurs frauduleux | Financier | Vérification vendeur, KYC par le prestataire de paiement, retenue des fonds jusqu'à livraison, 2FA vendeur | lot 8 |
| Piratage des fichiers vendus | Revenus vendeurs | Téléchargements journalisés et limités ; pas de DRM possible sur un PES/DST | accepté |
| Annonce technique trompeuse | Confiance, juridique | Métadonnées calculées par le moteur, origine affichée, compatibilité seulement après essai | règle |
| Moteur gelé fragilisé | Critique | Lecture seule via la façade ; empreintes vérifiées avant et après chaque lot ; tests d'intégrité en CI | règle |
| Charge de modération | Coût | File de modération, priorités, signalements groupés | lot 11 |
| Marché vide au lancement | Commercial | Commencer par la vente de fichiers et les créateurs (lots 3, 8) | stratégie |
| Dérive vers un ERP | Délai | VYRA Business limité aux besoins validés | règle |
| Paiement réel ou déploiement par erreur | Critique | Configuration de production qui refuse le bac à sable ; aucun secret dans le code ; ✋ | règle |

## 4. Plan d'exécution

| Lot | Contenu | Réversible ? |
|---|---|---|
| 0 | Ce document | oui |
| 1 | Modèle des identités : profil professionnel, statuts de vérification, matrice de permissions, garde d'API, attribution des rôles journalisée, tests | oui |
| 2 | Profils acheteur et vendeur, portfolio, matériel, page publique, demande de vérification | oui |
| 3 | Catalogue numérique : annonces, fichiers lus par le moteur, licences, aperçus, recherche | oui |
| 4 | Offres de services Basic/Standard/Premium, options de prix | oui |
| 5 | Configurateur, simulation visuelle | oui |
| 6 | Demandes de devis, propositions, comparaison, transformation en commande | oui |
| 7 | Messagerie, commandes, historique | oui |
| 8 | Paiements **de test**, commissions, versements simulés ; ✋ Stripe en mode test (compte, clés) | bac à sable : oui ; Stripe : ✋ |
| 9 | Droits de téléchargement, licences, journal | oui |
| 10 | Production et expédition | oui |
| 11 | Avis liés aux commandes, signalements, modération, litiges | oui |
| 12 | Back-office et statistiques | oui |
| 13 | Publication depuis Studio | oui |
| 14 | Sécurité, charge, optimisation, préparation du lancement ; ✋ documents juridiques, hébergement, domaine, paiements réels, déploiement | ✋ |

Chaque lot livre : code, tests (dont permissions), contrôle sur ordinateur, tablette et mobile, documentation,
rapport et limites, et la vérification des empreintes du moteur avant et après.

## 5. Contrôles matériels restants (indépendants du Market)

- Gestes tactiles sur **iPhone et iPad réels** (pincement, deux doigts, poignées, annulation d'un geste par un
  second doigt) : **non réalisés**. Les tests actuels utilisent des événements tactiles simulés dans Chromium.
- Broderie sur machine : aucun essai physique enregistré ([`../VALIDATION-PHYSIQUE.md`](../VALIDATION-PHYSIQUE.md)).
