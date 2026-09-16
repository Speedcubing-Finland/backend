jest.mock('mysql2', () => {
  const promisePool = {
    query: jest.fn().mockResolvedValue([[]]),
    execute: jest.fn().mockResolvedValue([[]]),
  };
  const pool = {
    getConnection: jest.fn(),
    promise: jest.fn(() => promisePool),
  };
  return { createPool: jest.fn(() => pool), __pool: pool, __promisePool: promisePool };
});

const mysql = require('mysql2');

const loadDb = () => {
  let db;
  jest.isolateModules(() => {
    db = require('../src/db');
  });
  return db;
};

/** Run the callback db.js passed to pool.getConnection(). */
const triggerConnection = (error) => {
  const callback = mysql.__pool.getConnection.mock.calls[0][0];
  callback(error, error ? undefined : { release: jest.fn() });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit was called');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('database pool', () => {
  it('asks MySQL for dates as strings so they are not shifted by the server timezone', () => {
    loadDb();

    expect(mysql.createPool).toHaveBeenCalledWith(
      expect.objectContaining({ dateStrings: true })
    );
  });

  it('keeps the process alive when the first connection fails', () => {
    loadDb();

    expect(() => triggerConnection(new Error('connection refused'))).not.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('reports a failed first connection', () => {
    loadDb();
    triggerConnection(new Error('connection refused'));

    expect(console.error).toHaveBeenCalled();
  });

  it('does not read member data at startup', async () => {
    loadDb();
    triggerConnection(null);
    await Promise.resolve();

    const queries = [
      ...mysql.__promisePool.query.mock.calls,
      ...mysql.__promisePool.execute.mock.calls,
    ].map(([sql]) => `${sql}`);

    expect(queries.some((sql) => /pending_members|members/i.test(sql))).toBe(false);
  });
});
