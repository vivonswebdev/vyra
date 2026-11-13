# Lot 3.1 — Finalisation sécurité, validation réelle, préparation production

Branche `claude/sleepy-knuth-uw65mf`, état au 13/11/2026. **Non fusionnée** : `main` (`e4ffbe1`) n'a pas été
modifiée. Rien n'est déployé publiquement, aucun paiement n'est configuré, le Market n'est pas commencé, le
dépôt OptiTeam n'a pas été touché.

« Vérifié avec un vrai service » signifie : le code de VYRA a parlé au vrai logiciel (PostgreSQL 16, démon
ClamAV 1.5.4, serveur S3 MinIO, serveur SMTP Mailpit), en local **et** dans la CI GitHub. Cela ne vaut pas
validation chez un fournisseur commercial (voir « Risques ouverts »).

## 1. Problèmes identifiés et corrections

| # | Problème | Correction | Preuve |
|---|---|---|---|
| 1 | Le verrouillage après échecs et l'inscription (409) révélaient qu'un compte existe | Réponses uniformes : inscription toujours 202 ; connexion 401 identique ; verrouillage par adresse (8 échecs / 15 min) appliqué aussi aux adresses inconnues ; « compte suspendu » ou « adresse non confirmée » seulement après le bon mot de passe ; un e-mail « vous avez déjà un compte » remplace l'erreur visible | `auth.test.ts`, `security.test.ts` |
| 2 | Limitation de débit en mémoire : contournable avec plusieurs instances | Compteurs partagés dans PostgreSQL (table non journalisée, mise à jour atomique) pour la limitation générale et le verrouillage par adresse | test avec deux instances sur la même base |
| 3 | Fichiers déposés diffusés sans analyse antivirus | Quarantaine, analyse ClamAV avant toute diffusion, refus et effacement si menace, 503 et maintien en quarantaine si l'antivirus est indisponible, réanalyse des anciens fichiers ; antivirus obligatoire en production | `antivirus.test.ts` (faux service + vrai ClamAV) |
| 4 | Stockage S3 jamais testé contre un vrai serveur ; téléchargements via l'API seulement | Tests contre MinIO : objets privés, URL temporaires signées (pièce jointe, type neutre, expiration), erreurs d'identifiants et de réseau rapides ; sauvegarde/restauration S3 | `s3-real.test.ts` |
| 5 | E-mails jamais envoyés à un vrai serveur ; doublons possibles avec plusieurs instances | Transport SMTP (nodemailer 10), file d'envoi avec réservation `FOR UPDATE SKIP LOCKED`, clés anti-doublon, reprise différée, 5 essais au plus ; alertes de sécurité (mot de passe, 2FA, code de secours, verrouillage) | `email-real.test.ts` |
| 6 | API exécutée avec `tsx` en production ; pas de santé détaillée, de métriques ni d'archive | API compilée (esbuild), `/api/ready`, `/api/metrics` protégé, `x-request-id`, journaux JSON, règles d'alerte, archive de version avec empreinte, test de fumée de l'archive en production | `ops.test.ts`, `smoke-release.mjs` |
| 7 | Messages d'erreur de l'API affichés en français quelle que soit la langue | Chaque erreur porte une raison stable ; le Studio affiche un texte traduit (FR, NL, EN, AR), y compris les détails de validation et les lignes de nuancier | `api-errors.test.ts`, test navigateur |
| 8 | Pas de poignées de transformation ni de copier/coller dans l'éditeur | Poignées d'échelle et de rotation (souris, stylet, doigt), copier/couper/coller/dupliquer (clavier et boutons) | `transform.test.ts`, `studio-lot31.spec.ts` |
| 9 | nodemailer 7 : vulnérabilité élevée signalée par `npm audit` | Passage à nodemailer 10.5 | `npm audit` : 0 vulnérabilité |
| 10 | Test de chiffrement authentifié instable (une fois sur 64 il « modifiait » un caractère par lui-même) | Altération déterministe d'un bit du vecteur, de l'étiquette et du chiffré | 3 exécutions + CI |
| 11 | CI : ClamAV bloqué par le profil AppArmor d'Ubuntu ; binaire MinIO retiré (HTTP 410) | Instance ClamAV de test hors profil ; MinIO compilé à une révision figée et mis en cache ; Mailpit figé en v1.33.1 | CI verte |
| 12 | CI : en ajoutant les services de test, j'avais supprimé par erreur l'audit npm, la vérification de types et le contrôle du gel | Étapes rétablies ; le gel est aussi vérifié directement avec `sha256sum -c` | CI verte |

## 2. Moteur figé

Aucun fichier du manifeste `packages/engine/FROZEN.sha256` n'a été modifié (`sha256sum -c` : 34/34 ; aucune
différence avec `main` sur ces fichiers). Algorithmes PES/DST, paramètres de génération et 45 références
intacts. Les transformations du Studio (poignées, copier/coller) modifient seulement les points du document via
`mapObjectPoints`, comme le panneau « Objet » existant. Les messages du lecteur de nuanciers du moteur sont
rattachés à des raisons traduisibles **côté API**, sans toucher au moteur. Aucune compatibilité machine n'est
annoncée : aucun essai physique n'est enregistré ([`VALIDATION-PHYSIQUE.md`](VALIDATION-PHYSIQUE.md)).

## 3. Studio

