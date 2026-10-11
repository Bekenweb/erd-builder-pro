import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCommentMarkers, type CommentFileRef, type CommentMarker } from '@/lib/fileComments';

/** Markers of one file, refreshed on local edits, Team live sync, reconnects, and every 15 s while the tab is visible. */
export function useCommentMarkers(file: CommentFileRef | null) {
  const [markers, setMarkers] = useState<CommentMarker[]>([]);
  const requestId = useRef(0);
  const key = file ? `${file.projectId}|${file.teamId}|${file.featureType}|${file.fileId}` : '';

  const refresh = useCallback(async () => {
    if (!file) return;
    const current = ++requestId.current;
    try {
      const next = await fetchCommentMarkers(file);
      if (current === requestId.current) setMarkers(next);
    } catch {
      // Markers are a convenience; a failed request must not block reading or editing.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setMarkers([]);
    if (!file) return;
    void refresh();
    const matches = (detail?: { teamId?: string; projectId?: string }) =>
      (!detail?.teamId || detail.teamId === file.teamId) && (!detail?.projectId || String(detail.projectId) === file.projectId);
    const onUpdate = (event: Event) => { if (matches((event as CustomEvent).detail)) void refresh(); };
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ teamId?: string; eventType?: string }>).detail;
      if (detail?.eventType === 'cloud.workspace.sync' && matches(detail)) void refresh();
    };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    window.addEventListener('collaboration-updated', onUpdate);
    window.addEventListener('cloud-workspace-sync', onSync);
    window.addEventListener('cloud-live-sync-reconnected', onUpdate);
    return () => {
      requestId.current++;
      window.clearInterval(interval);
      window.removeEventListener('collaboration-updated', onUpdate);
      window.removeEventListener('cloud-workspace-sync', onSync);
      window.removeEventListener('cloud-live-sync-reconnected', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);

  return { markers, refresh };
}
