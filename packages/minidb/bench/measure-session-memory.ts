// bench/measure-session-memory.ts
//
// Measure per-record memory of the Session scenario (bench/session-store.ts) so
// we can estimate the largest dataset the current all-in-RAM structure can hold.
//
// It builds N synthetic SessionDoc-shaped records with ~TEXT bytes of searchable
// text each, then adds the SAME indexes session-store creates, one by one,
// measuring heap/external/rss after each step. The per-step deltas attribute
// memory to each component (base store+value, dt indexes, equality indexes,
// compound indexes, full-text index).
//
// Run:
//   node --import tsx --expose-gc --max-old-space-size=12288 \
//        bench/measure-session-memory.ts [N=30000] [TEXT=4000]

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MiniDb } from '../src/index.js';

const N = Number(process.argv[2] ?? 30000);
const TEXT = Number(process.argv[3] ?? 4000);

const gc = (): void => {
  if (global.gc) {
    global.gc();
    global.gc();
  }
};
const mib = (n: number): string => (n / 1048576).toFixed(1) + ' MiB';
const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

interface Snap {
  heap: number;
  ext: number;
  rss: number;
}
const snap = (): Snap => {
  gc();
  const m = process.memoryUsage();
  return { heap: m.heapUsed, ext: m.external, rss: m.rss };
};