- **Poignées** (outil Sélection) : quatre coins pour agrandir/réduire (échelle uniforme, coin opposé fixe,
  bornée entre 0,5 mm et ×20), rond au-dessus pour tourner (Maj : pas de 15°). Aperçu des points pendant le
  geste, une seule étape d'annulation. Poignées agrandies et tolérance de 22 px au toucher.
- **Copier, couper, coller, dupliquer** : Ctrl+C/X/V/D sur ordinateur, boutons dans la barre d'outils sur
  tablette et mobile. Nouvel identifiant, nom « (copie) », décalage de 5 mm (cumulé à chaque collage). Coller dans
  un autre projet retrouve le fil identique ou l'ajoute. Le presse-papiers reste dans l'onglet (mémoire et
  stockage de session) : rien n'est envoyé au serveur ni au presse-papiers du système.
- **Erreurs traduites** : 63 messages en quatre langues ; un test lit le code du serveur et échoue si une raison
  émise n'a pas sa traduction.
- Fonctions déjà validées inchangées : les 18 parcours navigateur antérieurs passent sans modification de leurs
  attentes (sauf l'inscription, désormais confirmée par e-mail, cf. §1.1).

Captures : [`captures/lot31-poignees-ordinateur.png`](captures/lot31-poignees-ordinateur.png),
[`captures/lot31-poignees-mobile.png`](captures/lot31-poignees-mobile.png),
[`captures/lot31-erreur-arabe.png`](captures/lot31-erreur-arabe.png).

## 4. Production (préparée, non déployée)

Voir [`DEPLOIEMENT.md`](DEPLOIEMENT.md), [`ANTIVIRUS.md`](ANTIVIRUS.md), [`EMAILS.md`](EMAILS.md). Résumé :
`npm run build` produit le Studio et l'API compilée ; `scripts/release.mjs` une archive et son empreinte ;
la configuration de production refuse de démarrer sans secret, HTTPS, antivirus, SMTP, compteurs partagés, et
avec boîte aux lettres de développement ou paiement de test ; migrations sous verrou avec `--status` ; retour
arrière = restauration de la sauvegarde prise avant la mise à jour.

## 5. Tests rejoués le 13/11/2026

| Suite | Où | Résultat |
|---|---|---|
| `npm audit --audit-level=high` | local, CI | 0 vulnérabilité |
| Vérification de types (5 projets) | local, CI | ok |
| Gel du moteur : `sha256sum -c` sur 34 fichiers | local, CI | 34/34 |
| Vitest : moteur (gel, 45 empreintes, exports identiques, lecteurs, QC, performance, registre), contrats, traductions, erreurs traduites, poignées, API sur PostgreSQL 16 (comptes, anti-énumération, 2FA, sessions, révocations, projets, fichiers, exports, durcissement, configuration, santé, nuanciers, sauvegarde) | local, CI | 22 fichiers, 209/209 (moteur 75, contrats 4, Studio 15, API 115) |
| dont antivirus : faux service contrôlé et **vrai ClamAV 1.5.4** (signatures de test) | local, CI | 9/9 |
| dont stockage avec **vrai serveur S3 (MinIO)** | local, CI | 6/6 |
| dont e-mails avec **vrai serveur SMTP (Mailpit)** | local, CI | 7/7 |
| Navigateur Chromium sur l'API compilée : ordinateur (17), tablette (5), mobile (5 — gestes tactiles réels) | local, CI | 27/27 |
| Archive installée sans dépendances de développement, démarrée en `NODE_ENV=production` avec PostgreSQL, ClamAV, MinIO, Mailpit | local, CI | réussi |

## 6. Points à valider par vous

1. **Fusion** de la branche dans `main` (je ne l'ai pas faite).
2. Comportement anti-énumération : un utilisateur déjà inscrit qui se réinscrit ne voit pas d'erreur mais reçoit
   un e-mail ; le verrouillage s'applique aussi aux adresses inconnues.
3. Rotation par poignée : comme le panneau « Objet » existant, elle ne tourne pas l'angle de remplissage
   (direction des points) ; à confirmer ou à changer dans un lot ultérieur.
4. Choix des fournisseurs (hébergement UE, stockage S3, envoi d'e-mails, supervision) et création des secrets :
   rien n'a été souscrit ni configuré.
5. Essais physiques sur machine avant toute mention de compatibilité.
6. Documents RGPD avec un conseil (registre, politique, sous-traitants, durées) : les fonctions techniques ne
   suffisent pas à une conformité.

## 7. Risques ouverts

- Stockage et e-mails validés contre MinIO et Mailpit, **pas contre un fournisseur réel** (comportements propres,
  délivrabilité, SPF/DKIM/DMARC).
- Antivirus : intégration prouvée avec le vrai ClamAV mais **base de signatures de test** ; l'analyse n'est
  opérationnelle qu'avec `freshclam` et les signatures officielles, supervisés.
- Aucune supervision branchée (règles Prometheus prêtes), aucun test de charge.
- Moteur : sources d'origine et script du kit XE1 introuvables ; 21 références en empreinte seule.
- MinIO de test compilé depuis une révision figée d'un projet dont les binaires ne sont plus distribués : utile
  pour les tests seulement, à remplacer si la compilation devient impossible.
- Avertissement GitHub : `actions/cache@v4` et `actions/setup-go@v5` ciblent Node 20 (exécutés sous Node 24).

## 8. Recommandation

Branche **prête pour revue avant fusion**. Je recommande la fusion dans `main` après votre relecture des points
6.2 et 6.3, la CI étant verte sur le dernier commit. Une fusion ne vaut pas mise en production : celle-ci reste
conditionnée aux points 6.4 à 6.6.
