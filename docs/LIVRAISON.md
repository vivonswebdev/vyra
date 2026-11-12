# État des lots

Mis à jour le 12/11/2026. « Fait » signifie développé **et** couvert par un test qui passe.

| Lot | État |
|---|---|
| 0 — Audit et décision d'architecture | **Fait** : [`AUDIT.md`](AUDIT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 1 — Socle commun | **Fait** : monorepo, moteur extrait et vérifié, contrats, API, base, sécurité, CI |
| 2 — Studio : comptes, projets, persistance | **Fait** |
| 3 — Studio : outils et moteur | **Largement fait** (voir « incomplet ») |
| 4 — Simulation, analyse, contrôle, export | **Largement fait** (voir « incomplet ») |
| 5 — Market : catalogue, acheteur | Non commencé |
| 6 — Market : vendeur, publication, modération | Non commencé (lecteurs PES/DST prêts) |
| 7 — Commandes, paiements de test, sécurité commerciale | Non commencé (architecture décidée, ADR-006) |
| 8 — Tests complets, optimisation, production | Partiel (CI, tests navigateur sur 3 largeurs) |

## Fonctionnel et testé

**Comptes** : inscription, connexion, déconnexion, vérification d'e-mail, mot de passe oublié et
réinitialisation, changement de mot de passe, profil, langue, thème, mode Simple/Expert, appareils connectés et
déconnexion des autres, verrouillage après 8 échecs, limitation de débit, journal d'audit.

**Projets** : plusieurs projets par compte, création (import d'image PNG/JPG/WEBP/BMP/SVG/PDF, 8 motifs de test,
toile vierge), ouverture, renommage, duplication, corbeille, restauration, suppression définitive confirmée par
le nom, enregistrement automatique (1,2 s) avec contrôle de révision (conflit entre onglets détecté, rechargement
ou copie proposés), historique des versions (points automatiques toutes les 10 min, versions nommées,
restauration), image source conservée, miniatures calculées par le serveur, projets retrouvés après déconnexion.

**Éditeur** : rendu fidèle par le moteur (fil réaliste, déplacements ; directions, densité, types en Expert),
cadre de la machine, outils sélection/déplacement, nœuds (déplacer, ajouter par double-clic, supprimer par
Alt+clic), main, tracé libre (point triple), rectangle, ellipse, zoom molette et boutons, pincement à deux
doigts, ajuster ; calques (ordre de broderie, visibilité, regroupement par couleur) ; propriétés par type de
point (densité, angle, longueur, compensation, sous-couche, largeur, passages), échelle et rotation ; fils
(couleur, nom, marque, référence, PEC le plus proche, ajout, isoler une couleur) ; Annuler/Rétablir 80 pas et
raccourcis (Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y, Ctrl+S, V N H P R E F, Suppr, Échap, Espace).

**Analyse, contrôle, export** : relance de l'analyse (couleurs, largeur, fond ; satin max et détail minimal en
Expert) dans un Web Worker ; stratégie proposée par objet ; contrôle qualité (erreurs, avertissements,
informations, localisation sur le motif) ; profil machine et cadre (fiche technique sourcée, jamais présentée
comme un essai), état du registre d'essais XE1 ; export PES v1, PES v6, DST **exécuté par le serveur**, refusé
tant qu'une erreur bloquante existe, historique des exports téléchargeables ; aperçus SVG et PNG ; simulation
(lecture, 5 vitesses, curseur, compteur).

**Interface** : identité Warm Wood (jetons à contrastes mesurés), clair/sombre/automatique, FR/NL/EN/AR avec
arabe de droite à gauche, ordinateur (≥ 1 200 px), tablette (panneau latéral), mobile (feuille de réglages et
onglets en bas).

## Incomplet ou absent (à ne pas considérer comme livré)

- **VYRA Market** : rien n'est encore construit (catalogue, boutiques, publication, panier, paiement,
  bibliothèque, téléchargements achetés, modération, revenus).
- **Paiements** : aucun ; Stripe n'est pas joignable depuis cet environnement et aucun compte n'est configuré.
- Envoi réel des e-mails (transport Brevo écrit, non testé contre le service) ; stockage S3 (interface prête).
- Studio : bibliothèque de nuanciers CSV, fiche de préparation imprimable, superposition de l'image source,
  import des anciens projets du navigateur, poignées de transformation à la souris, copier/coller d'objets.
- Exécution du moteur côté serveur dans un worker avec délai maximal ; double authentification ; suppression de
  compte et export des données (RGPD) ; surveillance et sauvegardes de production.
- Les 21 fichiers du kit XE1 ne sont pas régénérables sans le script du dépôt source.

## Tests au 12/11/2026

| Suite | Résultat |
|---|---|
| Moteur : registre de 45 empreintes, 24 exports identiques à la v0.2.0, lecteurs, QC, édition | 21/21 |
| Contrats et arithmétique des commissions | 4/4 |
| API sur PostgreSQL 16 réel (comptes, sécurité, projets, versions, fichiers, exports) | 24/24 |
| Traductions (4 langues complètes, aucune clé manquante dans le code) | 3/3 |
| Navigateur (Chromium) : parcours complet, reconnexion, dessin et export DST, export bloqué, mot de passe oublié, corbeille, langue et thème, mise en page ordinateur/tablette/mobile | 13/13 |
| Relecture indépendante pyembroidery 1.5.1 des 24 fichiers | 24/24 identiques |
| `npm audit` | 0 vulnérabilité |
