# Fixtures du test de passage H1 → H2 (`db-roles.test.ts`)

Copies exactes, non modifiées, servant à reconstituer une base dans l'état exact du lot H1 :

| Fichier | Source |
|---|---|
| `database-setup.sql` | `scripts/db/database-setup.sql` au commit `180d5bb` (lot H1) |
| `grants-h1.sql` | `scripts/db/grants-h1.sql` au commit `180d5bb` (retiré au lot H2) |
| `006_market_identity.sql` | `apps/api/src/db/migrations/006_market_identity.sql` de la branche Market (`claude/sleepy-knuth-uw65mf`, `65b697b`) : sert uniquement à vérifier que les migrations du socle donnent le même résultat que 006 soit appliquée avant ou après elles. Elle n'est pas une migration du socle. |
