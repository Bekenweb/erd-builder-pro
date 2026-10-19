import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializePaneSync } from '../pane-sync';

afterEach(() => vi.unstubAllGlobals());
describe('COL-006 shared draft sync', () => {
  it('serializes two editors and the host against shared storage', async () => {
    const host = { location: { origin: 'https://app.test' } };
    const calls: string[] = [];
    let finish!: () => void;
    vi.stubGlobal('window', host);
    const first = serializePaneSync(async () => { calls.push('first'); await new Promise<void>(resolve => { finish = resolve; }); });
    const second = serializePaneSync(async () => { calls.push('second'); });
    const shell = serializePaneSync(async () => { calls.push('host'); });
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toEqual(['first']);
    finish(); await Promise.all([first, second, shell]);
    expect(calls).toEqual(['first', 'second', 'host']);
  });
  it('keeps later syncs usable after a rejected save', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
    await expect(serializePaneSync(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    const next = vi.fn().mockResolvedValue(undefined);
    await serializePaneSync(next);
    expect(next).toHaveBeenCalledOnce();
  });
});
