# Analyse antivirus des fichiers déposés

## Fonctionnement

1. **Contrôles avant analyse** : taille (20 Mo au plus pour une image source) et type réel par signature
   binaire (PNG, JPEG, WEBP, BMP, PDF, SVG) ; l'extension seule ne suffit jamais.
2. **Quarantaine** : le fichier est écrit sous `quarantaine/` et enregistré « en attente » ; il n'est servi à
   personne, pas même à son propriétaire.
3. **Analyse** par le démon ClamAV (`clamd`, commande INSTREAM en TCP, délai maximal `CLAMD_TIMEOUT_MS`).
4. **Décision** :
   - sain → déplacé hors de la quarantaine, état `clean`, rattaché au projet ;
   - infecté → effacé, état `infected` (trace conservée), événement `file.infected` au journal d'audit,
     réponse 422 `file_infected` ;
   - service indisponible, délai dépassé, réponse illisible → état `error`, **reste en quarantaine** (contenu
     effacé après 24 h), événement `file.scan_error`, réponse 503 `scan_unavailable`. Une erreur n'est jamais
     traitée comme « sain ».
5. **Diffusion** : seuls les fichiers `clean` (et les exports produits par le serveur, `not_required`) sont
   téléchargeables ou inclus dans l'export des données.
6. **Fichiers antérieurs** (état `unscanned`) : analysés au démarrage puis toutes les heures quand l'antivirus
   est configuré.

`FILE_SCAN=clamd` est **obligatoire en production** (refus de démarrer sinon).

## Ce qui a été testé

| Test | Service | Résultat |
|---|---|---|
| Protocole, blocs, réponses OK / FOUND / ERROR, blocage, coupure, port fermé | faux service clamd contrôlé | ok |
| Quarantaine, refus, effacement, journal, non-diffusion, export, réanalyse des anciens fichiers | faux service clamd | ok |
| Détection de la chaîne EICAR seule et dissimulée dans un PNG, PNG sain accepté, parcours API complet | **vrai démon ClamAV 1.5.4** avec une base de signatures de TEST | ok (en local et en CI) |

**Limite importante** : les bases de signatures officielles ClamAV (`database.clamav.net`) n'étaient pas
accessibles depuis l'environnement de développement. Les tests prouvent l'intégration avec le vrai moteur, pas
l'efficacité de détection. **L'analyse antivirus n'est opérationnelle qu'une fois `clamd` déployé avec ses
signatures officielles à jour** (`freshclam`, mise à jour plusieurs fois par jour) et supervisé (`/api/ready`
signale un antivirus injoignable).

## Mise en place

```bash
sudo apt-get install -y clamav-daemon     # puis freshclam et clamd avec les bases officielles
```

```bash
FILE_SCAN=clamd CLAMD_HOST=127.0.0.1 CLAMD_PORT=3310 npm start
```

Tests locaux avec le vrai moteur et la base de test :

```bash
node scripts/clamav-test-db.mjs /tmp/clamav-test 3310 && clamd --config-file=/tmp/clamav-test/clamd.conf
```

```bash
CLAMD_TEST=1 npx vitest run --project api apps/api/test/antivirus.test.ts
```
