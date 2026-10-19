import { useRef, useState } from 'react';

type Handlers = Record<string, (...args: any[]) => any>;

/**
 * Returns the same handlers with a fixed identity; each wrapper calls the latest version.
 * Handlers that close over canvas state otherwise change the workspace context value on every drag frame.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [stable] = useState(() => Object.fromEntries(
    Object.keys(handlers).map(key => [key, (...args: any[]) => latest.current[key](...args)]),
  ) as T);
  return stable;
}
