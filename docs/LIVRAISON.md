# État des lots

Mis à jour le 13/11/2026. « Fait » signifie développé **et** couvert par un test qui passe.

| Lot | État |
|---|---|
| 0 — Audit et décision d'architecture | Fait ([`AUDIT.md`](AUDIT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md)) |
| 1 — Socle commun | Fait |
| 2 — Studio : comptes, projets, persistance, éditeur, export | Fait |
| 3 — Consolidation, séparation du dépôt, préparation du Studio | Fait ([`AUDIT-LOT3.md`](AUDIT-LOT3.md)) |
| 3.1 — Sécurité, validation avec de vrais services, préparation production, finitions du Studio | Fait, branche prête pour revue, **non fusionnée** ([`LOT-3.1.md`](LOT-3.1.md)) |
| Market 0 — Audit, architecture, risques, plan | Fait ([`market/LOT-0.md`](market/LOT-0.md)) |
| Market 1 — Modèle de données, comptes, permissions | Fait, sans écran ([`market/LOT-1.md`](market/LOT-1.md)) |
| Market 2 à 14 | Non commencés |

## Lot 3 : fonctions demandées

| # | Fonction | État |
|---|---|---|
| 1 | Import des anciens projets | **Fait** pour les fichiers `.stitch.json` exportés par l'ancien Studio (chaîne v0.2 → import → export serveur = empreintes de référence PES v1, PES v6, DST). **Impossible** pour les projets restés dans le navigateur de l'artifact (`localStorage` d'une autre origine, inaccessible) : il faut d'abord les exporter depuis l'ancien Studio. |
| 2 | Nuanciers CSV | **Fait** : import sourcé (règles du moteur v0.2), statut officiel / approximatif / relevé personnel, correspondances, application à un fil, suppression |
| 3 | Superposition de l'image source | **Fait** (comportement v0.2 : 45 % sur le rectangle du motif) |
| 4 | Fiche de préparation imprimable | **Fait** (`/studio/p/<id>/fiche`) |
| 5 | Stockage cloud privé | **Fait** : pilote S3 (SDK AWS), objets privés, URL temporaires signées ; vérifié contre un vrai serveur S3 (MinIO) au lot 3.1 ; **non testé chez un fournisseur commercial** |
| 6 | Appareils et sessions | **Fait** : liste lisible, révocation unitaire ou globale |
| 7 | Double authentification | **Fait** : TOTP RFC 6238, secret chiffré, anti-rejeu, 10 codes de secours, exigée aussi après réinitialisation du mot de passe |
| 8 | Export des données personnelles | **Fait** : archive ZIP (compte, journal, projets, versions, nuanciers, fichiers) |
| 9 | Suppression complète du compte | **Fait** : mot de passe + confirmation (+ 2FA), données et fichiers effacés, journal anonymisé |
| 10 | Calculs du moteur côté serveur | **Fait** : pool de workers, délai, mémoire, file bornée, validation des documents |
| — | Sauvegarde et restauration | **Fait** (absentes avant le lot 3) |
| — | Protocole de validation physique | **Fait** ([`VALIDATION-PHYSIQUE.md`](VALIDATION-PHYSIQUE.md)) + contrôleur du registre d'essais |

## Tests au 13/11/2026

Détail dans [`LOT-3.1.md`](LOT-3.1.md) §5, en local et dans la CI GitHub.

| Suite | Résultat |
|---|---|
| `npm audit` | 0 vulnérabilité |
| Gel du moteur (`sha256sum -c`, 34 fichiers) | 34/34 |
| Vitest : moteur, contrats, traductions, Studio, API sur PostgreSQL 16 avec vrais ClamAV, MinIO (S3) et Mailpit (SMTP) | 209/209 |
| Navigateur Chromium sur l'API compilée : ordinateur, tablette, mobile | 27/27 |
| Archive de version installée et démarrée en production avec les vrais services | réussi |
| Build d'origine v0.2 dans Chromium contre le registre (lot 3) | 24/24 identiques |
| Relecture pyembroidery 1.5.1 (lot 3) | 24/24 concordants |

## Encore ouvert

- **Market** : lots 0 et 1 faits ; lots 2 à 14 à venir ([`market/LOT-0.md`](market/LOT-0.md) §4).
- Appareils tactiles : essais sur iPhone et iPad réels non réalisés ([`VALIDATION-PHYSIQUE.md`](VALIDATION-PHYSIQUE.md) §8).
- Moteur : sources d'origine et script du kit XE1 introuvables ; aucun essai physique enregistré, donc aucune
  compatibilité machine annoncée.
- Production : fournisseurs (hébergement, S3, e-mails), secrets et supervision à choisir et brancher ; antivirus
  à déployer avec ses signatures officielles ; pas de test de charge.
- RGPD : documents et procédures juridiques à établir (voir [`AUDIT-LOT3.md`](AUDIT-LOT3.md) §4).
