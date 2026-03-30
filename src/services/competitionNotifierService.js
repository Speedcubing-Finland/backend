const db = require('../db');
const {
  sendCompetitionAnnouncementEmail,
  isEmailConfigured,
} = require('./emailService');

const LOCK_NAME = 'competition_notifications_lock';
const COUNTRY_ISO2 = 'FI';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CHECK_INTERVAL_HOURS = parsePositiveInt(
  process.env.COMPETITION_NOTIFY_INTERVAL_HOURS,
  6
);
const CHECK_INTERVAL_MS = CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
const START_DELAY_MS = parsePositiveInt(
  process.env.COMPETITION_NOTIFY_START_DELAY_MS,
  30_000
);
const BATCH_SIZE = parsePositiveInt(process.env.COMPETITION_NOTIFY_BATCH_SIZE, 15);
const SHOULD_SEED_EXISTING =
  `${process.env.COMPETITION_NOTIFY_SEED_EXISTING || 'true'}`.toLowerCase() !== 'false';
const ENABLED =
  `${process.env.COMPETITION_NOTIFY_ENABLED || 'true'}`.toLowerCase() !== 'false';

let isChecking = false;
let intervalHandle = null;

const getTodayDateString = () => {
  return new Date().toISOString().split('T')[0];
};

const ensureNotificationTableExists = async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS competition_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      competition_id VARCHAR(64) NOT NULL UNIQUE,
      competition_name VARCHAR(255) NOT NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      notified_member_count INT NOT NULL DEFAULT 0,
      failed_member_count INT NOT NULL DEFAULT 0,
      notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const acquireProcessLock = async () => {
  const [rows] = await db.execute('SELECT GET_LOCK(?, 0) AS got_lock', [LOCK_NAME]);
  return rows?.[0]?.got_lock === 1;
};

const releaseProcessLock = async () => {
  await db.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
};

const fetchUpcomingFinlandCompetitions = async () => {
  const today = getTodayDateString();
  const url = `https://www.worldcubeassociation.org/api/v0/competitions?country_iso2=${COUNTRY_ISO2}&start=${today}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WCA API request failed (${response.status})`);
  }

  const competitions = await response.json();
  if (!Array.isArray(competitions)) {
    throw new Error('Unexpected WCA API response format');
  }

  return competitions
    .filter((competition) => competition?.id && competition?.name)
    .sort((a, b) => {
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date.localeCompare(b.start_date);
    });
};

const getNotifiedCompetitionIds = async () => {
  const [rows] = await db.execute('SELECT competition_id FROM competition_notifications');
  return new Set(rows.map((row) => row.competition_id));
};

const saveNotificationResult = async (
  competition,
  notifiedMemberCount = 0,
  failedMemberCount = 0
) => {
  await db.execute(
    `
    INSERT INTO competition_notifications (
      competition_id,
      competition_name,
      start_date,
      end_date,
      notified_member_count,
      failed_member_count
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      competition_name = VALUES(competition_name),
      start_date = VALUES(start_date),
      end_date = VALUES(end_date),
      notified_member_count = VALUES(notified_member_count),
      failed_member_count = VALUES(failed_member_count),
      notified_at = CURRENT_TIMESTAMP
  `,
    [
      competition.id,
      competition.name,
      competition.start_date || null,
      competition.end_date || null,
      notifiedMemberCount,
      failedMemberCount,
    ]
  );
};

const seedExistingCompetitionsAsNotified = async (competitions) => {
  for (const competition of competitions) {
    await saveNotificationResult(competition, 0, 0);
  }
};

const getMemberRecipients = async () => {
  const [rows] = await db.execute(`
    SELECT email, first_name
    FROM members
    WHERE email IS NOT NULL AND TRIM(email) <> ''
  `);
  return rows;
};

const sendCompetitionAnnouncementToMembers = async (competition, recipients) => {
  let successCount = 0;
  let failedCount = 0;

  for (let index = 0; index < recipients.length; index += BATCH_SIZE) {
    const batch = recipients.slice(index, index + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((recipient) =>
        sendCompetitionAnnouncementEmail(
          recipient.email,
          recipient.first_name || 'speedcuber',
          competition
        )
      )
    );

    batchResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value?.success) {
        successCount += 1;
      } else {
        failedCount += 1;
      }
    });
  }

  return { successCount, failedCount };
};

