jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/services/emailService', () => ({
  sendCompetitionAnnouncementEmail: jest.fn(),
  isEmailConfigured: jest.fn(() => true),
}));

const db = require('../src/db');
const { sendCompetitionAnnouncementEmail } = require('../src/services/emailService');
const { enqueueEmails, processEmailQueue } = require('../src/services/emailQueueService');

const QUEUED = {
  id: 1,
  recipient_email: 'member@example.com',
  recipient_name: 'Aino',
  template: 'competition_announcement',
  payload: JSON.stringify({ competition: { id: 'Comp2026', name: 'Comp 2026' } }),
  attempts: 0,
};

let state;

const record = (sql, params) => {
  state.statements.push({ sql: `${sql}`.replace(/\s+/g, ' ').trim(), params });
};

const find = (re) => state.statements.find((s) => re.test(s.sql));
const all = (re) => state.statements.filter((s) => re.test(s.sql));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  state = { statements: [], due: [QUEUED] };

  db.query.mockImplementation(async (sql, params) => {
    record(sql, params);
    if (/SELECT/i.test(sql)) return [state.due];
    return [{ affectedRows: 1 }];
  });
  db.execute.mockImplementation(async (sql, params) => {
    record(sql, params);
    if (/SELECT/i.test(sql)) return [state.due];
    return [{ affectedRows: 1 }];
  });
  sendCompetitionAnnouncementEmail.mockResolvedValue({ success: true });
});

afterEach(() => jest.restoreAllMocks());

describe('enqueueEmails', () => {
  const messages = [
    { recipient_email: 'a@example.com', recipient_name: 'A', template: 'competition_announcement', payload: { x: 1 }, dedupe_key: 'competition:C1:a@example.com' },
    { recipient_email: 'b@example.com', recipient_name: 'B', template: 'competition_announcement', payload: { x: 1 }, dedupe_key: 'competition:C1:b@example.com' },
  ];

  it('queues one row per recipient instead of sending immediately', async () => {
    await enqueueEmails(messages);

    expect(find(/INSERT .*INTO email_queue/i)).toBeTruthy();
    expect(sendCompetitionAnnouncementEmail).not.toHaveBeenCalled();
  });

  it('cannot create a duplicate for the same recipient and subject', async () => {
    await enqueueEmails(messages);

    // IGNORE relies on the unique dedupe_key, so a repeated run is harmless
    expect(find(/INSERT .*INTO email_queue/i).sql).toMatch(/IGNORE/i);
  });

  it('does nothing when there is nothing to queue', async () => {
    await enqueueEmails([]);

    expect(all(/INSERT .*INTO email_queue/i)).toHaveLength(0);
  });
});

describe('processEmailQueue', () => {
  it('only takes messages that are pending and due', async () => {
    await processEmailQueue({ limit: 5 });

    const select = find(/FROM email_queue/i);
    expect(select.sql).toMatch(/status = 'pending'/i);
    expect(select.sql).toMatch(/scheduled_at IS NULL OR scheduled_at <= NOW\(\)/i);
    expect(select.sql).toMatch(/LIMIT 5/i);
  });

  it('marks a delivered message as sent', async () => {
    const result = await processEmailQueue({ limit: 5 });

    expect(sendCompetitionAnnouncementEmail).toHaveBeenCalledTimes(1);
    const update = find(/UPDATE email_queue SET status = 'sent'/i);
    expect(update.sql).toMatch(/sent_at = NOW\(\)/i);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
  });

  it('records the error and retries later when a send fails', async () => {
    sendCompetitionAnnouncementEmail.mockRejectedValue(new Error('454 throttled'));

    const result = await processEmailQueue({ limit: 5 });

    const update = find(/UPDATE email_queue SET attempts/i);
    expect(update.sql).toMatch(/status = 'pending'/i);
    expect(update.sql).toMatch(/scheduled_at = /i);
    expect(update.params).toEqual(expect.arrayContaining(['454 throttled']));
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it('treats a refused send as a failure, not a success', async () => {
    sendCompetitionAnnouncementEmail.mockResolvedValue({ success: false, reason: 'mailbox full' });

    const result = await processEmailQueue({ limit: 5 });

    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it('gives up after the last attempt instead of retrying forever', async () => {
    state.due = [{ ...QUEUED, attempts: 2 }];
    sendCompetitionAnnouncementEmail.mockRejectedValue(new Error('still throttled'));

    await processEmailQueue({ limit: 5 });

    expect(find(/UPDATE email_queue SET attempts/i).sql).toMatch(/status = 'failed'/i);
  });

  it('reports when the queue is empty', async () => {
    state.due = [];

    const result = await processEmailQueue({ limit: 5 });

    expect(result).toMatchObject({ sent: 0, failed: 0, processed: 0 });
    expect(sendCompetitionAnnouncementEmail).not.toHaveBeenCalled();
  });
});
