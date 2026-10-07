-- Announcements shown on the public site, managed from the admin panel.
--
-- `type` marks statutory meeting invitations (kokouskutsu) apart from ordinary
-- news, because they are displayed differently and carry legal weight.
--
-- `published_at` is written ONCE, the first time an announcement is published,
-- and is never rewritten by a later edit. Under the Associations Act the
-- publication date is evidence that the notice period was met, so an edit must
-- not be able to move it. Edits land in `edited_at` instead.
--
-- Declared NULL DEFAULT NULL on purpose: MariaDB gives the first TIMESTAMP
-- column in a table an implicit DEFAULT CURRENT_TIMESTAMP ON UPDATE
-- CURRENT_TIMESTAMP, which would silently stamp and rewrite published_at.

CREATE TABLE IF NOT EXISTS announcements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  type          ENUM('meeting_invitation','news') NOT NULL DEFAULT 'news',
  title         VARCHAR(200) NOT NULL,
  body          TEXT NOT NULL,
  meeting_at    DATETIME NULL DEFAULT NULL,      -- invitations: when the meeting is
  location      VARCHAR(200) NULL DEFAULT NULL,  -- invitations: where it is
  published_at  TIMESTAMP NULL DEFAULT NULL,     -- NULL = draft. Write-once.
  expires_at    DATETIME NULL DEFAULT NULL,      -- hidden from the site after this
  emailed_at    TIMESTAMP NULL DEFAULT NULL,     -- proof of delivery to members
  emailed_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at     TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_visible (published_at, expires_at)
);
