# État des lots

Mis à jour le 12/11/2026. « Fait » signifie développé **et** couvert par un test qui passe.

| Lot | État |
|---|---|
| 0 — Audit et décision d'architecture | Fait ([`AUDIT.md`](AUDIT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md)) |
| 1 — Socle commun | Fait |
| 2 — Studio : comptes, projets, persistance, éditeur, export | Fait |
| 3 — Consolidation, séparation du dépôt, préparation du Studio | Fait, sauf points ouverts ci-dessous ([`AUDIT-LOT3.md`](AUDIT-LOT3.md)) |
| Market (catalogue, vendeurs, commandes, paiements) | **Non commencé**, volontairement |

## Lot 3 : fonctions demandées

| # | Fonction | État |
|---|---|---|
| 1 | Import des anciens projets | **Fait** pour les fichiers `.stitch.json` exportés par l'ancien Studio (chaîne v0.2 → import → export serveur = empreintes de référence PES v1, PES v6, DST). **Impossible** pour les projets restés dans le navigateur de l'artifact (`localStorage` d'une autre origine, inaccessible) : il faut d'abord les exporter depuis l'ancien Studio. |
| 2 | Nuanciers CSV | **Fait** : import sourcé (règles du moteur v0.2), statut officiel / approximatif / relevé personnel, correspondances, application à un fil, suppression |
| 3 | Superposition de l'image source | **Fait** (comportement v0.2 : 45 % sur le rectangle du motif) |
| 4 | Fiche de préparation imprimable | **Fait** (`/studio/p/<id>/fiche`) |
| 5 | Stockage cloud privé | **Fait** : pilote S3 (SDK AWS), objets privés, aucune URL publique ; testé contre un serveur local qui vérifie les signatures SigV4 ; **non testé contre un vrai fournisseur** |
| 6 | Appareils et sessions | **Fait** : liste lisible, révocation unitaire ou globale |
| 7 | Double authentification | **Fait** : TOTP RFC 6238, secret chiffré, anti-rejeu, 10 codes de secours, exigée aussi après réinitialisation du mot de passe |
| 8 | Export des données personnelles | **Fait** : archive ZIP (compte, journal, projets, versions, nuanciers, fichiers) |
| 9 | Suppression complète du compte | **Fait** : mot de passe + confirmation (+ 2FA), données et fichiers effacés, journal anonymisé |
| 10 | Calculs du moteur côté serveur | **Fait** : pool de workers, délai, mémoire, file bornée, validation des documents |
| — | Sauvegarde et restauration | **Fait** (absentes avant le lot 3) |
| — | Protocole de validation physique | **Fait** ([`VALIDATION-PHYSIQUE.md`](VALIDATION-PHYSIQUE.md)) + contrôleur du registre d'essais |

## Tests au 12/11/2026

| Suite | Résultat |
|---|---|
| Moteur : gel (34 fichiers + régénération), 45 empreintes, 24 exports identiques, lecteurs, QC, performance, registre d'essais | 75/75 |
| API sur PostgreSQL 16 : comptes, 2FA, sessions, export, suppression, projets, versions, fichiers, exports, durcissement, stockage S3, sauvegarde/restauration, configuration, nuanciers, import v0.2 | 69/69 |
| Contrats | 4/4 |
| Traductions (4 langues, aucune clé manquante dans le code) | 3/3 |
| Navigateur (Chromium) : 15 parcours sur ordinateur + mise en page tablette et mobile | 18/18 |
| Build d'origine v0.2 dans Chromium contre le registre | 24/24 identiques |
| Relecture pyembroidery 1.5.1 | 24/24 concordants |
| Démarrage en mode production (HSTS, CSP, cookie `__Host-` Secure, pas de boîte aux lettres) | vérifié |
| `npm audit` | 0 vulnérabilité |

## Encore ouvert

- **Market** : rien (décision : pas avant consolidation du Studio).
- Moteur : sources d'origine et script du kit XE1 introuvables ; aucun essai physique enregistré.
- Production : supervision et alertes, limitation de débit partagée (Redis) pour plusieurs instances,
  compilation de l'API, image conteneur, envoi d'e-mails et stockage S3 non testés contre les vrais services.
- Sécurité : le verrouillage révèle l'existence d'un compte ; pas d'analyse antivirus des fichiers déposés
  (images uniquement, signature vérifiée) ; pas de test de charge.
- RGPD : documents et procédures juridiques à établir (voir [`AUDIT-LOT3.md`](AUDIT-LOT3.md) §4).
- Studio : poignées de transformation à la souris, copier/coller d'objets, messages d'erreur de l'API en
  français seulement.
