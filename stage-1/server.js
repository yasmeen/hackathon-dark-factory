// Tablekeeper stage-1 — reservation service.
// The hard part: a table is never double-booked — under concurrency,
// retried requests, and across time zones.
//
// Slots: a booking may only start on the restaurant's slot grid (every
// slot_minutes from opens_at, in the restaurant's own timezone) and only in
// the future. Off-grid starts would let two bookings overlap without sharing
// a start time, which no unique index can see — so they are rejected.
// Concurrency: every booking runs inside a single BEGIN IMMEDIATE
// transaction (check availability + insert are atomic across processes),
// and a partial UNIQUE index on (table_id, slot_start_utc) WHERE
// status='confirmed' is the database-level backstop.
// Retries: clients send an idempotency key; a repeat of the same request
// returns the stored result, and the key is written in the same transaction
// as the booking so the two can never disagree.
// Time zones: all instants stored as UTC; booking times are always the
// restaurant's local wall clock; any `tz` a client sends only changes how
// times are displayed back to it.

const express = require('express');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { openDb, initSchema, seed } = require('./db');

const db = openDb();
initSchema(db);
seed(db);

// Transaction boundaries live in one place. test/mutation.js removes them
// (and the unique index) to prove the concurrency tests notice.
const tx = {
  begin: () => db.exec('BEGIN IMMEDIATE'),
  commit: () => db.exec('COMMIT'),
  rollback: () => { try { db.exec('ROLLBACK'); } catch {} },
};

// Test-only fault injection: holds the gap between "found a free table" and
// "inserted the booking" open for this many ms, so a race test can tell a
// protected booking path from an unprotected one. Unset in normal operation.
const RACE_WINDOW_MS = Number(process.env.TK_RACE_WINDOW_MS) || 0;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const isUniqueViolation = err =>
  err && (err.errcode === 2067 || /UNIQUE constraint failed/.test(err.message || ''));

// ---------- time helpers ----------

// Real calendar dates in a sane range (Intl renders years < 1000 without
// four digits, which would break the UTC conversion below).
function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const year = Number(date.slice(0, 4));
  if (year < 1970 || year > 2999) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === date;
}

const BOOKING_HORIZON_DAYS = 365;

