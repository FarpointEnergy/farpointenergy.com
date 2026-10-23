import pg from 'pg';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
try {
  if (process.argv[2] === 'before') {
    await pool.query('CREATE TABLE IF NOT EXISTS ci_restart_sentinel(id integer PRIMARY KEY,value text NOT NULL)');
    await pool.query("INSERT INTO ci_restart_sentinel VALUES(1,'committed before restart') ON CONFLICT(id) DO UPDATE SET value=excluded.value");
  } else if (process.argv[2] === 'after') {
    let result;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { result = await pool.query('SELECT value FROM ci_restart_sentinel WHERE id=1'); break; }
      catch { if (attempt === 29) throw new Error('PostgreSQL did not recover'); await setTimeout(1000); }
    }
    assert.equal(result.rows[0]?.value, 'committed before restart');
    await pool.query('DROP TABLE ci_restart_sentinel');
    process.stdout.write('Native PostgreSQL committed data survived restart.\n');
  } else throw new Error('Expected before or after');
} finally { await pool.end(); }