// --- realistic-ish text generation ----------------------------------------
// A bounded vocabulary so terms repeat across documents (like real text), but
// large enough that the global term set is non-trivial. Latin words + CJK
// unigrams/bigrams mirror src/text-index/tokenize.ts's tokenizer.
const LATIN: string[] = Array.from({ length: 12000 }, (_, i) => 'w' + i.toString(36));
const CJK_CHARS = Array.from({ length: 512 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');

function makeText(targetChars: number): string {
  const parts: string[] = [];
  let n = 0;
  while (n < targetChars) {
    if (Math.random() < 0.55) {
      const t = LATIN[(Math.random() * LATIN.length) | 0]!;
      parts.push(t);
      n += t.length + 1;
    } else {
      const len = 1 + ((Math.random() * 6) | 0);
      const start = (Math.random() * (CJK_CHARS.length - len)) | 0;
      const t = CJK_CHARS.slice(start, start + len);
      parts.push(t);
      n += t.length + 1;
    }
  }
  return parts.join(' ').slice(0, targetChars);
}

interface SessionDoc {
  workspaceId: string;
  workspaceName: string;
  workDir: string;
  title: string;
  lastPrompt: string;
  text: string;
  sessionDir: string;
  messageCount: number;
}

const NWS = 200; // distinct workspaces (low cardinality -> small equality index)

async function main(): Promise<void> {
  if (!global.gc) {
    console.error('run with --expose-gc for stable measurements');
    process.exit(1);
  }
  const dir = path.join(os.tmpdir(), 'minidb-mem-' + Date.now());
  await fs.rm(dir, { recursive: true, force: true });

  const db = await MiniDb.open<SessionDoc>({
    dir,
    valueCodec: 'json',
    fsyncPolicy: 'no',
    autoCompact: false,
    activeExpireIntervalMs: 0, // disable timer; we only measure
  });

  console.log(`scenario: ${fmt(N)} sessions, ~${fmt(TEXT)} chars text each`);
  console.log(`out: ${dir}\n`);

  const base = snap();

  // Insert data WITH dt (so dt indexes exist) but BEFORE any secondary index.
  const t0 = performance.now();
  const CHUNK = 500;
  let totalEncoded = 0;
  for (let i = 0; i < N; i += CHUNK) {
    const ops = [];
    const end = Math.min(i + CHUNK, N);
    for (let j = i; j < end; j++) {
      const ws = j % NWS;
      const text = makeText(TEXT);
      const doc: SessionDoc = {
        workspaceId: 'ws' + ws,
        workspaceName: 'workspace-' + ws,
        workDir: '/home/user/proj-' + (j % 1000),
        title: 'session title ' + j + ' ' + LATIN[j % LATIN.length],
        lastPrompt: 'please refactor the ' + LATIN[(j * 7) % LATIN.length] + ' module',
        text,
        sessionDir: '/x/ws' + ws + '/sess' + j,
        messageCount: (j % 50) + 1,
      };
      totalEncoded += Buffer.byteLength(JSON.stringify(doc), 'utf8');
      ops.push({
        op: 'set' as const,
        key: 'sess:' + j,
        value: doc,
        dt: { updatedAt: 1700000000000 + j * 1000, createdAt: 1699000000000 + j * 1000 },
      });
    }
    await db.batch(ops);
  }
  const insertMs = performance.now() - t0;

  const afterData = snap();
  // Base store + key skiplist + ttl heap + value buffers + dt indexes(updatedAt,createdAt)

  await db.createIndex('byWorkspace', { field: 'workspaceId' });
  const afterEqWs = snap();

  await db.createIndex('byWorkDir', { field: 'workDir' });
  const afterEqWd = snap();

  await db.createCompoundIndex('byWsUpdated', { groupBy: 'workspaceId', orderBy: 'updatedAt' });
  const afterCmpUpd = snap();

  await db.createCompoundIndex('byWsCreated', { groupBy: 'workspaceId', orderBy: 'createdAt' });
  const afterCmpCrt = snap();

  await db.createTextIndex('body', { fields: ['text'] });
  const afterText = snap();

  // text index internals (larger-than-RAM: postings are on disk; the in-memory
  // dictionary maps term -> { off, len, df }).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ti = (db as any).text.get('body');
  const postingsTerms = ti.termCount() as number;
  let postingsEntries = 0;
  for (const e of ti.postings.values()) postingsEntries += (e as { df: number }).df;
  const tfDocs = ti.N as number;

  console.log('--- ingest ---');
  console.log(`  insert time        : ${(insertMs / 1000).toFixed(2)} s  (${fmt((N / insertMs) * 1000 | 0)} sess/s)`);
  console.log(`  avg encoded doc    : ${fmt((totalEncoded / N) | 0)} bytes  (JSON of value)`);
  console.log(`  total encoded value: ${mib(totalEncoded)}`);

  const rows: [string, Snap][] = [
    ['empty db (after open)', base],
    ['+ data: store + value buf + key skiplist + dt(updatedAt,createdAt)', afterData],
    ['+ eq byWorkspace (low cardinality)', afterEqWs],
    ['+ eq byWorkDir (1000 distinct)', afterEqWd],
    ['+ compound byWsUpdated (skiplist/group)', afterCmpUpd],
    ['+ compound byWsCreated (skiplist/group)', afterCmpCrt],
    ['+ text body (postings + tf + docLen)', afterText],
  ];

  console.log('\n--- retained memory by stage ---');
  console.log('  stage                                            heap       external   rss        heap/doc');
  for (const [name, s] of rows) {
    const perDoc = s.heap / N;
    console.log(
      `  ${name.padEnd(46)} ${mib(s.heap).padStart(9)} ${mib(s.ext).padStart(10)} ${mib(s.rss).padStart(9)} ${fmt(perDoc | 0).padStart(8)} B`,
    );
  }

  console.log('\n--- per-component deltas (heap) ---');
  const deltas: [string, number][] = [
    ['base: store+value+key-skiplist+dt(2 cols)', afterData.heap - base.heap],
    ['eq byWorkspace', afterEqWs.heap - afterData.heap],
    ['eq byWorkDir', afterEqWd.heap - afterEqWs.heap],
    ['compound byWsUpdated', afterCmpUpd.heap - afterEqWd.heap],
    ['compound byWsCreated', afterCmpCrt.heap - afterCmpUpd.heap],
    ['text body', afterText.heap - afterCmpCrt.heap],
  ];
  let sum = 0;
  for (const [name, d] of deltas) {
    sum += d;
    console.log(`  ${name.padEnd(46)} ${mib(d).padStart(10)}  ${fmt((d / N) | 0).padStart(7)} B/doc  ${((d / afterText.heap) * 100).toFixed(1).padStart(5)}%`);
  }
  console.log(`  ${'external (value buffers, off-heap)'.padEnd(46)} ${mib(afterText.ext).padStart(10)}  ${fmt((afterText.ext / N) | 0).padStart(7)} B/doc`);

  console.log('\n--- text index shape ---');
  console.log(`  indexed docs (N)   : ${fmt(tfDocs)}`);
  console.log(`  unique terms       : ${fmt(postingsTerms)}`);
  console.log(`  postings entries   : ${fmt(postingsEntries)}  (${fmt(postingsEntries / N)} per doc)`);

  // ---- capacity projection ----
  const heapPerDoc = afterText.heap / N;
  const extPerDoc = afterText.ext / N;
  const totalPerDoc = heapPerDoc + extPerDoc;
  console.log('\n--- capacity projection (linear extrapolation) ---');
  console.log(`  on-heap per session : ${fmt(heapPerDoc | 0)} B`);
  console.log(`  external per session: ${fmt(extPerDoc | 0)} B`);
  console.log(`  total per session   : ${fmt(totalPerDoc | 0)} B  (heap + external)`);
  for (const budget of [1, 2, 4, 8, 16, 32]) {
    const bytes = budget * 1024 * 1024 * 1024;
    const maxSessions = Math.floor(bytes / totalPerDoc);
    const maxText = (maxSessions * (totalEncoded / N)) / 1048576;
    console.log(`  RAM ${String(budget).padStart(2)} GiB -> ~${fmt(maxSessions).padStart(12)} sessions  (~${fmt(maxText | 0).padStart(8)} MiB text)`);
  }

  await db.close();
  await fs.rm(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
