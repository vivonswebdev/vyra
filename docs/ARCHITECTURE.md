# Décisions d'architecture (ADR)

Chaque décision indique le contexte, le choix, les options écartées et les conséquences.

## ADR-001 — Monorepo TypeScript unique pour toute la plateforme

**Choix.** Un dépôt `vyra/` (espaces de travail npm) : moteur, contrats, interface partagée, API, Studio, Market.
**Pourquoi.** Studio et Market partagent comptes, fichiers, moteur (validation des fichiers vendeurs, aperçus),
identité visuelle et contrats. Deux dépôts séparés imposeraient de publier et versionner des paquets dès le début.
**Écarté.** Deux applications indépendantes (réécriture probable pour les faire communiquer).
**Conséquence.** Un seul `npm install`, un seul jeu de tests ; extraction possible vers `vivonswebdev/vyra`
par `git subtree split --prefix=vyra`.

## ADR-002 — Moteur figé, extrait du build v0.2, contrôlé par empreintes

**Contexte.** Sources `src/engine/*.ts` indisponibles ; le build publié reproduit les fichiers de référence.
**Choix.** `scripts/extract.mjs` calcule la fermeture des dépendances des points d'entrée du moteur dans le
module du build (129 déclarations, aucune de React ni de pdf.js), renomme les symboles de premier niveau par
portée (Babel) et produit `src/generated/engine.js`. Aucune instruction n'est réécrite. La façade
`src/index.ts` est le seul contrat typé.
**Garde-fous.** `test/reference.test.ts` : registre de 45 empreintes intact, 24 exports identiques octet pour
octet ; `scripts/verify-references.mjs` : relecture indépendante par pyembroidery 1.5.1.
**Conséquence.** Le moteur tourne à l'identique dans le navigateur (Web Worker) et sur le serveur (exports
authentifiés, miniatures, validation Market). Toute évolution du moteur attend les sources d'origine.

## ADR-003 — API Node (Fastify) + PostgreSQL, SQL explicite

**Choix.** Fastify 5, PostgreSQL 16, requêtes SQL paramétrées, migrations versionnées (`001_core.sql`,
`002_studio.sql`, sommes de contrôle vérifiées au démarrage).
**Pourquoi pas Supabase comme backend principal.** Supabase reste un bon hébergeur PostgreSQL (UE) et peut
servir la base de production. Mais la logique de commandes, de droits de téléchargement, de commissions et de
webhooks de paiement doit vivre côté serveur, testée sur une vraie base ; le traitement des fichiers de broderie
(lecture, aperçu, export) demande le moteur en Node. Une API dédiée garde ces règles en un seul endroit,
portable chez n'importe quel hébergeur PostgreSQL européen (Supabase, Neon, Scaleway, OVHcloud).
**Pourquoi pas d'ORM.** Schéma lisible, requêtes visibles en revue, aucun comportement implicite ; le coût est
une écriture plus verbeuse.

## ADR-004 — Authentification maison, primitives standard

**Choix.** Mots de passe scrypt (N=2^15, r=8, p=3, paramètres OWASP) ; sessions par cookie `httpOnly`,
`SameSite=Lax`, `Secure` en HTTPS ; seule l'empreinte SHA-256 du jeton est stockée ; vérification d'e-mail
(48 h) et réinitialisation (1 h) par jetons à usage unique ; verrouillage après 8 échecs ; limitation de débit ;
journal d'audit ; anti-CSRF par en-tête `x-vyra-client` + contrôle d'`Origin`.
**Écarté.** Un fournisseur d'identité externe dès maintenant (dépendance et coût sans besoin démontré ; l'interface
`SessionUser` permet d'en brancher un plus tard, par exemple pour la connexion Google).
**Limite connue.** Pas encore de double authentification (prévue pour les comptes vendeurs, lot 6).

## ADR-005 — Fichiers privés, servis uniquement par l'API

**Choix.** Index `files` en base, contenu dans un stockage objet derrière l'interface `Storage` (pilote disque
aujourd'hui ; pilote S3 compatible au lot 8). Aucune URL publique : chaque téléchargement vérifie le
propriétaire (et, au Market, le droit d'achat). Types réels détectés par signature ; réponses avec
`Content-Disposition: attachment` et CSP `sandbox`. Les miniatures SVG sont calculées par le serveur, jamais
fournies par le client.

## ADR-006 — Paiements : Stripe Connect (UE), piloté par webhooks

**Choix pour les lots 5 à 7.** Stripe Connect, comptes vendeurs *Express* (KYC géré par Stripe), « charges et
transferts séparés » pour un panier multi-vendeurs, commission prélevée par la plateforme, Bancontact / iDEAL /
cartes avec 3-D Secure. Les commandes passent de `pending` à `paid` uniquement par webhook signé ; les droits de
téléchargement naissent de la commande payée, jamais du navigateur.
**Alternative sérieuse.** Mangopay (établissement européen spécialisé place de marché) si l'encaissement pour
compte de tiers doit rester chez un acteur de l'UE ; l'interface `PaymentProvider` permet l'un ou l'autre.
**Environnement de test.** Mode test Stripe (clés `sk_test_…`). Un fournisseur « bac à sable » local, sans argent,
sert aux tests automatisés ; la configuration refuse de démarrer en production avec lui.
**Non fait sans votre accord.** Création de compte marchand, saisie de clés, toute transaction réelle.

## ADR-007 — Monétisation configurable, jamais codée en dur

Les tarifs ne sont pas validés. Prévu au lot 5 : tables `commission_rules` (taux en points de base, montant
fixe, portée : défaut, catégorie, vendeur, période), `plans` et `subscriptions` (gratuit, payant, crédits).
Arithmétique en centimes, arrondie en faveur du vendeur (`commissionCents`, testée).

## ADR-008 — Deux applications web, une seule origine

Studio (`/studio/`) et Market (`/market/`) sont deux applications React distinctes qui partagent `@vyra/ui`
(identité, session, écrans de compte) ; l'API les sert depuis la même origine, ce qui garde un cookie de
session unique et évite toute configuration CORS. Un découpage en sous-domaines reste possible (cookie de
domaine parent).

## Sécurité — état au lot 2

| Mesure | État |
|---|---|
| En-têtes (CSP stricte sans CDN, `frame-ancestors 'none'`, `nosniff`, HSTS via Helmet) | fait |
| Mots de passe scrypt, sessions hachées, verrouillage, limitation de débit | fait, testé |
| CSRF (en-tête client + Origin) | fait, testé |
| Isolation des données entre comptes | fait, testé (lecture, écriture, export, miniature) |
| Validation des entrées (zod), taille des corps bornée | fait |
| Fichiers : signature réelle, téléchargement en pièce jointe, CSP sandbox | fait, testé |
| Journal d'audit des actions sensibles | fait, testé |
| Dépendances sans vulnérabilité connue (`npm audit`) | 0 au 12/11/2026 |
| Exécution du moteur côté serveur dans un worker avec délai maximal | à faire (lot 8) |
| Double authentification, suppression de compte (RGPD) | à faire (lots 6 et 8) |
