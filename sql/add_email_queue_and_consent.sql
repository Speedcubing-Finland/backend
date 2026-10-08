-- Reliable member email: a durable queue, and consent to be emailed at all.
--
-- Why a queue: competition announcements were sent inline, one new SMTP
-- connection per message, with no retry. Every run since April reached
-- exactly 75 recipients and lost the rest with no record of who missed out.
-- Rows here are the record, and a crashed or throttled run resumes instead
-- of starting over.

CREATE TABLE IF NOT EXISTS email_queue (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name  VARCHAR(100) NULL,
  template        VARCHAR(50) NOT NULL,
  payload         TEXT NOT NULL,                    -- JSON for the template
  -- Makes a double send impossible even if a run overlaps itself:
  -- e.g. competition:FinnishChampionship2026:person@example.com
  dedupe_key      VARCHAR(191) NOT NULL UNIQUE,
  status          ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT NULL,
  scheduled_at    TIMESTAMP NULL DEFAULT NULL,      -- set by retry backoff
  sent_at         TIMESTAMP NULL DEFAULT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_due (status, scheduled_at, id)
);

-- Consent. Existing members default to subscribed: they joined an association
-- that has always sent these, and every message now carries an unsubscribe
-- link. New applications default to 0, so consent only exists when the
-- registration form actually sends it - a form bug cannot manufacture it.
ALTER TABLE members
  ADD COLUMN competition_emails TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN unsubscribe_token CHAR(32) NULL DEFAULT NULL;

ALTER TABLE pending_members
  ADD COLUMN competition_emails TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX idx_unsubscribe_token ON members (unsubscribe_token);
