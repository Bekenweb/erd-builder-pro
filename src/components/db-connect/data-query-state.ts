import type { EditorView } from '@codemirror/view';

export type QueryTab = {
  key: string;
  id: number | null;
  groupName: string;
  name: string;
  script: string;
  result: { columns: string[]; rows: any[]; durationMs?: number } | null;
  resultPage: number;
  error: string | null;
};

export const emptyQueryState = { tabs: [] as QueryTab[], activeKey: '' };

const queryCaches = new Map<string, any[]>();
export const getQueryCache = (key: string) => queryCaches.get(key);
export const setQueryCache = (key: string, queries: any[]) => { queryCaches.set(key, queries); return queries; };

export const newQueryTab = (table?: string | null): QueryTab => ({ key: crypto.randomUUID(), id: null, groupName: 'Ungrouped', name: 'New SQL Query', script: `SELECT *\nFROM ${table || ''}`, result: null, resultPage: 1, error: null });

export const beautifySql = (sql: string) => sql
  .replace(/\s+/g, ' ')
  .replace(/\s*,\s*/g, ',\n  ')
  .replace(/\s+(SELECT|FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|VALUES|SET)\b/gi, '\n$1')
  .replace(/\b(SELECT|FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|VALUES|SET|AND|OR|ON|AS)\b/gi, word => word.toUpperCase())
  .trim();

// Positions of ";" that end a statement, skipping quotes and comments, so 'a; b' is not split.
// Only picks the statement at the cursor; the server still validates whatever is sent.
export const statementSeparators = (sql: string) => {
  const separators: number[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\' && ch !== '`') { i += 2; continue; }
        if (sql[i] === ch) { if (sql[i + 1] === ch) { i += 2; continue; } break; }
        i += 1;
      }
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      continue;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 1;
    } else if (ch === ';') {
      separators.push(i);
    }
    i += 1;
  }
  return separators;
};

export const sqlToRun = (sql: string, from: number, to: number) => {
  const selected = sql.slice(from, to).trim();
  if (selected) return selected;

  const separators = statementSeparators(sql);
  const lastBefore = (position: number) => [...separators].reverse().find(index => index <= position) ?? -1;
  const start = lastBefore(Math.max(0, from - 1)) + 1;
  const end = separators.find(index => index >= from) ?? -1;
  const current = sql.slice(start, end === -1 ? undefined : end).trim();
  if (current) return current;

  const previousEnd = Math.max(0, start - 1);
  const previousStart = lastBefore(Math.max(0, previousEnd - 1)) + 1;
  return sql.slice(previousStart, previousEnd).trim() || sql.trim();
};

export const runnableSql = (view: EditorView | null, fallback: string) => {
  if (!view) return fallback;
  const { from, to } = view.state.selection.main;
  return sqlToRun(view.state.doc.toString(), from, to);
};

export const reconcileLiveTab = (tab: QueryTab | null, live: QueryTab | null) =>
  tab && live?.key === tab.key ? { ...tab, script: live.script } : tab;

export const readQueryState = (storageKey: string): { tabs: QueryTab[]; activeKey: string } => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    const tabs = Array.isArray(saved.tabs) ? saved.tabs.filter((tab: any) => tab?.key).map((tab: QueryTab) => ({ ...tab, result: null, resultPage: 1, error: null })) : [];
    if (tabs.length) return { tabs, activeKey: tabs.some((tab: QueryTab) => tab.key === saved.activeKey) ? saved.activeKey : tabs[0].key };
  } catch {}
  return emptyQueryState;
};

export const sanitizeQueryState = (value: any): { tabs: QueryTab[]; activeKey: string } | null => {
  const tabs = Array.isArray(value?.tabs) ? value.tabs.filter((tab: any) => tab?.key).map((tab: QueryTab) => ({ ...tab, result: null, resultPage: tab.resultPage || 1, error: null })) : [];
  if (!tabs.length) return null;
  return { tabs, activeKey: tabs.some((tab: QueryTab) => tab.key === value.activeKey) ? value.activeKey : tabs[0].key };
};
