// The app pulls in the database pool and the competition notifier at import
// time; both are mocked so the test suite never touches the production
// database or schedules background work.
jest.mock('../src/db', () => ({ execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() }));
jest.mock('../src/services/competitionNotifierService', () => ({
  runCompetitionNotificationCheck: jest.fn(),
  startCompetitionNotifier: jest.fn(),
}));
jest.mock('../src/services/emailQueueService', () => ({
  enqueueEmails: jest.fn(),
  processEmailQueue: jest.fn(),
  startEmailQueueWorker: jest.fn(),
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

describe('background workers', () => {
  // Passenger does not run src/index.js as the main module: it requires the
  // file and serves the exported app itself. Anything started inside an
  // `if (require.main === module)` guard therefore never runs in production.
  it('start when the app is required rather than run directly', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      jest.isolateModules(() => {
        const queue = require('../src/services/emailQueueService');
        const notifier = require('../src/services/competitionNotifierService');
        require('../src/index');

        expect(queue.startEmailQueueWorker).toHaveBeenCalled();
        expect(notifier.startCompetitionNotifier).toHaveBeenCalled();
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
