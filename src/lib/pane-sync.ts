type SyncHost = Window & { erdbproDraftSync?: Promise<void> };

export function serializePaneSync(sync: () => Promise<void>): Promise<void> {
  if (typeof window === 'undefined') return sync();
  const host = window as SyncHost;
  const queued = (host.erdbproDraftSync ?? Promise.resolve()).catch(() => {}).then(sync);
  host.erdbproDraftSync = queued.then(() => {}, () => {});
  return queued;
}
