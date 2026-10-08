const db = require('../db');
const { sendCompetitionAnnouncementEmail, isEmailConfigured } = require('./emailService');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// How many messages one worker run sends. Kept low on purpose: the mailbox
// throttles on connection rate, and a steady drip is what it tolerates.
const DEFAULT_BATCH_SIZE = parsePositiveInt(process.env.EMAIL_QUEUE_BATCH_SIZE, 10);
const MAX_ATTEMPTS = parsePositiveInt(process.env.EMAIL_QUEUE_MAX_ATTEMPTS, 3);
const RETRY_BACKOFF_MINUTES = [5, 30, 120];

/**
 * One handler per template. A queued row names its template, so adding a new
 * kind of email is adding an entry here, not touching the worker.
 */
const TEMPLATES = {
  competition_announcement: ({ recipient, payload }) =>
    sendCompetitionAnnouncementEmail(
      recipient.email,
      recipient.name || 'speedcuber',
      payload.competition,
      payload.unsubscribeUrl
    ),
};

const safeParsePayload = (value) => {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value || {};
  } catch {
    return {};
  }
};

/**
 * Add messages to the queue. Nothing is sent here - the caller returns
 * immediately and the worker does the slow part.
 *
 * Duplicates are impossible: dedupe_key is unique, so re-running a check that
 * already queued an announcement inserts nothing.
 */
const enqueueEmails = async (messages = []) => {
  if (!Array.isArray(messages) || messages.length === 0) return { queued: 0 };

  const values = messages.map((message) => [
    message.recipient_email,
    message.recipient_name || null,
    message.template,
    JSON.stringify(message.payload || {}),
    message.dedupe_key,
  ]);

  const [result] = await db.query(
    `INSERT IGNORE INTO email_queue
       (recipient_email, recipient_name, template, payload, dedupe_key)
     VALUES ?`,
    [values]
  );

  return { queued: result?.affectedRows ?? 0 };
};

/** Send the next due messages. Safe to call repeatedly; safe to interrupt. */
const processEmailQueue = async ({ limit } = {}) => {
  if (!isEmailConfigured()) {
    return { processed: 0, sent: 0, failed: 0, reason: 'email_not_configured' };
  }

  const size = parsePositiveInt(limit, DEFAULT_BATCH_SIZE);

  const [rows] = await db.query(
    `SELECT id, recipient_email, recipient_name, template, payload, attempts
     FROM email_queue
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY id ASC
     LIMIT ${size}`
  );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const handler = TEMPLATES[row.template];
      if (!handler) throw new Error(`Unknown email template: ${row.template}`);

      const result = await handler({
        recipient: { email: row.recipient_email, name: row.recipient_name },
        payload: safeParsePayload(row.payload),
      });

      // A refusal is a failure: the old code counted only thrown errors and
      // reported success for mail that never arrived
      if (!result || result.success !== true) {
        throw new Error(result?.reason || result?.error || 'Send refused');
      }

      await db.execute(
        `UPDATE email_queue
         SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL
         WHERE id = ?`,
        [row.id]
      );
      sent += 1;
    } catch (error) {
      failed += 1;

      const attempts = (row.attempts || 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const message = `${error.message || error}`.slice(0, 500);

      if (giveUp) {
        await db.execute(
          `UPDATE email_queue SET attempts = ?, last_error = ?, status = 'failed' WHERE id = ?`,
          [attempts, message, row.id]
        );
      } else {
        const backoff = RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)];
        await db.execute(
          `UPDATE email_queue
           SET attempts = ?, last_error = ?, status = 'pending',
               scheduled_at = DATE_ADD(NOW(), INTERVAL ? MINUTE)
           WHERE id = ?`,
          [attempts, message, backoff, row.id]
        );
      }
    }
  }

  return { processed: rows.length, sent, failed };
};

module.exports = { enqueueEmails, processEmailQueue, MAX_ATTEMPTS };
