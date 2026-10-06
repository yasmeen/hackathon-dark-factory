// Tablekeeper — verification suite (reviewer seat evidence).
// Starts the real service (4 processes sharing one scratch database) and
// probes the hard parts: concurrency, retried requests, off-grid and
// cross-timezone overlaps, DST, validation, cancel. Run: npm test
//
// TK_RACE_WINDOW_MS holds the check→insert gap open so the race test can
// actually fail; test/mutation.js proves it does when protections are removed.

const { startServers, call, race, futureDate, checker } = require('./lib');

// A bookable date in a given month (3–360 days ahead, inside the booking
// horizon), so the suite keeps working on any day of the year.
function next(mm) {
  const y = new Date().getUTCFullYear();
  for (const year of [y, y + 1]) for (let day = 10; day <= 20; day++) {
    const d = `${year}-${mm}-${String(day).padStart(2, '0')}`;
    const ahead = Date.parse(d) - Date.now();
    if (ahead > 3 * 86400000 && ahead < 360 * 86400000) return d;
  }
  throw new Error(`no bookable date in month ${mm}`);
}
const dayAfter = d => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);

async function main() {
  const { bases, base, stop } = await startServers({ count: 4, env: { TK_RACE_WINDOW_MS: '40' } });
  const { check, done } = checker();
  const post = body => call(base, 'POST', '/api/reservations', body);
  const D = futureDate(30);
  const guest = { name: 'Test Guest', phone: '+15550001111' };

  console.log('== concurrency: 50 parallel bookings for one table, across 4 processes ==');
  // Party of 8 -> only Casa Verde's single 8-top qualifies.
  const slot = { restaurant_id: 'casa-verde', date: D, time: '19:00', party_size: 8 };
  const codes = await race(bases, slot);
  check('exactly 1 of 50 parallel bookings wins', codes.filter(c => c === 201).length === 1,
    `got ${codes.filter(c => c === 201).length}`);
  check('other 49 are rejected with 409', codes.filter(c => c === 409).length === 49,
    `codes: ${[...new Set(codes)]}`);
  const avFull = await call(base, 'GET', `/api/restaurants/casa-verde/availability?date=${D}&party_size=8`);
  const s1900 = avFull.json.slots.find(s => s.time === '19:00');
  check('slot shows full for that party afterwards', s1900 && s1900.status === 'full' && !s1900.available);

  console.log('== no overlap through the side door ==');
  const off = await post({ ...slot, time: '19:15', ...guest });
  check('off-grid start (19:15) is rejected, so it cannot overlap 19:00', off.status === 400 && off.json.code === 'INVALID_SLOT',
    `got ${off.status}`);
  const closed = await post({ ...slot, time: '03:00', ...guest });
  check('start outside opening hours is rejected', closed.status === 400, `got ${closed.status}`);
  const lastSlot = await post({ ...slot, time: '22:00', ...guest });
  check('closing time itself is not a slot start', lastSlot.status === 400, `got ${lastSlot.status}`);
  const otherTz = await post({ ...slot, tz: 'America/Los_Angeles', ...guest });
  check('client tz does not move the booking: same 8-top slot from LA -> 409', otherTz.status === 409,
    `got ${otherTz.status}`);

  console.log('== retries: idempotency key ==');
  const key = 'idem-' + Date.now();
  const req = { restaurant_id: 'casa-verde', date: D, time: '18:00', party_size: 2, ...guest, idempotency_key: key };
  const first = await post(req);
  const retry = await post(req);
  check('first request books (201)', first.status === 201, `got ${first.status}`);
  check('retry returns the same reservation and is marked as a replay',
    retry.status === 201 && retry.json.reservation.id === first.json.reservation.id &&
    retry.headers.get('idempotent-replay') === 'true', `got ${retry.status}`);
  const reused = await post({ ...req, time: '18:30' });
  check('same key with a different request -> 422, nothing booked', reused.status === 422, `got ${reused.status}`);
  const k2 = 'idem-par-' + Date.now();
  const dup = await Promise.all(bases.flatMap(b => [0, 1, 2].map(() =>
    call(b, 'POST', '/api/reservations', { ...req, time: '20:00', idempotency_key: k2 }))));
  const ids = new Set(dup.map(d => d.json && d.json.reservation && d.json.reservation.id));
  check('12 simultaneous retries of one request across processes -> one reservation',
    dup.every(d => d.status === 201) && ids.size === 1, `statuses ${dup.map(d => d.status)} ids ${ids.size}`);
  const mine = await call(base, 'GET', `/api/reservations?phone=${encodeURIComponent(guest.phone)}`);
  check('guest has exactly the 2 bookings made (18:00, 20:00), no duplicates',
    mine.json.reservations.length === 2, `got ${mine.json.reservations.length}`);

  console.log('== time zones & DST ==');
  const JUL = next('07'), JUL2 = dayAfter(JUL), JAN = next('01');
  const tzb = await post({ restaurant_id: 'casa-verde', date: JUL, time: '19:00', party_size: 2, ...guest });
  check('19:00 America/New_York in July stored as 23:00 UTC (EDT)',
    tzb.json && tzb.json.reservation.slot_start_utc === `${JUL}T23:00:00.000Z`,
    `got ${tzb.json && tzb.json.reservation && tzb.json.reservation.slot_start_utc}`);
  const win = await post({ restaurant_id: 'casa-verde', date: JAN, time: '19:00', party_size: 2, ...guest });
  check('19:00 America/New_York in January stored as 00:00 UTC next day (EST)',
    win.json && win.json.reservation.slot_start_utc === `${dayAfter(JAN)}T00:00:00.000Z`,
    `got ${win.json && win.json.reservation && win.json.reservation.slot_start_utc}`);
  const shown = await post({ restaurant_id: 'casa-verde', date: JUL2, time: '19:00', party_size: 2,
    tz: 'America/Los_Angeles', ...guest });
  check('client tz only changes display: NY 19:00 shown as 4:00 PM PDT',
    shown.json && shown.json.reservation.slot_start_utc === `${JUL2}T23:00:00.000Z` &&
    /4:00\s?PM PDT/.test(shown.json.reservation.when_local), JSON.stringify(shown.json));
  const av = await call(base, 'GET', `/api/restaurants/copper-kettle/availability?date=${JUL}&party_size=2&tz=America/New_York`);
  const noon = av.json.slots.find(s => s.time === '12:00');
  check('Chicago 12:00 viewed from New York shows 1:00 PM', noon && noon.display_time === '1:00 PM',
    `got ${noon && noon.display_time}`);
  for (const [day, firstUtc, label] of [['2027-11-07', '2027-11-07T16:30:00.000Z', 'fall-back'],
                                        ['2027-03-14', '2027-03-14T15:30:00.000Z', 'spring-forward']]) {
    const a = await call(base, 'GET', `/api/restaurants/casa-verde/availability?date=${day}&party_size=2`);
    const utcs = a.json.slots.map(s => Date.parse(s.utc));
    const evenly = utcs.every((u, i) => i === 0 || u - utcs[i - 1] === 30 * 60000);
    check(`DST ${label} day: 21 slots, each exactly once, 30 min apart, first at 11:30 local`,
      utcs.length === 21 && new Set(utcs).size === 21 && evenly && a.json.slots[0].utc === firstUtc,
      `n=${utcs.length} first=${a.json.slots[0] && a.json.slots[0].utc}`);
  }

  console.log('== validation ==');
  const v = async (name, body, want) => {
    const r = await post(body);
    check(name, r.status === want && r.json && r.json.error, `got ${r.status}`);
  };
  const ok = { restaurant_id: 'casa-verde', date: D, time: '12:00', party_size: 2, ...guest };
  await v('impossible date (Feb 31) -> 400', { ...ok, date: '2027-02-31' }, 400);
  await v('slot in the past -> 400', { ...ok, date: futureDate(-3) }, 400);
  await v('unknown restaurant -> 404', { ...ok, restaurant_id: 'nope' }, 404);
  await v('bad timezone -> 400', { ...ok, tz: 'Mars/Olympus' }, 400);
  await v('party_size "8abc" -> 400', { ...ok, party_size: '8abc' }, 400);
  await v('name sent as an object -> 400 (not 500)', { ...ok, name: { a: 1 } }, 400);
  await v('idempotency_key sent as an object -> 400 (not 500)', { ...ok, idempotency_key: { a: 1 } }, 400);
  const badJson = await call(base, 'POST', '/api/reservations', '{not json');
  check('malformed JSON body -> 400 JSON error', badJson.status === 400 && badJson.json && badJson.json.error,
    `got ${badJson.status}`);
  const badAv = await call(base, 'GET', '/api/restaurants/casa-verde/availability?date=2027-13-45&party_size=2');
  check('availability for an impossible date -> 400 (not 500)', badAv.status === 400, `got ${badAv.status}`);
  const pastAv = await call(base, 'GET', `/api/restaurants/casa-verde/availability?date=${futureDate(-3)}&party_size=2`);
  check('availability marks past slots unbookable', pastAv.json.slots.every(s => s.status === 'past' && !s.available));
  const oldYear = await call(base, 'GET', '/api/restaurants/casa-verde/availability?date=0999-01-01&party_size=2');
  check('availability for year 0999 -> 400 (not 500)', oldYear.status === 400, `got ${oldYear.status}`);
  await v('booking in year 0001 -> 400 (not 500)', { ...ok, date: '0001-01-01' }, 400);
  await v('booking more than a year ahead -> 400', { ...ok, date: futureDate(400) }, 400);
  const farAv = await call(base, 'GET', `/api/restaurants/casa-verde/availability?date=${futureDate(400)}&party_size=2`);
  check('availability shows slots beyond the booking horizon as not bookable',
    farAv.status === 200 && farAv.json.slots.every(s => !s.available && s.status === 'not_open_yet'));
  const raw = (method, url, headers, body) => fetch(base + url, { method, headers, body })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
  const enc = await raw('POST', '/api/reservations', { 'Content-Type': 'application/json', 'Content-Encoding': 'bogus' }, '{}');
  check('unsupported Content-Encoding -> 4xx JSON (not 500)', enc.status >= 400 && enc.status < 500 && enc.json, `got ${enc.status}`);
  const gz = await raw('POST', '/api/reservations', { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, 'notgzip');
  check('corrupt gzip body -> 4xx JSON (not 500)', gz.status >= 400 && gz.status < 500 && gz.json, `got ${gz.status}`);
  const pct = await raw('DELETE', '/api/reservations/%ZZ?phone=1', {});
  const pct2 = await raw('GET', `/api/restaurants/%E0%A4%A/availability?date=${D}&party_size=2`, {});
  check('malformed percent-escape in the URL -> 400 (not 500)', pct.status === 400 && pct2.status === 400,
    `got ${pct.status}/${pct2.status}`);
  const unknown = await call(base, 'GET', '/api/nope');
  check('unknown route -> 404', unknown.status === 404);

  console.log('== cancel frees the table ==');
  const cb = await post({ restaurant_id: 'juniper-rye', date: D, time: '19:00', party_size: 10,
    name: 'Cancel Me', phone: '+13334445555' });
  const cid = cb.json.reservation.id;
  const wrong = await call(base, 'DELETE', `/api/reservations/${cid}?phone=%2B19999999999`);
  check('cancel with the wrong phone -> 404', wrong.status === 404, `got ${wrong.status}`);
  const del = await call(base, 'DELETE', `/api/reservations/${cid}?phone=%2B13334445555`);
  check('cancel returns 200', del.status === 200, `got ${del.status}`);
  const again = await call(base, 'DELETE', `/api/reservations/${cid}?phone=%2B13334445555`);
  check('cancelling twice -> 409, nothing else changes', again.status === 409, `got ${again.status}`);
  const rebook = await post({ restaurant_id: 'juniper-rye', date: D, time: '19:00', party_size: 10,
    name: 'Rebook', phone: '+14445556666' });
  check('table can be rebooked after cancel', rebook.status === 201, `got ${rebook.status}`);

  const failed = done();
  stop();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
