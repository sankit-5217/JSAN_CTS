-- Data only: JSAN ServiceDesk is the default Assignee Group for new client
-- reports (decided 2026-10-15; production had "Infra team" as default).
-- Same effect and audit record as Support Groups -> "Make default". Does
-- nothing when the group doesn't exist or is already the default.
--
-- Rollback: Support Groups page -> "Make default" on the previous group
-- (its id is in this migration's audit event, before.previousDefaultGroupId).

DO $$
DECLARE
  sd   text;
  prev text;
BEGIN
  SELECT id INTO sd FROM support_groups WHERE name = 'JSAN ServiceDesk';
  IF sd IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO prev FROM support_groups WHERE is_default_assignee = true;
  IF prev IS NOT DISTINCT FROM sd THEN
    RETURN;
  END IF;
  -- Only one TRUE row is allowed (unique index): clear the old default first.
  UPDATE support_groups SET is_default_assignee = NULL WHERE is_default_assignee = true;
  UPDATE support_groups SET is_default_assignee = true WHERE id = sd;
  INSERT INTO audit_events (id, actor_id, entity_type, entity_id, action, before, after, correlation_id, created_at)
  VALUES (
    gen_random_uuid()::text,
    NULL,
    'SupportGroup',
    sd,
    'SET_DEFAULT_ASSIGNEE',
    jsonb_build_object('previousDefaultGroupId', prev),
    jsonb_build_object('id', sd, 'name', 'JSAN ServiceDesk', 'isDefaultAssignee', true),
    'migration:20261015130000_default_assignee_service_desk',
    now()
  );
END $$;
