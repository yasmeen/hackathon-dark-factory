// Mutation check: a safety test that still passes with the protection removed
// proves nothing. This copies the service, strips each double-booking
// protection in turn, and runs the 50-way race against every variant.
//
// Expected:
//   intact                      -> 1 winner
//   no transaction (index only) -> 1 winner   (index is a real backstop)
//   no unique index (tx only)   -> 1 winner   (transaction is sufficient)
//   neither                     -> >1 winner  (the race test can fail)
// Run: node test/mutation.js   (also part of npm test)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServers, race, futureDate } = require('./lib');

const SRC = path.join(__dirname, '..');

const NO_TX = s => s
  .replace("begin: () => db.exec('BEGIN IMMEDIATE')", 'begin: () => {}')
  .replace("commit: () => db.exec('COMMIT')", 'commit: () => {}');
const NO_INDEX = s => s
  .replace('CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_booking', 'CREATE INDEX IF NOT EXISTS uniq_active_booking');

const ID = s => s;

const VARIANTS = [
  { name: 'intact', server: ID, db: ID, expect: n => n === 1, want: '1' },
  { name: 'transaction removed', server: NO_TX, db: ID, expect: n => n === 1, want: '1' },
  { name: 'unique index removed', server: ID, db: NO_INDEX, expect: n => n === 1, want: '1' },
  { name: 'both removed', server: NO_TX, db: NO_INDEX, expect: n => n > 1, want: '>1 (test must catch it)' },
];

function makeVariant(v) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tablekeeper-mut-'));
  for (const f of ['package.json', 'server.js', 'db.js']) {
    let src = fs.readFileSync(path.join(SRC, f), 'utf8');
    const mutate = f === 'server.js' ? v.server : f === 'db.js' ? v.db : ID;
    const out = mutate(src);
    if (mutate !== ID && out === src) throw new Error(`${v.name}: mutation did not apply to ${f}`);
    src = out;
    fs.writeFileSync(path.join(dir, f), src);
  }
  fs.symlinkSync(path.join(SRC, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(dir, 'public'));
  return dir;
}

async function main() {
  console.log('== mutation check: does the race test notice missing protections? ==');
  let bad = 0;
  for (const v of VARIANTS) {
    const dir = makeVariant(v);
    const { bases, stop } = await startServers({ dir, count: 4, env: { TK_RACE_WINDOW_MS: '40' } });
    const codes = await race(bases, { restaurant_id: 'casa-verde', date: futureDate(30), time: '19:00', party_size: 8 });
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
    const wins = codes.filter(c => c === 201).length;
    const other = codes.filter(c => c !== 201 && c !== 409);
    const ok = v.expect(wins) && other.length === 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${v.name.padEnd(22)} winners=${wins} (expected ${v.want})` +
      (other.length ? ` unexpected statuses: ${[...new Set(other)]}` : ''));
  }
  console.log(bad ? `\n${bad} mutation expectation(s) failed` : '\nall mutation expectations hold');
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
