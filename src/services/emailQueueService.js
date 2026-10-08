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

// Only one worker may drain the queue at a time. Without this, a cron run and
// the in-app timer could select the same pending rows and send them twice -
// the dedupe key prevents duplicate queueing, not duplicate sending.
const WORKER_LOCK = 'email_queue_worker';

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

  const [lock] = await db.query('SELECT GET_LOCK(?, 0) AS got_lock', [WORKER_LOCK]);
  if (lock?.[0]?.got_lock !== 1) {
    return { processed: 0, sent: 0, failed: 0, reason: 'locked' };
  }

  try {
    return await drain(size);
  } finally {
    try {
      await db.query('SELECT RELEASE_LOCK(?)', [WORKER_LOCK]);
    } catch (lockError) {
      console.error('[email-queue] Failed to release worker lock:', lockError.message);
    }
  }
};

const drain = async (size) => {
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

/**
 * Drain the queue from inside the running app, on a timer.
 *
 * Hostinger's cron does not appear to execute on this account, so delivery
 * cannot depend on it. The app sleeps when there is no traffic, which makes
 * this timer irregular - and that is acceptable precisely because the queue
 * is durable: messages wait, and the next run continues where this one
 * stopped. Nothing is lost by a missed tick.
 *
 * Safe to run alongside a cron worker: both take the same advisory lock.
 */
const WORKER_INTERVAL_MS = parsePositiveInt(process.env.EMAIL_QUEUE_INTERVAL_MS, 2 * 60 * 1000);
let workerHandle = null;

const startEmailQueueWorker = () => {
  if (`${process.env.EMAIL_QUEUE_IN_APP || 'true'}`.toLowerCase() === 'false') {
    console.log('[email-queue] In-app worker disabled by EMAIL_QUEUE_IN_APP=false');
    return null;
  }
  if (workerHandle) return workerHandle;

  console.log(`[email-queue] In-app worker started, every ${WORKER_INTERVAL_MS / 1000}s`);

  workerHandle = setInterval(() => {
    processEmailQueue()
      .then((result) => {
        if (result.processed > 0) {
          console.log(`[email-queue] processed=${result.processed} sent=${result.sent} failed=${result.failed}`);
        }
      })
      .catch((error) => console.error('[email-queue] Worker run failed:', error.message));
  }, WORKER_INTERVAL_MS);

  // Never hold the process open just for this timer
  if (typeof workerHandle.unref === 'function') workerHandle.unref();

  return workerHandle;
};

module.exports = { enqueueEmails, processEmailQueue, startEmailQueueWorker, MAX_ATTEMPTS };
