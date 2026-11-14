-- VYRA — préparation d'une base (lot H1). À exécuter par un administrateur de l'instance, connecté à la base
-- cible, APRÈS scripts/db/roles.sql et AVANT la première migration. Idempotent.
--
-- Effets :
--   * plus de connexion ni de création d'objets temporaires pour PUBLIC ; connexion pour les rôles VYRA ;
--   * le schéma public appartient à vyra_owner ; seul ce rôle (donc le migrateur via SET ROLE) peut y créer
--     des objets ; les autres rôles VYRA n'ont que USAGE.
-- Le passage au schéma dédié « vyra » est prévu au lot H2, pas ici.

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO vyra_migrator, vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup', current_database());
END $$;

ALTER SCHEMA public OWNER TO vyra_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup;
