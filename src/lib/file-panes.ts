export type PaneFile = { type: 'notes' | 'erd' | 'flowchart' | 'drawings'; uid: string; title: string; projectId: string; previewSchema?: string };
export const PANE_REQUEST = 'workspace:open-file-pane';
export const PANE_FLUSH_CHILDREN = 'workspace:flush-child-panes';
export const NOTE_PANE_SNAPSHOT = 'workspace:note-editor-snapshot';
export const paneKey = (file: PaneFile) => `${file.type}:${file.uid}`;
export function paneRequest(files: PaneFile[], current: PaneFile, next: PaneFile) {
  if (next.projectId !== current.projectId) return 'reject';
  if (files.some(file => paneKey(file) === paneKey(next)) || (!files.length && paneKey(current) === paneKey(next))) return 'focus';
  return files.length >= 2 ? 'replace' : 'open';
}

export function paneUrl(file: PaneFile) {
  const route = { notes: 'notes', erd: 'diagrams', flowchart: 'flowcharts', drawings: 'drawings' }[file.type];
  return `/${route}/${encodeURIComponent(file.uid)}?${new URLSearchParams({ pid: file.projectId })}`;
}

export function validPaneFile(value: unknown): value is PaneFile {
  const file = value as PaneFile | null;
  return !!file && ['notes', 'erd', 'flowchart', 'drawings'].includes(file.type)
    && [file.uid, file.title, file.projectId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 512)
    && (file.previewSchema === undefined || (file.type === 'erd' && typeof file.previewSchema === 'string' && file.previewSchema.length <= 1_000_000));
}

export function requestFilePane(file: PaneFile) {
  window.dispatchEvent(new CustomEvent(PANE_REQUEST, { detail: { file } }));
}

export async function flushChildPanes() {
  if (typeof window === 'undefined') return false;
  const jobs: Promise<void>[] = [];
  window.dispatchEvent(new CustomEvent(PANE_FLUSH_CHILDREN, { detail: jobs }));
  await Promise.all(jobs);
  return jobs.length > 0;
}

export async function flushWorkspaceEditors(saveCurrent: () => Promise<void>) {
  if (!await flushChildPanes()) await saveCurrent();
}

export function assertNoCommentDraft(container: ParentNode = document) {
  if ([...container.querySelectorAll<HTMLTextAreaElement>('[data-comment-draft]')].some(el => el.value.trim())) {
    throw new Error('Send or clear your comment draft before closing this file.');
  }
}
