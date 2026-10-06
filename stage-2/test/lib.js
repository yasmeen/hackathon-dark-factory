// Shared test helpers: start N server processes on one scratch database and
// talk to them over HTTP, exactly as real clients would.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let nextPort = 4100 + Math.floor(Math.random() * 400) * 4;

async function startServers({ dir = path.join(__dirname, '..'), count = 1, env = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tablekeeper-test-'));
  const DB_PATH = path.join(tmp, 'test.db');
  const procs = [], bases = [];
  for (let i = 0; i < count; i++) {
    const port = nextPort++;
    procs.push(spawn(process.execPath, ['server.js'], {
      cwd: dir, env: { ...process.env, ...env, DB_PATH, PORT: String(port) }, stdio: 'ignore',
    }));
    bases.push(`http://127.0.0.1:${port}`);
    // The first process creates and seeds the schema; let it finish before
    // the others open the same file.
    if (i === 0) await waitReady(bases[0]);
  }
  await Promise.all(bases.map(waitReady));
  const stop = () => {
    procs.forEach(p => { try { p.kill('SIGKILL'); } catch {} });
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  process.on('exit', stop);
  return { bases, base: bases[0], stop };
}

async function waitReady(base) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`server at ${base} never became ready`);
}

const call = (base, method, url, body) => fetch(base + url, {
  method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
}).then(async r => ({ status: r.status, headers: r.headers, json: await r.json().catch(() => null) }));

// 50 parallel bookings for the single table that fits, spread across all
// server processes. Returns the status codes.
async function race(bases, slot, n = 50) {
  const results = await Promise.all(Array.from({ length: n }, (_, i) =>
    call(bases[i % bases.length], 'POST', '/api/reservations',
      { ...slot, name: `Racer ${i}`, phone: `+1555000${String(i).padStart(4, '0')}`, idempotency_key: `race-${i}` })));
  return results.map(r => r.status);
}

// A future date (in UTC terms) that is safely bookable for the whole day.
function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

function checker() {
  let pass = 0, fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
  };
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    return fail;
  };
  return { check, done };
}

module.exports = { startServers, call, race, futureDate, checker };
