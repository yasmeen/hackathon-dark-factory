# Dark Factory — a three-seat software factory

WeAreDevelopers × BAND **AI Dark Factory** hackathon entry · tablekeeper track.

**The entry is the factory**: three coding-agent seats (planner, implementer,
reviewer) with generic mandates that take one dispatched task and ship a
verified service. What it shipped here is **tablekeeper**, a restaurant
reservation service where a table is never double-booked.

| Path | What |
|---|---|
| [`FACTORY.md`](FACTORY.md) | seats, design rationale, the runs (including what went wrong), measurements |
| [`seats/`](seats/) | the three mandates — no product, domain, or stack named |
| [`room/`](room/) | room definition, the dispatched brief, full transcript of both runs |
| [`stage-1/`](stage-1/) | browse · check availability · book · view/cancel |
| [`stage-2/`](stage-2/) | stage-1 + waitlist with atomic promotion + admin dashboard |
| [`video-script.md`](video-script.md) | demo walkthrough |

## Try it

Node.js ≥ 22.5, no other system dependencies:

```sh
cd stage-2
npm ci
npm test     # 64 checks + mutation check: 50-way race across 4 processes, DST, waitlist
npm start    # http://localhost:3000  ·  admin: http://localhost:3000/admin
```

Or in a container — it starts and serves with `--network none` (see
`stage-2/README.md` for the exact probe):

```sh
cd stage-2 && docker build -t tablekeeper . && docker run --rm -p 3000:3000 tablekeeper
```
