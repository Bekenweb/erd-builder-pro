import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The repo has no DOM test environment, so this drives the guard against a small in-memory browser:
// a history stack whose go() fires an async popstate, like the real one.
class FakeWindow extends EventTarget {
  entries = ['/db-client/a'];
  idx = 0;
  confirm = vi.fn(() => false);
  get location() {
    const path = this.entries[this.idx];
    return { pathname: path, href: `http://localhost${path}` };
  }
  get history() {
    return { state: { idx: this.idx }, go: (delta: number) => { this.idx += delta; queueMicrotask(() => this.dispatchEvent(new Event('popstate'))); } };
  }
  push(path: string) { this.entries.splice(this.idx + 1); this.entries.push(path); this.idx += 1; }
}

let fake: FakeWindow;
let attachLeaveGuard: typeof import('./useLeaveGuard').attachLeaveGuard;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeAll(async () => {
  fake = new FakeWindow();
  (globalThis as any).window = fake;
  ({ attachLeaveGuard } = await import('./useLeaveGuard'));
});
afterEach(() => { fake.entries = ['/db-client/a']; fake.idx = 0; fake.confirm.mockReset(); fake.confirm.mockReturnValue(false); });

function setup() {
  const pushSpy = vi.fn((to: string) => fake.push(to.split('?')[0]));
  const navigator = { push: pushSpy, replace: vi.fn() };
  const router = vi.fn(); // stands in for BrowserRouter's own popstate listener, registered after the guard
  fake.addEventListener('popstate', router);
  fake.push('/db-client/b');
  const detach = attachLeaveGuard(navigator as any, 'unsaved');
  return { navigator, pushSpy, router, detach: () => { detach(); fake.removeEventListener('popstate', router); } };
}

describe('attachLeaveGuard', () => {
  it('cancelling back/forward keeps the page and never reaches the router', async () => {
    const { router, detach } = setup();
    fake.history.go(-1);
    await flush(); await flush();
    expect(fake.confirm).toHaveBeenCalledTimes(1);
    expect(router).not.toHaveBeenCalled();
    expect(fake.location.pathname).toBe('/db-client/b');
    detach();
  });

  it('confirming back lets the router navigate and releases the page state', async () => {
    const { router, detach } = setup();
    fake.confirm.mockReturnValue(true);
    fake.history.go(-1);
    await flush();
    expect(router).toHaveBeenCalledTimes(1);
    expect(fake.location.pathname).toBe('/db-client/a');
    detach();
  });

  it('asks before leaving through the navigator but not for same-path search changes', () => {
    const { navigator, pushSpy, detach } = setup();
    try {
      navigator.push('/db-client/b?tab=query');
      expect(fake.confirm).not.toHaveBeenCalled();
      expect(pushSpy).toHaveBeenCalledTimes(1);
      navigator.push('/dashboard');
      expect(fake.confirm).toHaveBeenCalledTimes(1);
      expect(fake.location.pathname).toBe('/db-client/b');
      fake.confirm.mockReturnValue(true);
      navigator.push('/dashboard');
      expect(fake.location.pathname).toBe('/dashboard');
    } finally {
      detach();
    }
  });

  it('blocks reload/close while attached and stops once detached', () => {
    const { detach } = setup();
    const during = new Event('beforeunload', { cancelable: true });
    fake.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    detach();
    const after = new Event('beforeunload', { cancelable: true });
    fake.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('does nothing once detached', async () => {
    const { router, detach } = setup();
    detach();
    fake.history.go(-1);
    await flush();
    expect(fake.confirm).not.toHaveBeenCalled();
  });
});
