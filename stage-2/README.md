# tablekeeper — stage-2

Stage-1 (a restaurant reservation service where **a table is never
double-booked**) plus a **waitlist** and an **admin dashboard**.

## Run

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`; no native modules).

```sh
npm ci
npm start         # guest UI: http://localhost:3000   admin: http://localhost:3000/admin
npm test          # 39 booking checks + 24 waitlist/admin checks + mutation check, ~8 s
```

Set `ADMIN_TOKEN=...` to lock the admin API (then open `/admin?token=...`).
Unset, the dashboard is open — fine for a local demo, not for production.

## What stage-2 adds

**Waitlist that actually holds the table.**
- A guest can join a slot's waitlist only when it is full for their party
  (in the UI: dashed "waitlist" times). They see their place in line under
  *My reservations* and can leave.
- When a booking is cancelled, the oldest waiting guest whose party fits the
  freed table is **booked onto it in the same transaction**. The table is
  never free in between, so nobody can grab it first, and it can't be given
  out twice.
- Cancelling an already-cancelled booking returns 409 and promotes nobody.

**Admin dashboard** (`/admin`): upcoming reservations and waitlist in each
restaurant's local time, bookings that came from the waitlist, and counts
(upcoming, waiting, promoted, cancelled). Usable on a phone.

## No double-booking

Same guarantees as stage-1 — see `../stage-1/README.md` for the full
explanation and the mutation table. In short: bookings only on the slot grid
in restaurant time; one `BEGIN IMMEDIATE` transaction per booking; a partial
`UNIQUE` index as backstop; idempotency keys stored in the same transaction.
`npm test` runs the 50-way race across 4 processes and proves, by removing
the protections, that the race test can fail.

## API (stage-2 additions)

| Method | Route | Notes |
|---|---|---|
| POST | /api/waitlist | `{ restaurant_id, date, time, party_size, name, phone }` → 201 with position · 409 if a table is free or already waiting |
| DELETE | /api/waitlist/:id?phone=... | leave the waitlist |
| GET | /api/reservations?phone=... | now also returns `waitlist` entries with position |
| DELETE | /api/reservations/:id?phone=... | response includes `promoted_from_waitlist` |
| GET | /admin, /api/admin/overview | dashboard + JSON (`ADMIN_TOKEN` optional) |

Everything in the stage-1 API is unchanged.

## Clean container

```sh
docker build -t tablekeeper:stage-2 .
# prove it runs with no network at all, then probe it from inside:
docker run -d --name tk --network none tablekeeper:stage-2
docker exec tk node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>console.log(r.status))"   # 200
docker rm -f tk
# to use it from your browser, publish the port instead:
docker run --rm -p 3000:3000 tablekeeper:stage-2
```

No outbound network needed at runtime.