function isValidTz(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function tzOffsetMs(tz, instantMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map(x => [x.type, x.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - instantMs;
}

function zonedTimeToUtc(date, time, tz) {
  // date: YYYY-MM-DD, time: HH:MM (wall clock in tz) -> Date (UTC instant).
  // Two passes so the offset is taken at the target instant, not the guess.
  const wall = Date.parse(`${date}T${time}:00Z`);
  let t = wall - tzOffsetMs(tz, wall);
  t = wall - tzOffsetMs(tz, t);
  return new Date(t);
}

function formatTime(utcIso, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(utcIso));
}

function formatWhen(utcIso, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(utcIso));
}

function slotTimes(restaurant, date) {
  // all slot wall-clock starts for `date` in the restaurant's timezone
  const [oh, om] = restaurant.opens_at.split(':').map(Number);
  const [ch, cm] = restaurant.closes_at.split(':').map(Number);
  const slots = [];
  let h = oh, m = om;
  while (h < ch || (h === ch && m < cm)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += restaurant.slot_minutes;
    h += Math.floor(m / 60); m %= 60;
  }
  return slots;
}

// ---------- input helpers ----------

const fail = (status, error, code) => ({ status, body: code ? { error, code } : { error } });

function parseParty(v) {
  const s = typeof v === 'number' || typeof v === 'string' ? String(v) : '';
  const n = /^\d{1,2}$/.test(s) ? Number(s) : NaN;
  return n >= 1 && n <= 20 ? n : null;
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

// Resolve a requested (date, time) to a bookable slot instant, or a failure.
function resolveSlot(r, date, time) {
  if (!isValidDate(date)) return fail(400, 'date must be a real calendar date (YYYY-MM-DD)', 'INVALID_DATE');
  if (typeof time !== 'string' || !slotTimes(r, date).includes(time))
    return fail(400, `time must be one of ${r.name}'s ${r.slot_minutes}-minute slots from ` +
      `${r.opens_at} to ${r.closes_at}, restaurant local time (HH:MM)`, 'INVALID_SLOT');
  const utcIso = zonedTimeToUtc(date, time, r.tz).toISOString();
  if (Date.parse(utcIso) <= Date.now()) return fail(400, 'that slot has already started', 'SLOT_IN_PAST');
  if (Date.parse(utcIso) > Date.now() + BOOKING_HORIZON_DAYS * 86400000)
    return fail(400, `bookings open at most ${BOOKING_HORIZON_DAYS} days ahead`, 'TOO_FAR_AHEAD');
  return { utcIso };
}

// Shared validation for anything that targets a slot (bookings; stage-2 waitlist).
function parseSlotRequest(b) {
  const r = typeof b.restaurant_id === 'string' && getRestaurant(b.restaurant_id);
  if (!r) return { err: fail(404, 'unknown restaurant_id', 'UNKNOWN_RESTAURANT') };
  const tz = b.tz === undefined || b.tz === null || b.tz === '' ? r.tz : b.tz;
  if (!isValidTz(tz)) return { err: fail(400, 'tz must be an IANA timezone name', 'INVALID_TZ') };
  const party = parseParty(b.party_size);
  if (!party) return { err: fail(400, 'party_size must be a whole number 1..20', 'INVALID_PARTY') };
  const name = cleanStr(b.name, 80), phone = cleanStr(b.phone, 32);
  if (!name || !phone) return { err: fail(400, 'name and phone are required (text, max 80/32 chars)', 'INVALID_CONTACT') };
  const slot = resolveSlot(r, b.date, b.time);
  if (slot.status) return { err: slot };
  return { r, tz, party, name, phone, utcIso: slot.utcIso };
}

// ---------- booking core ----------

const getRestaurant = id =>
  db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);

function freeTables(restaurantId, party, utcIso) {
  return db.prepare(`
    SELECT id, label, capacity FROM tables
    WHERE restaurant_id = ? AND capacity >= ?
      AND id NOT IN (SELECT table_id FROM reservations
                     WHERE status = 'confirmed' AND slot_start_utc = ?)
    ORDER BY capacity ASC, id ASC`).all(restaurantId, party, utcIso);
}

function insertReservation(r, table, utcIso, party, name, phone) {
  const id = randomUUID();
  db.prepare(`INSERT INTO reservations
    (id, restaurant_id, table_id, slot_start_utc, party_size, name, phone, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`)
    .run(id, r.id, table.id, utcIso, party, name, phone, new Date().toISOString());
  return id;
}

// Must run inside a transaction.
function book({ r, tz, party, name, phone, utcIso }) {
  const table = freeTables(r.id, party, utcIso)[0];
  if (!table) return fail(409, 'no table available for that slot', 'SLOT_TAKEN');
  if (RACE_WINDOW_MS) pause(RACE_WINDOW_MS);
  const id = insertReservation(r, table, utcIso, party, name, phone);
  return { status: 201, body: { reservation: {
    id, restaurant: r.name, table: table.label, party_size: party, name, status: 'confirmed',
    when_local: formatWhen(utcIso, tz), tz, slot_start_utc: utcIso,
  } } };
}

// ---------- app ----------

const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/restaurants', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, tz, cuisine, opens_at, closes_at, slot_minutes FROM restaurants ORDER BY name').all();
  res.json({ restaurants: rows });
});

app.get('/api/restaurants/:id/availability', (req, res) => {
  const r = getRestaurant(req.params.id);
  if (!r) return res.status(404).json({ error: 'restaurant not found' });
  const { date } = req.query;
  const tz = req.query.tz || r.tz;
  const party = parseParty(req.query.party_size);
  if (!isValidDate(date) || !party)
    return res.status(400).json({ error: 'date=YYYY-MM-DD (a real date) and party_size=1..20 required' });
  if (!isValidTz(tz)) return res.status(400).json({ error: 'invalid timezone' });

  const booked = new Set(db.prepare(`
    SELECT table_id || '|' || slot_start_utc AS k FROM reservations
    WHERE restaurant_id = ? AND status = 'confirmed'`).all(r.id).map(x => x.k));
  const tables = db.prepare(
    'SELECT id, capacity FROM tables WHERE restaurant_id = ? AND capacity >= ?').all(r.id, party);
  const now = Date.now();

  const slots = slotTimes(r, date).map(time => {
    const utcIso = zonedTimeToUtc(date, time, r.tz).toISOString();
    const free = tables.filter(t => !booked.has(`${t.id}|${utcIso}`)).length;
    const past = Date.parse(utcIso) <= now;
    return {
      time, utc: utcIso, display_time: formatTime(utcIso, tz),
      available: !past && free > 0, tables_available: past ? 0 : free,
      status: past ? 'past' : free > 0 ? 'open' : 'full',
    };
  });
  res.json({ restaurant: r.id, date, party_size: party, tz, slots });
});

