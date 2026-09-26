import { describe, expect, it } from 'vitest';
import { GET } from '../route';

describe('GET /api/surveys/handle/:handle', () => {
  it('returns an empty surveys list alongside the requested handle (no public handle->DID resolver exists)', async () => {
    const response = await GET(new Request('https://dykil.imajin.ai/api/surveys/handle/alice') as never, {
      params: Promise.resolve({ handle: 'alice' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ surveys: [], handle: 'alice' });
  });
});
