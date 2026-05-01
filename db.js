import { createClient } from '@libsql/client';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('[db] TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required');
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function rowToObj(row, columns) {
  const obj = {};
  for (let i = 0; i < columns.length; i++) {
    const val = row[i];
    obj[columns[i]] = typeof val === 'bigint' ? Number(val) : val;
  }
  return obj;
}

export async function dbGet(sql, args = []) {
  const rs = await client.execute({ sql, args });
  if (!rs.rows[0]) return undefined;
  return rowToObj(rs.rows[0], rs.columns);
}

export async function dbAll(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows.map(r => rowToObj(r, rs.columns));
}

export async function dbRun(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return {
    lastInsertRowid: rs.lastInsertRowid !== undefined ? Number(rs.lastInsertRowid) : undefined,
    changes: rs.rowsAffected,
  };
}

export async function dbBatch(statements) {
  return client.batch(
    statements.map(s =>
      typeof s === 'string'
        ? { sql: s, args: [] }
        : { sql: s.sql, args: s.args || [] }
    ),
    'write'
  );
}

export { client };
