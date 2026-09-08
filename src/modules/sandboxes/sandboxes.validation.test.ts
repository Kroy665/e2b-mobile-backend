import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const app = createApp();

describe('sandboxes validation', () => {
  it('POST /api/v1/sandboxes requires auth', async () => {
    const res = await request(app).post('/api/v1/sandboxes').send({ repoUrl: 'https://github.com/foo/bar' });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/integrations/github/repos requires auth', async () => {
    const res = await request(app).get('/api/v1/integrations/github/repos');
    expect(res.status).toBe(401);
  });
});
