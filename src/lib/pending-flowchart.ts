// AI Flowchart content handed from the chat dialog to the Flowchart editor through localStorage.
export const PENDING_FLOWCHART_EVENT = 'flowchart:pending-ai-content';
export const PENDING_FLOWCHART_TARGET = 'chat_flowchart_uid';

/** Only the flowchart the user chose may consume the pending content; no target means "the next new flowchart". */
export function isPendingFlowchartTarget(flowchart: { id?: unknown; uid?: unknown } | null | undefined, target: string | null) {
  if (!flowchart) return false;
  return !target || target === String(flowchart.uid) || target === String(flowchart.id);
}
