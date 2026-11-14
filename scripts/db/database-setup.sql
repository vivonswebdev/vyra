-- VYRA — préparation d'une base (lots H1, H2). À exécuter par un administrateur de l'instance, connecté à la base
-- cible, APRÈS scripts/db/roles.sql et AVANT la première migration (ou avant 008_core_schema_vyra sur une base
-- existante). Idempotent.
--
-- Effets :
--   * plus de connexion ni de création d'objets temporaires pour PUBLIC ; connexion pour les rôles VYRA ;
--   * schéma dédié vyra, propriété de vyra_owner (le propriétaire n'a pas le droit de créer des schémas dans la
--     base ; c'est l'administrateur qui le crée ici) ; sur une base neuve, les migrations y créent directement
--     leurs tables ; sur une base existante, 008_core_schema_vyra y déplace celles de public ;
--   * le schéma public (vide à terme) appartient à vyra_owner ; personne d'autre n'y crée d'objet ;
--   * chemin de recherche « vyra, public » pour chaque rôle de connexion dans cette base : les noms non qualifiés
--     se résolvent dans vyra, puis dans public pendant la transition. L'API l'impose aussi à chaque connexion
--     (apps/api/src/db/pool.ts) ; ce réglage couvre les autres outils (psql, migrations, sauvegarde).
-- Les droits sur les tables sont posés par les migrations (009_core_privileges), pas ici.

DO $$
DECLARE r text;
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO vyra_migrator, vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup', current_database());
  FOREACH r IN ARRAY ARRAY['vyra_migrator', 'vyra_app', 'vyra_system', 'vyra_worker', 'vyra_market', 'vyra_backup'] LOOP
    EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = vyra, public', r, current_database());
  END LOOP;
END $$;

ALTER SCHEMA public OWNER TO vyra_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup;

CREATE SCHEMA IF NOT EXISTS vyra AUTHORIZATION vyra_owner;
ALTER SCHEMA vyra OWNER TO vyra_owner;
REVOKE ALL ON SCHEMA vyra FROM PUBLIC;
GRANT USAGE ON SCHEMA vyra TO vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup;
