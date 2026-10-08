const request = require('supertest');
const express = require('express');

jest.mock('../src/db', () => ({
  execute: jest.fn(),
  query: jest.fn(),
  getConnection: jest.fn(),
}));
jest.mock('../src/middleware/auth', () => (req, res, next) => next());
jest.mock('../src/services/emailService', () => ({
  sendRegistrationApprovedEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendCompetitionAnnouncementEmail: jest.fn(() => Promise.resolve({ success: true })),
}));
jest.mock('../src/services/competitionNotifierService', () => ({
  runCompetitionNotificationCheck: jest.fn(() => Promise.resolve({ status: 'ok' })),
  startCompetitionNotifier: jest.fn(),
}));

const db = require('../src/db');
const adminRoutes = require('../src/routes/admin');

const PENDING = {
  id: 7,
  first_name: 'Aino',
  last_name: 'Virtanen',
  city: 'Tampere',
  email: 'aino@example.com',
  wca_id: '2019VIRT01',
  birth_date: '2008-04-02',
  submitted_at: '2026-09-01 10:15:00',
};

const MEMBER = {
  id: 42,
  first_name: 'Eero',
  last_name: 'Laine',
  city: 'Espoo',
  email: 'eero@example.com',
  wca_id: null,
  birth_date: '2001-07-11',
  submitted_at: null,
  approved_at: '2026-02-02 09:00:00',
  edited_at: null,
};

const VALID_EDIT = {
  first_name: 'Eero',
  last_name: 'Laine',
  city: 'Vantaa',
  email: 'eero@example.com',
  wca_id: '2016LAIN01',
  birth_date: '2001-07-11',
};

let app;
let state;
let connection;

const makeExecutor = () =>
  jest.fn(async (sql, params = []) => {
    state.statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (state.failOn && state.failOn.test(sql)) throw new Error('database unavailable');
    if (/FROM pending_members WHERE id/i.test(sql)) return [state.pendingRows];
    if (/COUNT\(\*\)[\s\S]*FROM members WHERE email/i.test(sql)) return [[{ count: state.duplicateCount }]];
    if (/INSERT INTO members/i.test(sql)) return [{ insertId: 100, affectedRows: 1 }];
    if (/DELETE FROM pending_members/i.test(sql)) return [{ affectedRows: 1 }];
    if (/UPDATE members/i.test(sql)) return [{ affectedRows: state.memberRows.length ? 1 : 0 }];
    if (/FROM members/i.test(sql)) return [state.memberRows];
    return [[]];
  });

const find = (pattern) => state.statements.find((s) => pattern.test(s.sql));
const all = (pattern) => state.statements.filter((s) => pattern.test(s.sql));

