-- Adds membership timestamps to the members table.
--
-- Run once against the production database. The change is additive: the
-- previously deployed backend keeps working, because every INSERT names its
-- columns explicitly.
--
-- The columns are declared NULL DEFAULT NULL on purpose. MariaDB gives the
-- first TIMESTAMP column in a table an implicit
-- DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, which would silently
-- rewrite submitted_at on every future update.
--
-- Members approved before this migration keep NULL: their join date is not
-- recorded anywhere, and NULL says that honestly.

ALTER TABLE members
  ADD COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN approved_at  TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN edited_at    TIMESTAMP NULL DEFAULT NULL;

-- Rollback:
-- ALTER TABLE members
--   DROP COLUMN submitted_at, DROP COLUMN approved_at, DROP COLUMN edited_at;
