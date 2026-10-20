import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Workspace file lists are paged per table view, so a dialog opened from another view can see none of the
// target project's files. Fetch that project's files directly; fall back to the workspace list without a project.
// shortcut: only the latest 100 files of the project are listed; add search if projects grow past that.
export function useProjectFiles(kind: 'notes' | 'diagrams' | 'flowcharts', projectId: string | number | null | undefined, fallback: any[]) {
  const [files, setFiles] = useState<any[] | null>(null);
  useEffect(() => {
    setFiles(null);
    if (projectId == null || projectId === 'none') return;
    let cancelled = false;
    apiFetch(`/api/${kind}?project_id=${encodeURIComponent(String(projectId))}&limit=100`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && Array.isArray(body?.data)) setFiles(body.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [kind, projectId]);
  return files ?? fallback;
}
