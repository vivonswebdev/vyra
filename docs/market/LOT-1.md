# VYRA Market — LOT 1 : modèle de données, comptes et permissions

13/11/2026. Lot réversible : une migration additive, des routes d'API, des tests. Aucun écran (les écrans des
profils arrivent au lot 2), aucun paiement, aucun déploiement, moteur intact.

## Ce qui est fait

### Comptes et profil professionnel

- Un compte reste acheteur et utilisateur du Studio. Ouvrir un **profil professionnel** (`seller_profiles`)
  accorde le rôle `seller` : adresse publique (`/market/<adresse>`, noms réservés refusés), nom affiché, type
  d'activité, professionnel ou particulier, pays, langues, présentation.
- Types d'activité : brodeur indépendant, atelier, designer de motifs, digitaliseur, créateur de fichiers
  PES/DST, influenceur, marque, entreprise de personnalisation textile.
- Cycle : `draft` → (vendeur, 2FA exigée) `pending_review` → (modération) `verified` ou `rejected` ;
  `suspended` à tout moment, avec motif ; une réintégration repasse par l'examen.
- Changer l'identité d'un profil vérifié (adresse, nom, type, statut professionnel, pays) le renvoie en examen
  et le retire du public. La présentation et les langues se modifient librement.
- Profil public : seulement s'il est vérifié et le compte actif ; ni e-mail, ni identifiant interne, ni statut.
- Historique complet des statuts (`seller_status_events` : de, vers, motif, auteur, date) + journal d'audit.
- Export RGPD : `profil-professionnel.json` (profil et historique). Suppression du compte : profil et historique
  effacés.

### Permissions

Une matrice unique (`packages/shared/src/permissions.ts`), utilisée par l'API et disponible pour les écrans.

| Action | Visiteur | Acheteur | Vendeur brouillon / en examen | Vendeur vérifié | Modérateur | Admin |
|---|---|---|---|---|---|---|
| Consulter le catalogue et les profils publics | oui | oui | oui | oui | oui | oui |
| Acheter, demander un devis | — | oui | oui | oui | oui | oui |
| Créer un profil professionnel | — | oui | déjà fait | déjà fait | oui | oui |
| Modifier son profil | — | — | oui | oui | — | — |
| Demander la vérification | — | — | oui, avec 2FA | — | — | — |
| Publier, gérer ses versements (lots 3-8) | — | — | non vérifié | oui, avec 2FA | — | — |
| Back-office, examen des profils, modération | — | — | — | — | avec 2FA | avec 2FA |
| Rôles du personnel, finances | — | — | — | — | — | avec 2FA |

Règles supplémentaires vérifiées par l'API : personne n'examine son propre profil ; personne ne modifie ses
propres rôles ; le rôle `seller` ne s'attribue pas à la main ; un refus ou une suspension exige un motif
(10 caractères au moins), destiné au vendeur.

Chaque refus a une raison stable, traduite en FR, NL, EN et AR (`login_required`, `email_unverified`,
`mfa_required`, `role_required`, `seller_profile_required`, `seller_profile_exists`, `seller_not_verified`,
`seller_suspended`, `slug_taken`, `invalid_transition`, `self_review`, `self_role_change`, `user_not_found`,
`seller_not_found`).

### API

| Route | Permission |
|---|---|
| `GET /api/market/me/seller` | connecté ; renvoie le profil et la décision pour chaque action |
| `POST /api/market/me/seller` | `seller.profile.create` |
| `PATCH /api/market/me/seller` | `seller.profile.edit` |
| `POST /api/market/me/seller/submit` | `seller.profile.submit` |
| `GET /api/market/sellers/:adresse` | public, profils vérifiés seulement |
| `GET /api/admin/sellers?status=…`, `GET /api/admin/sellers/:id` | `moderation.sellers.review` |
| `POST /api/admin/sellers/:id/decision` | `moderation.sellers.review`, pas sur soi |
| `POST /api/admin/users/:id/roles` | `admin.roles.manage`, pas sur soi, `moderator` ou `admin` seulement |

### Correction trouvée en chemin

`user_roles.granted_by` n'avait pas de règle de suppression : supprimer le compte d'un administrateur ayant
attribué des rôles aurait échoué. Corrigé (`ON DELETE SET NULL`, la trace reste dans le journal d'audit), testé.

## Tests

| Suite | Résultat |
|---|---|
| Matrice de permissions (`packages/shared/test/permissions.test.ts`) : chaque action × statut × rôle × 2FA, transitions, adresses | 9/9 |
| API (`apps/api/test/market-identity.test.ts`) : visiteur, acheteur, vendeur, modérateur avec et sans 2FA, administrateur ; création, unicité, soumission, vérification, refus motivé, suspension, réintégration, réexamen après modification, auto-examen et auto-attribution refusés, journal, export, suppression | 11/11 |
| Traductions : toute raison de refus a son texte dans les quatre langues | inclus dans `api-errors.test.ts` |

## Limites

- Pas d'écran : création et examen des profils se font par l'API (écrans au lot 2 pour le vendeur, au lot 12
  pour le back-office). Contrôle responsive sans objet pour ce lot.
- Pas d'e-mail au vendeur lors d'une décision (prévu avec les écrans du lot 2).
- Données d'identification des vendeurs professionnels exigées par le droit européen (raison sociale, adresse,
  numéro d'entreprise, TVA) : lot 2, après avis juridique sur la liste exacte.
- Équipes (plusieurs membres par atelier) : prévues plus tard (VYRA Business).
- Premier administrateur : à créer par un accès direct à la base ; ✋ aucune modification de comptes de
  production sans votre accord.