app.post('/api/reservations', (req, res) => {
  const b = req.body || {};
  const key = b.idempotency_key;
  if (key !== undefined && !(typeof key === 'string' && key.length >= 1 && key.length <= 128))
    return res.status(400).json({ error: 'idempotency_key must be a string of 1..128 chars', code: 'INVALID_KEY' });
  const p = parseSlotRequest(b);
  if (p.err) return res.status(p.err.status).json(p.err.body);

  // Fingerprint of what was asked for, so a key reused for a different
  // request is refused instead of silently replaying someone else's result.
  const requestHash = createHash('sha256')
    .update(JSON.stringify([p.r.id, b.date, b.time, p.party, p.name, p.phone])).digest('hex');

  let out;
  try {
    tx.begin();
    const prev = key && db.prepare(
      'SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = ?').get(key);
    if (prev) {
      out = prev.request_hash && prev.request_hash !== requestHash
        ? fail(422, 'idempotency_key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED')
        : { status: prev.status_code, body: JSON.parse(prev.response_body), replayed: true };
    } else {
      out = book(p);
      if (key) db.prepare(`INSERT INTO idempotency_keys
          (key, request_hash, reservation_id, status_code, response_body, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
        .run(key, requestHash, out.status === 201 ? out.body.reservation.id : null,
          out.status, JSON.stringify(out.body), new Date().toISOString());
    }
    tx.commit();
  } catch (err) {
    tx.rollback();
    // Backstop: the partial UNIQUE index rejects any double-insert that got
    // past the check (it cannot while the transaction holds; test/mutation.js
    // proves this path on its own by removing the transaction).
    if (!isUniqueViolation(err)) throw err;
    out = fail(409, 'no table available for that slot', 'SLOT_TAKEN');
  }
  if (out.replayed) res.set('Idempotent-Replay', 'true');
  res.status(out.status).json(out.body);
});

app.get('/api/reservations', (req, res) => {
  const phone = cleanStr(req.query.phone, 32);
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const rows = db.prepare(`
    SELECT r.id, r.slot_start_utc, r.party_size, r.name, r.status,
           rest.name AS restaurant, rest.tz, t.label AS tbl
    FROM reservations r
    JOIN restaurants rest ON rest.id = r.restaurant_id
    JOIN tables t ON t.id = r.table_id
    WHERE r.phone = ? AND r.status = 'confirmed' AND r.slot_start_utc > ?
    ORDER BY r.slot_start_utc`).all(phone, new Date().toISOString());
  res.json({ reservations: rows.map(x => ({ ...x, when_local: formatWhen(x.slot_start_utc, x.tz) })) });
});

app.delete('/api/reservations/:id', (req, res) => {
  const phone = cleanStr(req.query.phone, 32);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!row || row.phone !== phone) return res.status(404).json({ error: 'reservation not found' });
  const changed = db.prepare(
    "UPDATE reservations SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").run(row.id).changes;
  if (!changed) return res.status(409).json({ error: 'reservation is already cancelled', code: 'ALREADY_CANCELLED' });
  res.json({ cancelled: row.id });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'request body must be valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
  // Other client errors raised by body-parser / the router (bad encoding,
  // bad percent-escapes in the URL, ...) carry their own 4xx status.
  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500)
    return res.status(status).json({ error: err.expose && err.message ? err.message : 'bad request' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`tablekeeper stage-1 on :${PORT}`));
}
module.exports = app;
