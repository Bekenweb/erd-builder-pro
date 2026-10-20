import { describe, expect, it } from 'vitest';
import { createColumnHelpers, draftValue, quoteTableName, submitValue } from './data-viewer-utils';

const helpers = createColumnHelpers(new Map<string, any>([
  ['id', { type: 'bigint' }],
  ['amount', { type: 'decimal' }],
  ['ratio', { type: 'double precision' }],
  ['flag', { type: 'tinyint', full_type: 'tinyint(1)' }],
]));

describe('submitValue numeric precision', () => {
  it('keeps BIGINT and DECIMAL text exact through draft and submit', () => {
    expect(submitValue('id', draftValue('id', '9007199254740993', helpers), helpers)).toBe('9007199254740993');
    expect(submitValue('amount', draftValue('amount', '1234567890123456.78', helpers), helpers)).toBe('1234567890123456.78');
    expect(submitValue('id', ' 42 ', helpers)).toBe('42');
  });

  it('keeps floats numeric and preserves empty, NULL and boolean handling', () => {
    expect(submitValue('ratio', '0.5', helpers)).toBe(0.5);
    expect(submitValue('id', '', helpers)).toBe('');
    expect(submitValue('flag', '1', helpers)).toBe(1);
    expect(submitValue('flag', '', helpers)).toBeNull();
  });
});

describe('quoteTableName', () => {
  it('quotes schema and name separately only for schema-qualified keys', () => {
    expect(quoteTableName('postgresql', { table_name: 'tenant.users', table_schema: 'tenant', base_name: 'users' })).toBe('"tenant"."users"');
    expect(quoteTableName('postgresql', { table_name: 'users', table_schema: 'public', base_name: 'users' })).toBe('"users"');
    expect(quoteTableName('mysql', { table_name: 'users', table_schema: 'app' })).toBe('`users`');
  });
});
