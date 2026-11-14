-- VYRA — rôles PostgreSQL (lot H1). À exécuter UNE FOIS par instance PostgreSQL, par un administrateur de
-- l'instance (superutilisateur ou rôle CREATEROLE), jamais par l'application. Idempotent : les attributs sont
-- réimposés à chaque exécution. Aucun mot de passe ici : ils sont définis séparément par l'exploitant
-- (ALTER ROLE … PASSWORD …), distincts par rôle et par environnement.
--
-- Rôles PostgreSQL ≠ rôles métier. Les rôles métier des utilisateurs (seller, moderator, admin) sont des lignes
-- de la table user_roles ; aucun utilisateur de VYRA ne reçoit de rôle PostgreSQL.

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['vyra_owner','vyra_migrator','vyra_app','vyra_system','vyra_worker','vyra_market','vyra_backup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
  END LOOP;
END $$;

-- Propriétaire des objets : aucune connexion possible.
ALTER ROLE vyra_owner    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
-- Migrations : connexion ; contourne RLS (reprises de données) ; peut prendre le rôle propriétaire, rien d'autre.
ALTER ROLE vyra_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;
-- Application, authentification, tâches de fond, Market : connexion ; jamais de contournement de RLS ;
-- membres d'aucun rôle, donc aucun SET ROLE possible.
ALTER ROLE vyra_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE vyra_system   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE vyra_worker   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE vyra_market   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
-- Sauvegarde : lecture de tout (pg_dump doit lire chaque ligne, y compris sous RLS), aucune écriture.
ALTER ROLE vyra_backup   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT;

-- Délais : une transaction applicative oubliée ne garde ni verrou ni contexte indéfiniment.
ALTER ROLE vyra_app    SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE vyra_system SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE vyra_worker SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE vyra_market SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE vyra_app    SET statement_timeout = '30s';
ALTER ROLE vyra_system SET statement_timeout = '15s';
ALTER ROLE vyra_market SET statement_timeout = '30s';

-- Appartenances : seul le migrateur peut prendre le rôle propriétaire (SET ROLE explicite, sans héritage
-- implicite de ses droits). Toute autre appartenance à vyra_owner est retirée.
DO $$
DECLARE m text;
BEGIN
  FOR m IN SELECT r.rolname FROM pg_auth_members am JOIN pg_roles o ON o.oid = am.roleid JOIN pg_roles r ON r.oid = am.member
           WHERE o.rolname = 'vyra_owner' AND r.rolname <> 'vyra_migrator' LOOP
    EXECUTE format('REVOKE vyra_owner FROM %I', m);
  END LOOP;
END $$;
GRANT vyra_owner TO vyra_migrator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

-- Les rôles applicatifs ne sont membres d'aucun rôle.
DO $$
DECLARE m record;
BEGIN
  FOR m IN SELECT o.rolname AS grp, r.rolname AS mem FROM pg_auth_members am JOIN pg_roles o ON o.oid = am.roleid JOIN pg_roles r ON r.oid = am.member
           WHERE r.rolname IN ('vyra_app','vyra_system','vyra_worker','vyra_market') LOOP
    EXECUTE format('REVOKE %I FROM %I', m.grp, m.mem);
  END LOOP;
END $$;

-- Sauvegarde : rôle prédéfini de lecture de toutes les données (PostgreSQL 14+), sans droit d'écriture.
GRANT pg_read_all_data TO vyra_backup;
