// The app pulls in the database pool and the competition notifier at import
// time; both are mocked so the test suite never touches the production
// database or schedules background work.
jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/services/competitionNotifierService', () => ({
  runCompetitionNotificationCheck: jest.fn(),
  startCompetitionNotifier: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/index'); 

describe('GET /', () => {
  it('should return a greeting', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('Hello from Speedcubing Finland backend!');
  });
});