const runCompetitionNotificationCheck = async ({ manual = false } = {}) => {
  if (isChecking) {
    return { status: 'skipped', reason: 'already_running' };
  }

  if (!isEmailConfigured()) {
    return { status: 'skipped', reason: 'email_not_configured' };
  }

  isChecking = true;
  let lockAcquired = false;

  try {
    await ensureNotificationTableExists();

    lockAcquired = await acquireProcessLock();
    if (!lockAcquired) {
      return { status: 'skipped', reason: 'lock_not_acquired' };
    }

    const competitions = await fetchUpcomingFinlandCompetitions();
    const notifiedIds = await getNotifiedCompetitionIds();
    const newCompetitions = competitions.filter(
      (competition) => !notifiedIds.has(competition.id)
    );

    if (newCompetitions.length === 0) {
      return { status: 'ok', checked: competitions.length, newCompetitions: 0 };
    }

    if (notifiedIds.size === 0 && SHOULD_SEED_EXISTING && !manual) {
      await seedExistingCompetitionsAsNotified(newCompetitions);
      return {
        status: 'seeded',
        seeded: newCompetitions.length,
        reason: 'first_run_seed',
      };
    }

    const recipients = await getMemberRecipients();

    if (recipients.length === 0) {
      await seedExistingCompetitionsAsNotified(newCompetitions);
      return {
        status: 'ok',
        newCompetitions: newCompetitions.length,
        recipients: 0,
        sent: 0,
      };
    }

    let totalSent = 0;
    let totalFailed = 0;
    const processedCompetitions = [];

    for (const competition of newCompetitions) {
      const { successCount, failedCount } =
        await sendCompetitionAnnouncementToMembers(competition, recipients);

      totalSent += successCount;
      totalFailed += failedCount;
      processedCompetitions.push({
        id: competition.id,
        name: competition.name,
        sent: successCount,
        failed: failedCount,
      });

      await saveNotificationResult(competition, successCount, failedCount);
    }

    return {
      status: 'ok',
      newCompetitions: newCompetitions.length,
      recipients: recipients.length,
      sent: totalSent,
      failed: totalFailed,
      competitions: processedCompetitions,
    };
  } catch (error) {
    console.error('[competition-notifier] Notification check failed:', error);
    return { status: 'error', reason: error.message };
  } finally {
    if (lockAcquired) {
      try {
        await releaseProcessLock();
      } catch (lockError) {
        console.error('[competition-notifier] Failed to release lock:', lockError);
      }
    }
    isChecking = false;
  }
};

const startCompetitionNotifier = () => {
  if (!ENABLED) {
    console.log('[competition-notifier] Disabled by COMPETITION_NOTIFY_ENABLED=false');
    return;
  }

  if (intervalHandle) {
    console.log('[competition-notifier] Already running');
    return;
  }

  console.log(
    `[competition-notifier] Enabled. Checking every ${CHECK_INTERVAL_HOURS} hour(s).`
  );

  setTimeout(() => {
    runCompetitionNotificationCheck()
      .then((result) => {
        console.log('[competition-notifier] Initial check result:', result);
      })
      .catch((error) => {
        console.error('[competition-notifier] Initial check error:', error);
      });
  }, START_DELAY_MS);

  intervalHandle = setInterval(() => {
    runCompetitionNotificationCheck()
      .then((result) => {
        console.log('[competition-notifier] Scheduled check result:', result);
      })
      .catch((error) => {
        console.error('[competition-notifier] Scheduled check error:', error);
      });
  }, CHECK_INTERVAL_MS);
};

const stopCompetitionNotifier = () => {
  if (!intervalHandle) return;

  clearInterval(intervalHandle);
  intervalHandle = null;
};

module.exports = {
  runCompetitionNotificationCheck,
  startCompetitionNotifier,
  stopCompetitionNotifier,
};
