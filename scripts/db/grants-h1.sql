-- VYRA — droits de TRANSITION du lot H1, à réappliquer après chaque migration (idempotent).
-- Exécuté par le migrateur : le fichier prend lui-même le rôle propriétaire.
--
-- Objet : faire fonctionner l'API avec un rôle SANS privilège de migration (ni propriétaire, ni création
-- d'objets, ni contournement de RLS), en attendant la matrice fine du lot H2 (droits par table et par colonne)
-- et la répartition des requêtes entre vyra_app / vyra_system / vyra_worker / vyra_market au lot H3.
-- Ce profil est volontairement limité aux opérations de données (pas de TRUNCATE, REFERENCES ni TRIGGER) et
-- n'accorde rien à vyra_system, vyra_worker ni vyra_market, qui ne sont pas encore utilisés par l'API.

SET ROLE vyra_owner;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vyra_app, vyra_system, vyra_worker, vyra_market;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM vyra_app, vyra_system, vyra_worker, vyra_market;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vyra_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO vyra_app;
-- Le registre des migrations : lecture seule pour l'API (contrôle au démarrage et /api/ready).
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM vyra_app;

RESET ROLE;