beforeEach(() => {
  jest.clearAllMocks();
  // The failure-path tests deliberately trigger database errors, which the
  // routes log; keep the test output readable.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  state = {
    statements: [],
    pendingRows: [PENDING],
    memberRows: [MEMBER],
    duplicateCount: 0,
    failOn: null,
  };

  const execute = makeExecutor();
  connection = {
    execute,
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.execute.mockImplementation(execute);
  db.getConnection.mockResolvedValue(connection);

  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/admin/approve', () => {
  it('records the original application date and the approval time on the new member', async () => {
    const res = await request(app).post('/api/admin/approve').send({ id: 7 });

    expect(res.statusCode).toBe(200);
    const insert = find(/INSERT INTO members/i);
    expect(insert.sql).toMatch(/submitted_at/);
    expect(insert.sql).toMatch(/approved_at/);
    expect(insert.params).toContain(PENDING.submitted_at);
  });

  it('keeps the pending application when creating the member fails', async () => {
    state.failOn = /INSERT INTO members/i;

    const res = await request(app).post('/api/admin/approve').send({ id: 7 });

    expect(res.statusCode).toBe(500);
    expect(connection.rollback).toHaveBeenCalled();
    expect(all(/DELETE FROM pending_members/i)).toHaveLength(0);
  });

  it('undoes the new member when removing the pending application fails', async () => {
    state.failOn = /DELETE FROM pending_members/i;

    const res = await request(app).post('/api/admin/approve').send({ id: 7 });

    expect(res.statusCode).toBe(500);
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('refuses an application whose email is already in the register', async () => {
    state.duplicateCount = 1;

    const res = await request(app).post('/api/admin/approve').send({ id: 7 });

    expect(res.statusCode).toBe(400);
    expect(all(/INSERT INTO members/i)).toHaveLength(0);
    expect(connection.release).toHaveBeenCalled();
  });
});

describe('PUT /api/admin/members/:id', () => {
  it('saves the new values and stamps edited_at', async () => {
    const res = await request(app).put('/api/admin/members/42').send(VALID_EDIT);

    expect(res.statusCode).toBe(200);
    const update = find(/UPDATE members/i);
    expect(update.sql).toMatch(/edited_at\s*=\s*NOW\(\)/i);
    expect(update.params).toContain('Vantaa');
    expect(update.params).toContain('2016LAIN01');
  });

  it('returns the updated member', async () => {
    const res = await request(app).put('/api/admin/members/42').send(VALID_EDIT);

    expect(res.body).toMatchObject({ id: 42, email: 'eero@example.com' });
  });

  it('returns 404 when the member does not exist', async () => {
    state.memberRows = [];

    const res = await request(app).put('/api/admin/members/999').send(VALID_EDIT);

    expect(res.statusCode).toBe(404);
    expect(all(/UPDATE members/i)).toHaveLength(0);
  });

  it('refuses an email that already belongs to another member', async () => {
    state.duplicateCount = 1;

    const res = await request(app)
      .put('/api/admin/members/42')
      .send({ ...VALID_EDIT, email: 'taken@example.com' });

    expect(res.statusCode).toBe(400);
    expect(all(/UPDATE members/i)).toHaveLength(0);
  });

  it('excludes the member itself from the duplicate email check', async () => {
    const res = await request(app).put('/api/admin/members/42').send(VALID_EDIT);

    expect(res.statusCode).toBe(200);
    const check = find(/COUNT\(\*\)[\s\S]*FROM members WHERE email/i);
    expect(check.sql).toMatch(/id\s*(!=|<>)\s*\?/i);
    expect(check.params).toEqual(['eero@example.com', '42']);
  });

  it('requires the mandatory fields', async () => {
    const res = await request(app)
      .put('/api/admin/members/42')
      .send({ ...VALID_EDIT, last_name: '   ' });

    expect(res.statusCode).toBe(400);
    expect(all(/UPDATE members/i)).toHaveLength(0);
  });

  it('lets an admin turn competition emails off for a member', async () => {
    const res = await request(app)
      .put('/api/admin/members/42')
      .send({ ...VALID_EDIT, competition_emails: false });

    expect(res.statusCode).toBe(200);
    const update = find(/UPDATE members/i);
    expect(update.sql).toMatch(/competition_emails = \?/i);
    expect(update.params).toContain(0);
  });

  it('leaves the subscription alone when the field is not sent', async () => {
    const res = await request(app).put('/api/admin/members/42').send(VALID_EDIT);

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE members/i).sql).not.toMatch(/competition_emails/i);
  });

  it('stores an empty WCA ID as null', async () => {
    const res = await request(app).put('/api/admin/members/42').send({ ...VALID_EDIT, wca_id: '' });

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE members/i).params).toContain(null);
  });
});

describe('GET /api/admin/members', () => {
  it('includes the membership timestamps so the admin page can show them', async () => {
    const res = await request(app).get('/api/admin/members');

    expect(res.statusCode).toBe(200);
    const select = find(/SELECT[\s\S]*FROM members/i);
    expect(select.sql).toMatch(/submitted_at/);
    expect(select.sql).toMatch(/approved_at/);
    expect(select.sql).toMatch(/edited_at/);
    expect(select.sql).toMatch(/\bid\b/);
    expect(select.sql).toMatch(/city/);
    expect(select.sql).toMatch(/birth_date/);
  });
});
