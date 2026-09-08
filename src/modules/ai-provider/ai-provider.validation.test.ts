import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

const app = createApp();

describe('ai-provider validation', () => {
  it('PUT /api/v1/integrations/ai-provider requires auth', async () => {
    const res = await request(app)
      .put('/api/v1/integrations/ai-provider')
      .send({ provider: 'anthropic', apiKey: 'sk-ant-test' });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/integrations/ai-provider requires auth', async () => {
    const res = await request(app).get('/api/v1/integrations/ai-provider');
    expect(res.status).toBe(401);
  });
});
