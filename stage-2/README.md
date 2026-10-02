# tablekeeper — stage-2

A restaurant reservation service where **a table is never double-booked** —
under concurrent requests, retried requests, and across time zones.

## Run

```sh
npm install
node db.js        # create + seed the database
npm start         # serves on :3000
```

## How the no-double-booking guarantee works

1. **Atomic check-and-book.** Every booking runs inside one `BEGIN IMMEDIATE`
   SQLite transaction: find a free table → insert the reservation → commit.
   The write lock is taken up front, so two concurrent requests cannot both
   observe a free table.
2. **Database backstop.** A partial `UNIQUE` index on
   `(table_id, slot_start_utc) WHERE status='confirmed'` rejects any
   double-insert that slipped past the check (e.g. a cross-process race) —
   the API maps it to HTTP 409.
3. **Idempotent retries.** Clients send `idempotency_key`; a repeated request
   returns the stored result instead of creating a second reservation.
4. **Time zones.** All instants are stored as UTC; conversion happens at the
   edge with IANA timezone names. Availability is computed per restaurant in
   its local timezone.

## API

| Method | Route | Notes |
|---|---|---|
| GET | /api/restaurants | list restaurants |
| GET | /api/restaurants/:id/availability?date=YYYY-MM-DD&party_size=N&tz=IANA | slots, 200/400/404 |
| POST | /api/reservations | 201 booked / 409 slot taken / 400 bad input |
| GET | /api/reservations?phone=... | guest's upcoming reservations |
| DELETE | /api/reservations/:id?phone=... | cancel (frees the table) |

`POST /api/reservations` body:
`{ restaurant_id, date, time, party_size, name, phone, tz?, idempotency_key? }`

## Verify

```sh
npm test   # concurrency (50 parallel same-slot bookings -> exactly 1 wins),
           # idempotent retry, timezone, and validation probes
```

## Clean container

```sh
docker build -t tablekeeper:stage-1 .
docker run --rm -p 3000:3000 --network none tablekeeper:stage-1
```

The image builds with `npm ci` and the service runs with **no outbound
network** (`--network none`): every dependency is vendored at build time and
all data is local SQLite. Timezone conversion uses the Node.js `Intl` API —
no external tz database download.
