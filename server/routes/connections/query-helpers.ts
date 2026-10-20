// Blanks literals with "~" (keeps \b keyword boundaries and survives end trimming) and comments with spaces,
// both at the same length, so keyword and ";" checks only see SQL code.
// Returns null when quoting is ambiguous across MySQL/PostgreSQL (backslash in a literal, unterminated quote or
// comment, MySQL /*! executable comment); callers then fall back to checking the raw text, which is never looser.
// "#" comments and $$ dollar quotes are left visible on purpose: their meaning differs between the two dialects.
export function maskSqlLiterals(sql: string): string | null {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-" && /[\s]/.test(sql[i + 2] ?? " ")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      if (sql[i + 2] === "!") return null;
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return null;
      out += " ".repeat(end + 2 - i);
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\") return null;
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      if (j >= sql.length) return null;
      out += "~".repeat(j + 1 - i);
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function normalizeSelectQuery(script: string): string {
  const raw = String(script || "");
  const code = maskSqlLiterals(raw) ?? raw;
  // Trim using the masked text so a ";" inside a trailing comment or literal is never mistaken for the terminator.
  const start = code.length - code.trimStart().length;
  const end = code.replace(/[\s;]+$/, "").length;
  const sql = raw.slice(start, end).trim();
  const body = code.slice(start, end);
  if (!sql) throw new Error("SQL query is required");
  if (!/^(select|with)\b/i.test(body.trim())) throw new Error("Only SELECT queries are allowed");
  if (body.includes(";")) throw new Error("Only one SQL statement is allowed");
  if (/\b(insert|update|delete|alter|drop|create|truncate|merge|grant|revoke|call|execute)\b/i.test(body)) {
    throw new Error("Only read-only SQL queries are allowed");
  }
  return sql;
}

export function buildLimitedSelectQuery(script: string, requestedRows: unknown) {
  const sql = normalizeSelectQuery(script);
  const maxRows = Math.min(Math.max(Math.trunc(Number(requestedRows) || 100), 1), 500);
  return { sql: `SELECT * FROM (${sql}) AS erdbpro_limited_query LIMIT ${maxRows + 1}`, maxRows };
}

export function buildExplainQuery(script: string) {
  return `EXPLAIN ${normalizeSelectQuery(script)}`;
}
