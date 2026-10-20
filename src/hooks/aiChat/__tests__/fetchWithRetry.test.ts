import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isGatewayError } from '../fetchWithRetry';

const reply = (status: number) => ({ ok: status < 400, status }) as Response;

describe('fetchWithRetry', () => {
  it('retries a tunnel gateway error and returns the later success', async () => {
    const send = vi.fn().mockResolvedValueOnce(reply(502)).mockResolvedValueOnce(reply(200));
    expect((await fetchWithRetry(send, isGatewayError, [0, 0])).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('retries network errors but rethrows once attempts run out', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchWithRetry(send, isGatewayError, [0])).rejects.toThrow('Failed to fetch');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('returns non-retryable failures and the final retryable failure unchanged', async () => {
    const forbidden = vi.fn().mockResolvedValue(reply(403));
    expect((await fetchWithRetry(forbidden, isGatewayError, [0, 0])).status).toBe(403);
    expect(forbidden).toHaveBeenCalledTimes(1);
    const missing = vi.fn().mockResolvedValue(reply(404));
    expect((await fetchWithRetry(missing, status => status === 404, [0, 0])).status).toBe(404);
    expect(missing).toHaveBeenCalledTimes(3);
  });
});
