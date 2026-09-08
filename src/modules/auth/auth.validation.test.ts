import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const app = createApp();

describe('auth validation', () => {
  it('POST /api/v1/auth/signup rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v1/auth/signup rejects short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'user@example.com', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('GET /api/v1/users/me requires auth', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
