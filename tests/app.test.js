const request = require('supertest');
const app = require('../src/index'); 

describe('GET /', () => {
  it('should return a greeting', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('Hello from Speedcubing Finland backend!');
  });
});


