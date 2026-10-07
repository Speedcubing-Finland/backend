const request = require('supertest');
const express = require('express');

jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/middleware/auth', () => (req, res, next) => next());
jest.mock('../src/services/emailService', () => ({
  sendRegistrationApprovedEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendRegistrationPendingEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendCompetitionAnnouncementEmail: jest.fn(() => Promise.resolve({ success: true })),
}));
jest.mock('../src/services/competitionNotifierService', () => ({
  runCompetitionNotificationCheck: jest.fn(() => Promise.resolve({})),
  startCompetitionNotifier: jest.fn(),
}));

const db = require('../src/db');
const adminRoutes = require('../src/routes/admin');
const { router: publicRoutes } = require('../src/routes/public');

const DRAFT = {
  id: 1, type: 'meeting_invitation', title: 'Syyskokous 2026',
  body: 'Esityslista...', meeting_at: '2026-11-15 18:00:00', location: 'Helsinki',
  published_at: null, expires_at: null, emailed_at: null, emailed_count: 0,
  created_at: '2026-10-07 21:00:00', edited_at: null,
};
const PUBLISHED = { ...DRAFT, id: 2, published_at: '2026-10-07 21:05:00', expires_at: '2026-11-16 18:00:00' };

let app, state;

const executor = () => jest.fn(async (sql, params = []) => {
  state.statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  if (/INSERT INTO announcements/i.test(sql)) return [{ insertId: 10, affectedRows: 1 }];
  if (/UPDATE announcements/i.test(sql)) return [{ affectedRows: 1 }];
  if (/DELETE FROM announcements/i.test(sql)) return [{ affectedRows: state.rows.length ? 1 : 0 }];
  if (/FROM announcements/i.test(sql)) return [state.rows];
  return [[]];
});

const find = (re) => state.statements.find((s) => re.test(s.sql));
const all = (re) => state.statements.filter((s) => re.test(s.sql));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  state = { statements: [], rows: [DRAFT] };
  db.execute.mockImplementation(executor());
  app = express();
  app.use(express.json());
  app.use('/api', publicRoutes);
  app.use('/api/admin', adminRoutes);
});

afterEach(() => jest.restoreAllMocks());

describe('GET /api/announcements (public)', () => {
  it('returns only announcements that are published and not expired', async () => {
    state.rows = [PUBLISHED];
    const res = await request(app).get('/api/announcements');

    expect(res.statusCode).toBe(200);
    const q = find(/FROM announcements/i);
    expect(q.sql).toMatch(/published_at IS NOT NULL/i);
    expect(q.sql).toMatch(/expires_at IS NULL OR expires_at >/i);
    expect(res.body[0]).toMatchObject({ id: 2, type: 'meeting_invitation' });
  });
});

describe('POST /api/admin/announcements', () => {
  it('creates an unpublished draft', async () => {
    const res = await request(app).post('/api/admin/announcements').send({
      type: 'news', title: 'Uutinen', body: 'Tekstiä',
    });

    expect(res.statusCode).toBe(201);
    const insert = find(/INSERT INTO announcements/i);
    expect(insert.sql).not.toMatch(/published_at/i);
  });

  it('requires a title and a body', async () => {
    const res = await request(app).post('/api/admin/announcements').send({ type: 'news', title: '  ' });

    expect(res.statusCode).toBe(400);
    expect(all(/INSERT INTO announcements/i)).toHaveLength(0);
  });

  it('requires time and place for a meeting invitation', async () => {
    const res = await request(app).post('/api/admin/announcements').send({
      type: 'meeting_invitation', title: 'Syyskokous', body: 'Esityslista', location: 'Helsinki',
    });

    expect(res.statusCode).toBe(400);
    expect(all(/INSERT INTO announcements/i)).toHaveLength(0);
  });
});

describe('POST /api/admin/announcements/:id/publish', () => {
  it('stamps published_at and derives the expiry from the meeting date', async () => {
    const res = await request(app).post('/api/admin/announcements/1/publish').send({});

    expect(res.statusCode).toBe(200);
    const update = find(/UPDATE announcements/i);
    expect(update.sql).toMatch(/published_at\s*=\s*NOW\(\)/i);
    expect(update.sql).toMatch(/expires_at/i);
  });

  it('refuses to move the publication date of an already published notice', async () => {
    state.rows = [PUBLISHED];
    const res = await request(app).post('/api/admin/announcements/2/publish').send({});

    expect(res.statusCode).toBe(409);
    expect(all(/UPDATE announcements/i)).toHaveLength(0);
  });

  it('returns 404 for an unknown announcement', async () => {
    state.rows = [];
    const res = await request(app).post('/api/admin/announcements/99/publish').send({});

    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/admin/announcements/:id', () => {
  it('records the edit without touching the publication date', async () => {
    state.rows = [PUBLISHED];
    const res = await request(app).put('/api/admin/announcements/2').send({
      type: 'meeting_invitation', title: 'Syyskokous 2026 (korjattu)', body: 'Esityslista',
      meeting_at: '2026-11-15 18:00:00', location: 'Helsinki',
    });

    expect(res.statusCode).toBe(200);
    const update = find(/UPDATE announcements/i);
    expect(update.sql).toMatch(/edited_at\s*=\s*NOW\(\)/i);
    expect(update.sql).not.toMatch(/published_at\s*=/i);
  });
});

describe('DELETE /api/admin/announcements/:id', () => {
  it('removes the announcement', async () => {
    const res = await request(app).delete('/api/admin/announcements/1');

    expect(res.statusCode).toBe(200);
    expect(find(/DELETE FROM announcements/i).params).toEqual(['1']);
  });
});
