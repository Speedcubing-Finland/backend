const request = require('supertest');
const express = require('express');

jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/middleware/auth', () => (req, res, next) => next());
jest.mock('../src/services/emailService', () => ({
  sendRegistrationApprovedEmail: jest.fn(() => Promise.resolve({ success: true })),
  sendCompetitionAnnouncementEmail: jest.fn(() => Promise.resolve({ success: true })),
}));
jest.mock('../src/services/competitionNotifierService', () => ({
  runCompetitionNotificationCheck: jest.fn(() => Promise.resolve({})),
  startCompetitionNotifier: jest.fn(),
}));

const db = require('../src/db');
const adminRoutes = require('../src/routes/admin');

const PENDING = {
  id: 7, first_name: 'Eeki', last_name: 'Ekonen', city: 'Eurajoki',
  email: 'eeki@example.com', wca_id: '00006', birth_date: '2006-07-06',
  submitted_at: '2026-09-01 10:15:00',
};

const VALID = {
  first_name: 'Eeki', last_name: 'Ekonen', city: 'Eurajoki',
  email: 'eeki@example.com', wca_id: '', birth_date: '2006-07-06',
};

let app, state;

const executor = () => jest.fn(async (sql, params = []) => {
  state.statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
  if (/COUNT\(\*\)[\s\S]*FROM pending_members/i.test(sql)) return [[{ count: state.pendingDuplicates }]];
  if (/COUNT\(\*\)[\s\S]*FROM members/i.test(sql)) return [[{ count: state.memberDuplicates }]];
  if (/UPDATE pending_members/i.test(sql)) return [{ affectedRows: 1 }];
  if (/FROM pending_members/i.test(sql)) return [state.rows];
  if (/FROM members/i.test(sql)) return [state.memberRows];
  return [[]];
});

const find = (re) => state.statements.find((s) => re.test(s.sql));
const all = (re) => state.statements.filter((s) => re.test(s.sql));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  state = { statements: [], rows: [PENDING], memberRows: [], pendingDuplicates: 0, memberDuplicates: 0 };
  db.execute.mockImplementation(executor());
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

afterEach(() => jest.restoreAllMocks());

describe('PUT /api/admin/submissions/:id', () => {
  it('saves corrections to a waiting application', async () => {
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, city: 'Pori' });

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE pending_members/i).params).toContain('Pori');
  });

  it('clears an invalid WCA ID when the field is emptied', async () => {
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, wca_id: '' });

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE pending_members/i).params).toContain(null);
  });

  it('rejects a malformed WCA ID', async () => {
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, wca_id: '00006' });

    expect(res.statusCode).toBe(400);
    expect(all(/UPDATE pending_members/i)).toHaveLength(0);
  });

  it('accepts a correctly formatted WCA ID and stores it upper case', async () => {
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, wca_id: ' 2024kulp03 ' });

    expect(res.statusCode).toBe(200);
    expect(find(/UPDATE pending_members/i).params).toContain('2024KULP03');
  });

  it('refuses an email that already belongs to a member', async () => {
    state.memberDuplicates = 1;
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, email: 'taken@example.com' });

    expect(res.statusCode).toBe(400);
    expect(all(/UPDATE pending_members/i)).toHaveLength(0);
  });

  it('refuses an email already used by another waiting application', async () => {
    state.pendingDuplicates = 1;
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, email: 'other@example.com' });

    expect(res.statusCode).toBe(400);
    expect(all(/UPDATE pending_members/i)).toHaveLength(0);
  });

  it('returns 404 for an unknown application', async () => {
    state.rows = [];
    const res = await request(app).put('/api/admin/submissions/99').send(VALID);

    expect(res.statusCode).toBe(404);
  });

  it('requires the mandatory fields', async () => {
    const res = await request(app).put('/api/admin/submissions/7').send({ ...VALID, city: '  ' });

    expect(res.statusCode).toBe(400);
  });
});
