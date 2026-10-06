// Tablekeeper stage-2 — waitlist + admin verification. Run: npm test

const { startServers, call, futureDate, checker } = require('./lib');

async function main() {
  const { bases, base, stop } = await startServers({ count: 2 });
  const { check, done } = checker();
  const D = futureDate(40);
  // Juniper & Rye has exactly one table for 10.
  const slot = { restaurant_id: 'juniper-rye', date: D, time: '19:00', party_size: 10 };
  const post = (url, body) => call(base, 'POST', url, body);
  const join = (name, phone, extra = {}) => post('/api/waitlist', { ...slot, name, phone, ...extra });

  console.log('== joining the waitlist ==');
  const early = await join('Too Early', '+15550000001');
  check('cannot join while a table is free (409 SLOT_AVAILABLE)', early.status === 409 && early.json.code === 'SLOT_AVAILABLE',
    `got ${early.status}`);
  const owner = await post('/api/reservations', { ...slot, name: 'Owner', phone: '+15550000000' });
  check('the only 10-top is booked', owner.status === 201, `got ${owner.status}`);
  const w1 = await join('First', '+15550000011');
  const w2 = await join('Second', '+15550000022');
  const small = await post('/api/waitlist', { ...slot, party_size: 2, name: 'Pair', phone: '+15550000033' });
  check('guests join a full slot in order (positions 1, 2)',
    w1.status === 201 && w2.status === 201 && w1.json.waitlist.position === 1 && w2.json.waitlist.position === 2,
    `got ${w1.status}/${w2.status}`);
  check('cannot join for a party that still has a free table', small.status === 409, `got ${small.status}`);
  const dupe = await join('First again', '+15550000011');
  check('same guest cannot hold two places for one slot (409)', dupe.status === 409 && dupe.json.code === 'ALREADY_WAITING',
    `got ${dupe.status}`);
  const badTz = await join('Bad', '+15550000044', { tz: 'Mars/Olympus' });
  check('bad timezone -> 400 (not 500)', badTz.status === 400, `got ${badTz.status}`);
  const offGrid = await join('Off', '+15550000055', { time: '19:10' });
  check('off-grid time -> 400', offGrid.status === 400, `got ${offGrid.status}`);
  const mine = await call(base, 'GET', '/api/reservations?phone=%2B15550000022');
  check("guest sees their waitlist place under My reservations",
    mine.json.waitlist.length === 1 && mine.json.waitlist[0].position === 2, JSON.stringify(mine.json.waitlist));

  console.log('== cancel promotes the oldest fitting guest onto the freed table ==');
  const cancel = await call(bases[1], 'DELETE', `/api/reservations/${owner.json.reservation.id}?phone=%2B15550000000`);
  check('cancel returns 200 and names who was promoted',
    cancel.status === 200 && cancel.json.promoted_from_waitlist && cancel.json.promoted_from_waitlist.name === 'First',
    JSON.stringify(cancel.json));
  const firstRes = await call(base, 'GET', '/api/reservations?phone=%2B15550000011');
  check("'First' now holds a confirmed reservation on the 10-top",
    firstRes.json.reservations.length === 1 && firstRes.json.reservations[0].tbl === 'T6', JSON.stringify(firstRes.json));
  const sniper = await post('/api/reservations', { ...slot, name: 'Sniper', phone: '+15550000099' });
  check('nobody can grab the freed table in between (409)', sniper.status === 409, `got ${sniper.status}`);
  const again = await call(base, 'DELETE', `/api/reservations/${owner.json.reservation.id}?phone=%2B15550000000`);
  const second = await call(base, 'GET', '/api/reservations?phone=%2B15550000022');
  check('cancelling the same booking again -> 409, and Second is NOT promoted',
    again.status === 409 && second.json.reservations.length === 0 && second.json.waitlist.length === 1,
    `got ${again.status}`);
  const pos = await call(base, 'GET', '/api/reservations?phone=%2B15550000022');
  check('Second moves up to position 1', pos.json.waitlist[0] && pos.json.waitlist[0].position === 1);

  const firstCancel = await call(base, 'DELETE',
    `/api/reservations/${firstRes.json.reservations[0].id}?phone=%2B15550000011`);
  check("when 'First' cancels, 'Second' is promoted next",
    firstCancel.json.promoted_from_waitlist && firstCancel.json.promoted_from_waitlist.name === 'Second',
    JSON.stringify(firstCancel.json));

  console.log('== leaving the waitlist ==');
  const slot2 = { ...slot, time: '20:00' };
  const o2 = await post('/api/reservations', { ...slot2, name: 'Owner2', phone: '+15550000100' });
  const leaver = await post('/api/waitlist', { ...slot2, name: 'Leaver', phone: '+15550000101' });
  const stayer = await post('/api/waitlist', { ...slot2, name: 'Stayer', phone: '+15550000102' });
  const leave = await call(base, 'DELETE', `/api/waitlist/${leaver.json.waitlist.id}?phone=%2B15550000101`);
  check('guest can leave the waitlist', leave.status === 200, `got ${leave.status}`);
  const c2 = await call(base, 'DELETE', `/api/reservations/${o2.json.reservation.id}?phone=%2B15550000100`);
  check('a guest who left is skipped; the next one is promoted',
    c2.json.promoted_from_waitlist && c2.json.promoted_from_waitlist.name === 'Stayer' && stayer.status === 201,
    JSON.stringify(c2.json));

  console.log('== admin ==');
  const ov = await call(base, 'GET', '/api/admin/overview');
  check('admin overview returns stats, reservations, waitlist',
    ov.status === 200 && ov.json.stats && Array.isArray(ov.json.reservations) && Array.isArray(ov.json.waitlist));
  check('admin counts 3 promotions from the waitlist', ov.json.stats.promoted === 3, `got ${ov.json.stats.promoted}`);
  check('admin shows local times', ov.json.reservations.every(r => /[AP]M/.test(r.when_local)));
  const page = await fetch(`${base}/admin`);
  check('admin page serves', page.status === 200);
  stop();

  const locked = await startServers({ count: 1, env: { ADMIN_TOKEN: 's3cret' } });
  const deny = await call(locked.base, 'GET', '/api/admin/overview');
  const allow = await call(locked.base, 'GET', '/api/admin/overview?token=s3cret');
  check('with ADMIN_TOKEN set, admin API needs the token (401 without, 200 with)',
    deny.status === 401 && allow.status === 200, `got ${deny.status}/${allow.status}`);
  locked.stop();

  process.exit(done() ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
