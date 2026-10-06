# tablekeeper — stage-1

A restaurant reservation service where **a table is never double-booked** —
under concurrent requests, retried requests, and across time zones.

Guests browse restaurants, check availability for a date and party size,
book a table, and view or cancel their own reservations.

## Run

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`; no native modules).

```sh
npm ci
npm start         # serves http://localhost:3000 (creates + seeds the DB on first start)
npm test          # 33 checks + mutation check, ~5 s
```

`node db.js` resets the database to the seed data.

## How the no-double-booking guarantee works

1. **Only real slots can be booked.** A booking must start on the
   restaurant's slot grid (every 30 minutes from opening, before closing),
   in the restaurant's own time zone, in the future. Off-grid starts
   (19:15 next to a 19:00 booking) would overlap without sharing a start
   time, so they are rejected with 400. This is what makes layers 2–3 sufficient.
2. **Atomic check-and-book.** Every booking runs inside one `BEGIN IMMEDIATE`
   SQLite transaction: find a free table → insert → commit. The write lock is
   taken up front, so two requests — even in different processes sharing the
   database file — cannot both see the table as free.
3. **Database backstop.** A partial `UNIQUE` index on
   `(table_id, slot_start_utc) WHERE status='confirmed'` rejects any
   double-insert that got past the check; the API maps it to 409.
4. **Idempotent retries.** Clients send `idempotency_key`. The key is stored
   in the same transaction as the booking, so a retry — even one racing the
   original on another process — replays the original result
   (`Idempotent-Replay: true`). Reusing a key for a different request → 422.
5. **Time zones.** Instants are stored in UTC. Booking times are always the
   restaurant's wall clock; a client `tz` only changes how times are shown.
   UTC conversion uses the Node `Intl` API (no tz database download) and is
   checked across both DST transitions.

### Proof that the tests can fail

`test/run.js` starts **4 server processes on one database** and fires 50
parallel bookings at the single table that fits: exactly 1×201, 49×409.
A race test is only evidence if it can fail, so `test/mutation.js` copies the
service, removes protections, and re-runs the race:

| Variant | Winners | Meaning |
|---|---|---|
| intact | 1 | — |
| transaction removed | 1 | the unique index alone holds (and returns 409, not 500) |
| unique index removed | 1 | the transaction alone holds |
| both removed | 4 | the race test catches the double-booking |

Both runs set `TK_RACE_WINDOW_MS`, a test-only switch that holds the
check→insert gap open for a few ms so races actually happen. It is unset in
normal operation.

## API

| Method | Route | Notes |
|---|---|---|
| GET | /api/restaurants | list restaurants |
| GET | /api/restaurants/:id/availability?date=YYYY-MM-DD&party_size=N&tz=IANA | slots with `status` open / full / past |
| POST | /api/reservations | 201 booked · 409 slot taken · 400 invalid · 422 key reused |
| GET | /api/reservations?phone=... | guest's upcoming reservations |
| DELETE | /api/reservations/:id?phone=... | cancel (frees the table) · 409 if already cancelled |
| GET | /healthz | liveness |

`POST /api/reservations` body:
`{ restaurant_id, date, time, party_size, name, phone, tz?, idempotency_key? }`
— `time` is `HH:MM` in the restaurant's local time; `tz` is display-only.

All errors are JSON `{ error, code? }`; malformed input never produces a 5xx.

## Clean container

```sh
docker build -t tablekeeper:stage-1 .
# prove it runs with no network at all, then probe it from inside:
docker run -d --name tk --network none tablekeeper:stage-1
docker exec tk node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>console.log(r.status))"   # 200
docker rm -f tk
# to use it from your browser, publish the port instead:
docker run --rm -p 3000:3000 tablekeeper:stage-1
```

The image installs dependencies with `npm ci` at build time; at runtime the
service needs **no outbound network** (`--network none`): data is local
SQLite and time zones come from Node's built-in ICU.

## Deliberate limits

Single SQLite file (multi-process safe, single host). Fixed 30-minute slots.
No accounts: the phone number used at booking is the key to view/cancel.
