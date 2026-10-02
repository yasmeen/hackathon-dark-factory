// Tablekeeper stage-1 — schema + seed data.
// Run: node db.js   (creates ./data/tablekeeper.db from scratch)

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tablekeeper.db');

function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tz TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      slot_minutes INTEGER NOT NULL DEFAULT 30
    );
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
      label TEXT NOT NULL,
      capacity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
      table_id TEXT NOT NULL REFERENCES tables(id),
      slot_start_utc TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    );
    -- A table can hold at most one CONFIRMED reservation per slot.
    -- This is the database-level backstop against double-booking.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_booking
      ON reservations(table_id, slot_start_utc) WHERE status = 'confirmed';
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      reservation_id TEXT REFERENCES reservations(id),
      status_code INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reservations_lookup
      ON reservations(restaurant_id, slot_start_utc, status);
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
      slot_start_utc TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_slot
      ON waitlist(restaurant_id, slot_start_utc, status, created_at);
  `);
}

const SEED = [
  {
    id: 'casa-verde', name: 'Casa Verde', tz: 'America/New_York',
    cuisine: 'Mexican', opens_at: '11:30', closes_at: '22:00',
    tables: [2, 2, 4, 4, 4, 6, 6, 8],
  },
  {
    id: 'copper-kettle', name: 'The Copper Kettle', tz: 'America/Chicago',
    cuisine: 'American', opens_at: '11:00', closes_at: '21:30',
    tables: [2, 2, 4, 4, 6, 8],
  },
  {
    id: 'juniper-rye', name: 'Juniper & Rye', tz: 'America/Los_Angeles',
    cuisine: 'Californian', opens_at: '17:00', closes_at: '22:30',
    tables: [2, 4, 4, 6, 6, 10],
  },
];

function seed(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM restaurants').get().n;
  if (has > 0) return;
  const insR = db.prepare(
    'INSERT INTO restaurants (id, name, tz, cuisine, opens_at, closes_at, slot_minutes) VALUES (?, ?, ?, ?, ?, ?, 30)');
  const insT = db.prepare(
    'INSERT INTO tables (id, restaurant_id, label, capacity) VALUES (?, ?, ?, ?)');
  for (const r of SEED) {
    insR.run(r.id, r.name, r.tz, r.cuisine, r.opens_at, r.closes_at);
    r.tables.forEach((cap, i) =>
      insT.run(`${r.id}-t${i + 1}`, r.id, `T${i + 1}`, cap));
  }
}

if (require.main === module) {
  try { fs.unlinkSync(DB_PATH); } catch {}
  const db = openDb();
  initSchema(db);
  seed(db);
  db.close();
  console.log('database initialized at', DB_PATH);
}

module.exports = { openDb, initSchema, seed };
