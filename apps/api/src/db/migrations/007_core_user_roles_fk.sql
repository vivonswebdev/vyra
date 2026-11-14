-- Socle H2 : la suppression du compte d'un administrateur qui a attribué des rôles échouait (clé étrangère sans
-- règle). La trace de l'attribution reste dans le journal d'audit.
-- Idempotente : même résultat que la migration Market 006_market_identity (lignes 40-41) ait été appliquée ou non,
-- avant ou après celle-ci.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_granted_by_fkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
