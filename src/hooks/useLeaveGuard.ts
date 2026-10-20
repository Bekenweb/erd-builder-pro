import { useContext, useEffect } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

type GuardedNavigator = {
  push: (to: any, ...rest: any[]) => void;
  replace: (to: any, ...rest: any[]) => void;
};
type ActiveGuard = { message: string; index: number; path: string };

const targetPath = (to: any) => typeof to === 'string'
  ? new URL(to, window.location.href).pathname
  : to?.pathname ?? window.location.pathname;
const historyIndex = () => Number(window.history.state?.idx ?? 0);
const settle = (guard: ActiveGuard) => { guard.index = historyIndex(); guard.path = window.location.pathname; };

let activeGuard: ActiveGuard | null = null;
let restoring = false;

// Registered at module load (imported from main.tsx) so it runs before BrowserRouter's own popstate
// listener; browsers fire same-target listeners in registration order, so capture alone is not enough.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', event => {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
    const guard = activeGuard;
    if (!guard) return;
    if (window.location.pathname === guard.path || window.confirm(guard.message)) { settle(guard); return; }
    event.stopImmediatePropagation();
    restoring = true;
    window.history.go(guard.index - historyIndex());
  }, true);
}

// BrowserRouter has no useBlocker, so guard the navigator, back/forward and unload directly.
// Same-path changes (search params such as the DB Client mode tab) are not leaving and stay allowed.
export function useLeaveGuard(active: boolean, message: string) {
  const { navigator } = useContext(UNSAFE_NavigationContext) as unknown as { navigator: GuardedNavigator };

  useEffect(() => {
    if (!active) return;
    const guard: ActiveGuard = { message, index: historyIndex(), path: window.location.pathname };
    const { push, replace } = navigator;
    const allow = (to: any) => targetPath(to) === window.location.pathname || window.confirm(message);
    navigator.push = (to, ...rest) => { if (allow(to)) { push(to, ...rest); settle(guard); } };
    navigator.replace = (to, ...rest) => { if (allow(to)) { replace(to, ...rest); settle(guard); } };
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };

    activeGuard = guard;
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      navigator.push = push;
      navigator.replace = replace;
      if (activeGuard === guard) activeGuard = null;
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active, message, navigator]);
}
