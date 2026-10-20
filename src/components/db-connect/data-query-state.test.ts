import { describe, expect, it } from 'vitest';
import { reconcileLiveTab, sqlToRun, type QueryTab } from './data-query-state';

describe('sqlToRun', () => {
  it('prefers a selection and otherwise resolves the statement at the cursor', () => {
    const sql = 'SELECT 1;\nSELECT * FROM users;';
    expect(sqlToRun(sql, 5, 5)).toBe('SELECT 1');
    expect(sqlToRun(sql, 20, 20)).toBe('SELECT * FROM users');
    expect(sqlToRun(sql, 0, 8)).toBe('SELECT 1');
    expect(sqlToRun(sql, sql.length, sql.length)).toBe('SELECT * FROM users');
  });

  it('does not split on semicolons inside literals or comments', () => {
    const sql = "SELECT 'a; b' AS x -- c;\nFROM t;\nSELECT /* ; */ 2;";
    expect(sqlToRun(sql, 3, 3)).toBe("SELECT 'a; b' AS x -- c;\nFROM t");
    expect(sqlToRun(sql, sql.length - 3, sql.length - 3)).toBe('SELECT /* ; */ 2');
    expect(sqlToRun("SELECT pg_sleep(4), 'update; drop' AS note", 10, 10)).toBe("SELECT pg_sleep(4), 'update; drop' AS note");
  });

  it('keeps the live script during delayed tab-state updates', () => {
    const tab = (key: string, script: string) => ({ key, script, id: null, groupName: '', name: '', result: null, resultPage: 1, error: null } as QueryTab);
    expect(reconcileLiveTab(tab('a', 'SELECT j'), tab('a', 'SELECT jurusans'))?.script).toBe('SELECT jurusans');
    expect(reconcileLiveTab(tab('b', 'SELECT baru'), tab('a', 'SELECT lama'))?.script).toBe('SELECT baru');
  });
});
