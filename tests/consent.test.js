const request = require('supertest');
const express = require('express');

jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/middleware/auth', () => (req, res, next) => next());
jest.mock('../src/services/emailService', () => ({
  sendRegistrationApprovedEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendRegistrationPendingEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendCompetitionAnnouncementEmail: jest.fn(() => Promise.resolve({ success: true })),
  isEmailConfigured: jest.fn(() => true),
}));
jest.mock('../src/services/emailQueueService', () => ({
  enqueueEmails: jest.fn(() => Promise.resolve({ queued: 0 })),
  processEmailQueue: jest.fn(),
}));

const db = require('../src/db');
const { enqueueEmails } = require('../src/services/emailQueueService');
const adminRoutes = require('../src/routes/admin');
const { router: publicRoutes } = require('../src/routes/public');

const MEMBER = { id: 42, first_name: 'Eero', email: 'eero@example.com', competition_emails: 1 };
const PENDING = {
  id: 7, first_name: 'Aino', last_name: 'Virtanen', city: 'Tampere', email: 'aino@example.com',
  wca_id: null, birth_date: '2008-04-02', submitted_at: '2026-09-01 10:15:00', competition_emails: 1,
};

let app, state, connection;

const executor = () => jest.fn(async (sql, params = []) => {
  state.statements.push({ sql: `${sql}`.replace(/\s+/g, ' ').trim(), params });
  if (/GET_LOCK/i.test(sql)) return [[{ got_lock: 1 }]];
  if (/RELEASE_LOCK/i.test(sql)) return [[{ released: 1 }]];
  if (/COUNT\(\*\)[\s\S]*FROM pending_members/i.test(sql)) return [[{ count: 0 }]];
  if (/COUNT\(\*\)[\s\S]*FROM members/i.test(sql)) return [[{ count: 0 }]];
  if (/FROM pending_members WHERE id/i.test(sql)) return [[PENDING]];
  if (/UPDATE members/i.test(sql)) return [{ affectedRows: state.tokenMatches }];
  if (/FROM members WHERE unsubscribe_token/i.test(sql)) return [state.tokenMatches ? [MEMBER] : []];
  if (/INSERT INTO/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
  if (/DELETE FROM/i.test(sql)) return [{ affectedRows: 1 }];
  if (/FROM members/i.test(sql)) return [[MEMBER]];
  return [[]];
});

const find = (re) => state.statements.find((s) => re.test(s.sql));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  state = { statements: [], tokenMatches: 1 };

  const execute = executor();
  connection = {
    execute,
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.execute.mockImplementation(execute);
  db.query.mockImplementation(execute);
  db.getConnection.mockResolvedValue(connection);

  app = express();
  app.use(express.json());
  app.use('/api', publicRoutes);
  app.use('/api/admin', adminRoutes);
});

afterEach(() => jest.restoreAllMocks());

describe('consent at registration', () => {
  it('stores the choice when someone opts in', async () => {
    const res = await request(app).post('/api/submit-member').send({
      firstName: 'Aino', lastName: 'Virtanen', city: 'Tampere',
      email: 'aino@example.com', birthDate: '2008-04-02', competitionEmails: true,
    });

    expect(res.statusCode).toBe(200);
    const insert = find(/INSERT INTO pending_members/i);
    expect(insert.sql).toMatch(/competition_emails/i);
    expect(insert.params).toContain(1);
  });

  it('defaults to no consent when the box is not ticked', async () => {
    const res = await request(app).post('/api/submit-member').send({
      firstName: 'Aino', lastName: 'Virtanen', city: 'Tampere',
      email: 'aino@example.com', birthDate: '2008-04-02',
    });

    expect(res.statusCode).toBe(200);
    expect(find(/INSERT INTO pending_members/i).params).toContain(0);
  });
});

describe('approval', () => {
  it('carries the consent over and creates an unsubscribe token', async () => {
    const res = await request(app).post('/api/admin/approve').send({ id: 7 });

    expect(res.statusCode).toBe(200);
    const insert = find(/INSERT INTO members/i);
    expect(insert.sql).toMatch(/competition_emails/i);
    expect(insert.sql).toMatch(/unsubscribe_token/i);
    // 32 hex characters of crypto-strong randomness
    expect(insert.params.some((p) => typeof p === 'string' && /^[0-9a-f]{32}$/.test(p))).toBe(true);
  });
});

describe('POST /api/unsubscribe', () => {
  it('stops competition emails for the holder of the token', async () => {
    const res = await request(app).post('/api/unsubscribe').send({ token: 'a'.repeat(32) });

    expect(res.statusCode).toBe(200);
    const update = find(/UPDATE members SET competition_emails = 0/i);
    expect(update.params).toContain('a'.repeat(32));
    expect(res.body).toMatchObject({ subscribed: false });
  });

  it('returns 404 for a token that matches nobody', async () => {
    state.tokenMatches = 0;
    const res = await request(app).post('/api/unsubscribe').send({ token: 'b'.repeat(32) });

    expect(res.statusCode).toBe(404);
  });

  it('requires a token', async () => {
    const res = await request(app).post('/api/unsubscribe').send({});
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/resubscribe', () => {
  it('turns competition emails back on', async () => {
    const res = await request(app).post('/api/resubscribe').send({ token: 'a'.repeat(32) });

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE members SET competition_emails = 1/i)).toBeTruthy();
    expect(res.body).toMatchObject({ subscribed: true });
  });
});

describe('competition notifications', () => {
  it('queues only members who consented, and sends nothing inline', async () => {
    const { runCompetitionNotificationCheck } = require('../src/services/competitionNotifierService');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ id: 'Comp2026', name: 'Comp 2026', start_date: '2026-12-01', end_date: '2026-12-01' }]),
    }));

    await runCompetitionNotificationCheck({ manual: true });

    const recipients = find(/FROM members WHERE/i);
    expect(recipients.sql).toMatch(/competition_emails = 1/i);
    expect(enqueueEmails).toHaveBeenCalled();
  });
});
