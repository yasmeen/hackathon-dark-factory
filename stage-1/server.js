// Tablekeeper stage-1 — reservation service.
// The hard part: a table is never double-booked — under concurrency,
// retried requests, and across time zones.
//
// Concurrency: every booking runs inside a single BEGIN IMMEDIATE
// transaction (check availability + insert are atomic), and a partial
// UNIQUE index on (table_id, slot_start_utc) WHERE status='confirmed' is
// the database-level backstop.
// Retries: clients send an idempotency key; repeats return the stored
// result instead of creating a second reservation.
// Time zones: all instants stored as UTC; conversion happens at the edge
// with IANA timezone names.

const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { openDb, initSchema, seed } = require('./db');

const db = openDb();
initSchema(db);
seed(db);

// ---------- time helpers ----------

function zonedTimeToUtc(date, time, tz) {
  // date: YYYY-MM-DD, time: HH:MM (wall clock in tz) -> Date (UTC instant)
  const guess = new Date(`${date}T${time}:00Z`);
  if (isNaN(guess)) return null;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(guess).map(p => [p.type, p.value]));
  const asUTC = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  return new Date(guess.getTime() - (asUTC - guess.getTime()));
}

function formatInTz(utcIso, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
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

// ---------- app ----------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const getRestaurant = id =>
  db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);

app.get('/api/restaurants', (req, res) => {
  const rows = db.prepare('SELECT id, name, tz, cuisine, opens_at, closes_at FROM restaurants').all();
  res.json({ restaurants: rows });
});

app.get('/api/restaurants/:id/availability', (req, res) => {
  const r = getRestaurant(req.params.id);
  if (!r) return res.status(404).json({ error: 'restaurant not found' });
  const { date, party_size } = req.query;
  const tz = req.query.tz || r.tz;
  const party = parseInt(party_size, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !(party >= 1 && party <= 20))
    return res.status(400).json({ error: 'date=YYYY-MM-DD and party_size=1..20 required' });
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
  catch { return res.status(400).json({ error: 'invalid timezone' }); }

  const booked = new Set(db.prepare(`
    SELECT table_id || '|' || slot_start_utc AS k FROM reservations
    WHERE restaurant_id = ? AND status = 'confirmed'`).all(r.id).map(x => x.k));
  const tables = db.prepare(
    'SELECT id, capacity FROM tables WHERE restaurant_id = ? AND capacity >= ? ORDER BY capacity').all(r.id, party);

  const slots = slotTimes(r, date).map(time => {
    const utc = zonedTimeToUtc(date, time, r.tz);
    const utcIso = utc.toISOString();
    const free = tables.filter(t => !booked.has(`${t.id}|${utcIso}`));
    return {
      time, utc: utcIso,
      display_time: formatInTz(utcIso, tz),
      available: free.length > 0,
      tables_available: free.length,
    };
  });
  res.json({ restaurant: r.id, date, party_size: party, tz, slots });
});

app.post('/api/reservations', (req, res) => {
  const { restaurant_id, date, time, party_size, name, phone, idempotency_key } = req.body || {};
  const r = restaurant_id && getRestaurant(restaurant_id);
  const tz = (req.body && req.body.tz) || (r && r.tz);
  const party = parseInt(party_size, 10);

  if (!r) return finish(404, { error: 'unknown restaurant_id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || ''))
    return finish(400, { error: 'date=YYYY-MM-DD and time=HH:MM required' });
  if (!(party >= 1 && party <= 20)) return finish(400, { error: 'party_size must be 1..20' });
  if (!name || !phone) return finish(400, { error: 'name and phone required' });
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
  catch { return finish(400, { error: 'invalid timezone' }); }

  const utc = zonedTimeToUtc(date, time, tz);
  if (!utc || isNaN(utc)) return finish(400, { error: 'invalid date/time' });
  const utcIso = utc.toISOString();

  // Idempotent replay: return the stored result, never a second booking.
  if (idempotency_key) {
    const prev = db.prepare('SELECT status_code, response_body FROM idempotency_keys WHERE key = ?')
      .get(idempotency_key);
    if (prev) return res.status(prev.status_code).json(JSON.parse(prev.response_body));
  }

  // Atomic check-and-book. BEGIN IMMEDIATE takes the write lock up front so
  // two concurrent requests cannot both see a free table and both insert.
  let outcome;
  try {
    db.exec('BEGIN IMMEDIATE');
    const table = db.prepare(`
      SELECT id, label, capacity FROM tables
      WHERE restaurant_id = ? AND capacity >= ?
        AND id NOT IN (SELECT table_id FROM reservations
                       WHERE status = 'confirmed' AND slot_start_utc = ?)
      ORDER BY capacity ASC LIMIT 1`).get(r.id, party, utcIso);
    if (!table) {
      outcome = { code: 409, body: { error: 'no table available for that slot', code: 'SLOT_TAKEN' } };
    } else {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO reservations
        (id, restaurant_id, table_id, slot_start_utc, party_size, name, phone, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`)
        .run(id, r.id, table.id, utcIso, party, name, phone, now);
      outcome = { code: 201, body: {
        reservation: {
          id, restaurant: r.name, table: table.label, party_size: party,
          name, status: 'confirmed',
          when_local: `${date} ${formatInTz(utcIso, tz)} (${tz})`,
          slot_start_utc: utcIso,
        } } };
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    // Backstop: the partial UNIQUE index rejects any double-insert that
    // somehow slipped past the check (e.g. a race across processes).
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE')
      outcome = { code: 409, body: { error: 'no table available for that slot', code: 'SLOT_TAKEN' } };
    else throw err;
  }

  return finish(outcome.code, outcome.body, outcome.code === 201 ? outcome.body.reservation.id : null);

  function finish(code, body, reservationId) {
    if (idempotency_key && !db.prepare('SELECT 1 FROM idempotency_keys WHERE key = ?').get(idempotency_key)) {
      db.prepare(`INSERT INTO idempotency_keys (key, reservation_id, status_code, response_body, created_at)
                  VALUES (?, ?, ?, ?, ?)`)
        .run(idempotency_key, reservationId, code, JSON.stringify(body), new Date().toISOString());
    }
    return res.status(code).json(body);
  }
});

app.get('/api/reservations', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const rows = db.prepare(`
    SELECT r.id, r.slot_start_utc, r.party_size, r.name, r.status,
           rest.name AS restaurant, rest.tz, t.label AS tbl
    FROM reservations r
    JOIN restaurants rest ON rest.id = r.restaurant_id
    JOIN tables t ON t.id = r.table_id
    WHERE r.phone = ? AND r.status = 'confirmed'
    ORDER BY r.slot_start_utc`).all(phone);
  res.json({ reservations: rows.map(x => ({
    ...x, when_local: new Intl.DateTimeFormat('en-US', {
      timeZone: x.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x.slot_start_utc)),
  })) });
});

app.delete('/api/reservations/:id', (req, res) => {
  const { phone } = req.query;
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!row || row.phone !== phone) return res.status(404).json({ error: 'reservation not found' });
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ cancelled: req.params.id });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`tablekeeper stage-1 on :${PORT}`));
}
module.exports = app;
