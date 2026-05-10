-- Grant the anon and authenticated roles the necessary table-level privileges
-- on vinted_sniper_decisions so RLS policies can take effect.
--
-- Background: in a brand-new public-schema table the role grants are not
-- automatically inherited from default privileges in this project, so the
-- "anon can insert decisions" policy from migration ...000001 was a no-op
-- (insert was rejected at the GRANT layer before RLS was even consulted).

GRANT INSERT ON vinted_sniper_decisions TO anon;
GRANT SELECT ON vinted_sniper_decisions TO authenticated;
