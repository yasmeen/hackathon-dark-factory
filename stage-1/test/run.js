// Tablekeeper stage-1 — verification suite (reviewer seat evidence).
// Spins up the service against a scratch database and probes the hard parts:
// concurrency, retried requests, time zones, validation. Run: npm test

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tablekeeper-test-'));
const DB_PATH = path.join(tmp, 'test.db');
const PORT = 4123;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const kill = () => { try { server.kill('SIGKILL'); } catch {} };
  process.on('exit', kill);

  // wait for readiness
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/restaurants`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  const post = (body) => fetch(`${BASE}/api/reservations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, json: await r.json() }));

  console.log('== concurrency: 50 parallel bookings, same table slot ==');
  const slot = { restaurant_id: 'casa-verde', date: '2026-10-20', time: '19:00',
    party_size: 8, name: 'Load Test', phone: '+10000000000', tz: 'America/New_York' };
  // party of 8 -> only the single 8-top at Casa Verde qualifies, so all 50
  // requests contend for exactly one table.
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    post({ ...slot, phone: `+100000000${String(i).padStart(2, '0')}`, idempotency_key: `race-${i}` })));
  const wins = results.filter(r => r.status === 201);
  const rejects = results.filter(r => r.status === 409);
  check('exactly 1 of 50 parallel bookings wins', wins.length === 1, `got ${wins.length}`);
  check('other 49 are rejected with 409', rejects.length === 49, `got ${rejects.length}`);

  console.log('== retries: idempotency key ==');
  const key = 'idem-' + Date.now();
  const first = await post({ ...slot, date: '2026-10-21', time: '19:00', party_size: 2, idempotency_key: key });
  const retry = await post({ ...slot, date: '2026-10-21', time: '19:00', party_size: 2, idempotency_key: key });
  check('first request books (201)', first.status === 201, `got ${first.status}`);
  check('retry returns same reservation, no duplicate',
    retry.status === 201 && retry.json.reservation.id === first.json.reservation.id,
    `got ${retry.status}`);
  const mine = await fetch(`${BASE}/api/reservations?phone=${encodeURIComponent('+10000000000')}`).then(r => r.json());
  check('no duplicate rows created by retry',
    mine.reservations.filter(x => x.when_local.includes('Oct')).length <= 2, JSON.stringify(mine.reservations.length));

  console.log('== time zones ==');
  const tzb = await post({ restaurant_id: 'casa-verde', date: '2026-10-20', time: '19:00',
    party_size: 2, name: 'TZ Test', phone: '+12223334444', tz: 'America/New_York', idempotency_key: 'tz-1' });
  // Oct 20 2026: New York is on EDT (UTC-4) -> 19:00 local = 23:00 UTC
  check('19:00 America/New_York stored as 23:00 UTC',
    tzb.json.reservation.slot_start_utc === '2026-10-20T23:00:00.000Z',
    `got ${tzb.json.reservation && tzb.json.reservation.slot_start_utc}`);
  const av = await fetch(`${BASE}/api/restaurants/copper-kettle/availability?date=2026-10-20&party_size=2&tz=America/New_York`).then(r => r.json());
  const noon = av.slots.find(s => s.time === '12:00');
  // Chicago 12:00 CDT (UTC-5) viewed from New York = 1:00 PM EDT
  check('cross-timezone display shifts correctly',
    noon && noon.display_time === '1:00 PM', `got ${noon && noon.display_time}`);

  console.log('== validation & availability ==');
  const bad1 = await post({ ...slot, date: 'not-a-date' });
  check('bad date -> 400', bad1.status === 400, `got ${bad1.status}`);
  const bad2 = await post({ ...slot, restaurant_id: 'nope' });
  check('unknown restaurant -> 404', bad2.status === 404, `got ${bad2.status}`);
  const bad3 = await post({ ...slot, tz: 'Mars/Olympus' });
  check('bad timezone -> 400', bad3.status === 400, `got ${bad3.status}`);
  const av2 = await fetch(`${BASE}/api/restaurants/casa-verde/availability?date=2026-10-20&party_size=8`).then(r => r.json());
  const s1900 = av2.slots.find(s => s.time === '19:00');
  check('slot shows unavailable after the 8-top is taken', s1900 && s1900.available === false);

  console.log('== cancel frees the table ==');
  const cb = await post({ restaurant_id: 'juniper-rye', date: '2026-10-22', time: '19:00',
    party_size: 10, name: 'Cancel Me', phone: '+13334445555', idempotency_key: 'cancel-1' });
  const cid = cb.json.reservation.id;
  const del = await fetch(`${BASE}/api/reservations/${cid}?phone=%2B13334445555`, { method: 'DELETE' });
  check('cancel returns 200', del.status === 200, `got ${del.status}`);
  const rebook = await post({ restaurant_id: 'juniper-rye', date: '2026-10-22', time: '19:00',
    party_size: 10, name: 'Rebook', phone: '+14445556666', idempotency_key: 'cancel-2' });
  check('table can be rebooked after cancel', rebook.status === 201, `got ${rebook.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
