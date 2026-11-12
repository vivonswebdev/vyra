# Séparation de VYRA dans un dépôt autonome

## État au 12/11/2026

| Étape | État |
|---|---|
| Historique de `vyra/` extrait du dépôt `vivonswebdev/optiteam` (`git subtree split --prefix=vyra`) | **Fait** : 2 commits, arbre final strictement identique au dossier `vyra/` du commit `fa88c6d` (arbre `552b9a67`) |
| Historique publié sur `vivonswebdev/vyra`, branche `main` (import initial du code déjà livré) | **Fait** : `2506914` (← `bcfc294`), `e4ffbe1` (← `fa88c6d`) |
| Travail du lot 3 | Branche `claude/sleepy-knuth-uw65mf` de `vivonswebdev/vyra`, à relire puis fusionner dans `main` |
| CI autonome (`.github/workflows/ci.yml`) | **Fait** : audit, types, gel du moteur, API sur PostgreSQL, navigateur |
| Dépôt `optiteam` | **Inchangé** par le lot 3 : cockpit, OptiCompta, workflows et déploiement Vercel intacts (53/53 tests OptiTeam, build identique) |

## Ce qui reste dans `optiteam` (aucune action faite)

La branche `claude/sleepy-knuth-uw65mf` d'`optiteam` contient toujours `vyra/` et `.github/workflows/vyra.yml`.
Elle n'a jamais été fusionnée dans `main` : le site OptiTeam n'est pas concerné (son build Vercel ne copie que
des chemins précis et ignore `vyra/`).

Recommandation : **ne pas fusionner** cette branche dans `optiteam/main`. Une fois le dépôt `vyra` validé, elle
peut être supprimée (opération que je n'ai pas effectuée) :

```bash
git push origin --delete claude/sleepy-knuth-uw65mf   # depuis un clone d'optiteam, après validation
```

## Reproduire l'extraction

```bash
git clone https://github.com/vivonswebdev/optiteam && cd optiteam
```

```bash
git checkout claude/sleepy-knuth-uw65mf && git subtree split --prefix=vyra -b vyra-split
```

```bash
git rev-parse vyra-split^{tree} fa88c6d:vyra   # les deux arbres doivent être identiques
```

## Déploiement indépendant

Voir [`DEPLOIEMENT.md`](DEPLOIEMENT.md). Rien n'est déployé publiquement.
