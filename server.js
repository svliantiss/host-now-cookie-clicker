'use strict';

// Cookie clicker: one counter row in Postgres, served by Express on port 3000.
// Everything the process needs comes from DATABASE_URL. If the database cannot be
// reached at boot we log loudly and exit non-zero instead of serving a broken page.

const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const BOOT_ATTEMPTS = Number(process.env.DB_BOOT_ATTEMPTS || 15);
const BOOT_DELAY_MS = Number(process.env.DB_BOOT_DELAY_MS || 2000);

function fail(message, err) {
  console.error(`[cookie-clicker] FATAL: ${message}`);
  if (err) console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}

if (!DATABASE_URL) {
  fail('DATABASE_URL is not set; refusing to start without a database');
}

let DB_HOST;
try {
  DB_HOST = new URL(DATABASE_URL).hostname;
} catch (err) {
  fail('DATABASE_URL is not a parseable URL', err);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error(`[cookie-clicker] idle client error: ${err.message}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readClicks() {
  const res = await pool.query('SELECT clicks FROM clicks WHERE id = 1');
  if (res.rows.length === 0) return 0;
  // bigint comes back as a string from pg; keep exactness, expose a number when safe.
  return Number(res.rows[0].clicks);
}

async function boot() {
  let lastErr;
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      console.log(`[cookie-clicker] connected to postgres at ${DB_HOST}`);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      console.error(
        `[cookie-clicker] database unreachable (attempt ${attempt}/${BOOT_ATTEMPTS}) host=${DB_HOST}: ${err.message}`,
      );
      if (attempt === BOOT_ATTEMPTS) {
        fail(`could not reach the database at ${DB_HOST} after ${BOOT_ATTEMPTS} attempts`, err);
      }
      await sleep(BOOT_DELAY_MS);
    }
  }
  if (lastErr) fail(`could not reach the database at ${DB_HOST}`, lastErr);

  await pool.query(
    'CREATE TABLE IF NOT EXISTS clicks (id integer PRIMARY KEY, clicks bigint NOT NULL DEFAULT 0)',
  );
  await pool.query('INSERT INTO clicks (id, clicks) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
  console.log('[cookie-clicker] schema ready (table: clicks, row id=1)');
}

function page(clicks) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cookie Clicker</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; gap: 1.25rem;
         background: #14110f; color: #f6ead8;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.15rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
       opacity: .65; margin: 0; }
  button#cookie { width: 15rem; height: 15rem; border-radius: 50%; border: 0; cursor: pointer;
       background: radial-gradient(circle at 34% 30%, #e8b273, #b06f2c 58%, #6f3d12 100%);
       box-shadow: inset 0 -14px 28px rgba(0,0,0,.45), 0 18px 40px rgba(0,0,0,.55);
       transition: transform .07s ease; }
  button#cookie:active { transform: scale(.94); }
  .bite { position: relative; font-size: 0; }
  #count { font-size: 3rem; font-variant-numeric: tabular-nums; font-weight: 700; }
  #get { color: #cbb89c; font-size: .9rem; }
  footer { font-size: .78rem; color: #9a8b79; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  code { color: #e8b273; }
</style>
</head>
<body>
  <h1>Cookie Clicker</h1>
  <button id="cookie" type="button" aria-label="Click the cookie">
    <span class="bite">🍪</span>
  </button>
  <div id="count" data-clicks="${clicks}">${clicks}</div>
  <div id="get">clicks stored in postgres</div>
  <footer>database host: <code id="db">${DB_HOST}</code></footer>
<script>
  const countEl = document.getElementById('count');
  const cookieEl = document.getElementById('cookie');
  cookieEl.addEventListener('click', async () => {
    cookieEl.disabled = true;
    try {
      const res = await fetch('/click', { method: 'POST' });
      const body = await res.json();
      if (typeof body.clicks === 'number') {
        countEl.textContent = body.clicks;
        countEl.dataset.clicks = String(body.clicks);
      }
    } catch (err) {
      console.error('click failed', err);
    } finally {
      cookieEl.disabled = false;
    }
  });
</script>
</body>
</html>`;
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', async (_req, res) => {
  try {
    const clicks = await readClicks();
    res.status(200).json({ ok: true, clicks, db: DB_HOST });
  } catch (err) {
    console.error(`[cookie-clicker] healthz failed: ${err.message}`);
    res.status(500).json({ ok: false, db: DB_HOST, error: err.message });
  }
});

app.post('/click', async (_req, res) => {
  try {
    const row = await pool.query(
      'UPDATE clicks SET clicks = clicks + 1 WHERE id = 1 RETURNING clicks',
    );
    res.status(200).json({ ok: true, clicks: Number(row.rows[0].clicks), db: DB_HOST });
  } catch (err) {
    console.error(`[cookie-clicker] click failed: ${err.message}`);
    res.status(500).json({ ok: false, db: DB_HOST, error: err.message });
  }
});

app.get('/', async (_req, res) => {
  try {
    const clicks = await readClicks();
    res.status(200).type('html').send(page(clicks));
  } catch (err) {
    console.error(`[cookie-clicker] page failed: ${err.message}`);
    res.status(500).send('database error');
  }
});

async function main() {
  await boot();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[cookie-clicker] listening on 0.0.0.0:${PORT} (db host ${DB_HOST})`);
  });
  const shutdown = (signal) => {
    console.log(`[cookie-clicker] ${signal} received, closing`);
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => fail('startup failed', err));
