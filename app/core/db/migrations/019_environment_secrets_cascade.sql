-- An environment's secrets go with it.
--
-- secrets_metadata.scopeId names the environment for scopeType='environment',
-- but it cannot be a foreign key (for scopeType='workspace' it names a
-- workspace), so deleting an environment left its sealed secrets behind with
-- no way to reach or remove them. A trigger covers every delete path — the
-- environment service, a cloud tombstone applied by the pull, and the cascade
-- from a deleted workspace — and the DELETE below clears what was already
-- orphaned.
DELETE FROM secrets_metadata
WHERE scopeType = 'environment' AND scopeId NOT IN (SELECT id FROM environments);

CREATE TRIGGER environments_delete_secrets AFTER DELETE ON environments
FOR EACH ROW
BEGIN
  DELETE FROM secrets_metadata WHERE scopeType = 'environment' AND scopeId = OLD.id;
END;
