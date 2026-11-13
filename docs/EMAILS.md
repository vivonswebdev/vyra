# E-mails transactionnels

| Modèle | Déclencheur | Lien | Expiration | Anti-doublon |
|---|---|---|---|---|
| `verify` | inscription, connexion d'un compte non confirmé, renvoi | `/account/verify?token=…` (ouvre la session) | 48 h, usage unique | renvoi : 1 par 5 min |
| `exists` | inscription avec une adresse déjà inscrite (le demandeur n'en sait rien) | page de connexion | — | 1 par heure |
| `reset` | mot de passe oublié | `/account/reset?token=…` | 1 h, usage unique | le lien précédent est invalidé |
| `security` | 2FA activée, 2FA désactivée, code de secours utilisé, mot de passe modifié, verrouillage après 8 échecs | page du compte | — | 1 par événement et par heure |
| `deleted` | suppression du compte | aucun | — | — |

Quatre langues (FR, NL, EN, AR) selon la langue du compte. Aucun message commercial.

## Envoi

Chaque e-mail est d'abord écrit dans `email_outbox`, **dans la même transaction** que l'action. Un envoyeur
(toutes les 15 s sur chaque instance) **réserve** les messages (`FOR UPDATE SKIP LOCKED`), les transmet, puis les
marque envoyés : deux instances n'envoient jamais le même message. Échec : erreur notée, nouvel essai après
1, 2, 3 puis 4 minutes, 5 tentatives au plus. Les messages envoyés sont effacés après 7 jours.

Transports : `smtp` (`SMTP_URL=smtp://utilisateur:motdepasse@hôte:587?requireTLS=true` ou `smtps://…:465`),
`brevo` (API, `BREVO_API_KEY`), `outbox` (développement : rien n'est envoyé ; lecture sur `/dev/mailbox` avec
`DEV_MAILBOX=1`).

## Ce qui a été testé

| Test | Service | Résultat |
|---|---|---|
| Vérification, réinitialisation, alertes 2FA, mot de passe, verrouillage : message réellement reçu, sujet, expéditeur, liens utilisables une fois, mentions d'expiration | **Mailpit** (vrai serveur SMTP de test, local et CI) | ok |
| Deux instances simultanées : aucun doublon | Mailpit | ok |
| Panne SMTP (port fermé) : message conservé, erreur notée, reprise différée, livré une seule fois ; arrêt après 5 échecs | Mailpit | ok |
| Transport Brevo | — | **non testé contre le service réel** (API injoignable depuis cet environnement) |

Avant la mise en production : envoyer un message de chaque modèle par le vrai fournisseur (SPF, DKIM et DMARC
configurés sur le domaine d'envoi), vérifier l'arrivée en boîte de réception (et non en indésirables).
