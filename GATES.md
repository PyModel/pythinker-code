# Gates: upstream-reconcile free-row sweep

OWNS: packages/**, apps/**, docs/**, .changeset/**

Summary: Every free non-blocked reference commit through frozen prior buckets is terminal in the private ledger (ADAPTED/APPLIED/ALREADY_PRESENT/SKIPPED_*), engine/web/vendor-blocked rows are explicitly deferred, verification gates for adapted work pass, and leak/managed checks do not regress.

- [ ] G1: No open-item row remains in pending state (each is adapted, skipped, deferred, or wave-blocked)
  CHECK: node -e 'const fs=require("fs"); const t=fs.readFileSync("context.local.md","utf8"); const section=t.split("### Open items")[1]?.split("### ")[0]||""; const pending=[...section.matchAll(/^\| `([a-f0-9]+)` \|[^|\n]+\| `pending` \|/gm)].map(m=>m[1]); if(pending.length){console.error("STILL_PENDING "+pending.join(",")); process.exit(1);} console.log("free-row triage complete");'
  EXPECT: /^free-row triage complete$/m
  EVIDENCE: pending

- [x] G2: Latest adapted task-silence and session-delete commits remain on local main
  CHECK: git merge-base --is-ancestor fbe5911aa HEAD && git merge-base --is-ancestor 44806e12a HEAD && git rev-parse --abbrev-ref HEAD | grep -qx main && echo ancestors-on-main
  EXPECT: /^ancestors-on-main$/m
  EVIDENCE: automatic-evidence=v1; definition-sha256=dc78143baa7abbde4d21eab1badb244a3a260548538cc99d069e38e0937554e8; exit=0; EXPECT=matched; output-sha256=8caa62d91cce9125baf653985de29ad538e1fcd14aa7abb41a32afa59e0e7edd; output-bytes=18; shell=/bin/sh; cwd=.; path=b74b2630471d/35 entries

- [x] G3: Leak check A-D pass and F/G count does not exceed the main baseline of 1
  CHECK: bash .claude/skills/upstream-reconcile/leak-check.sh main 2>&1 | tee /tmp/leak-unlazy.log; node -e "const t=require('fs').readFileSync('/tmp/leak-unlazy.log','utf8'); const a=/-- A: PASS/.test(t)&&/-- B: PASS/.test(t)&&/-- C: PASS/.test(t)&&/-- D: PASS/.test(t); const f=(t.match(/-- F: FAIL \((\d+)\)/)||[])[1]; const g=(t.match(/-- G: FAIL \((\d+)\)/)||[])[1]; if(!a) process.exit(1); if(Number(f)>1||Number(g)>1) process.exit(1); console.log('leak-bounds-ok');"
  EXPECT: /^leak-bounds-ok$/m
  EVIDENCE: automatic-evidence=v1; definition-sha256=7b9081353d2d92945c138eb80a3541b30367cf98ca557d7092332a2bf61c1463; exit=0; EXPECT=matched; output-sha256=7a0c8291f9f22f2c56e46b371116cb96598c6bb8949e3d8e0203c40e73e6a8c0; output-bytes=1161; shell=/bin/sh; cwd=.; path=b74b2630471d/35 entries; inputs=.claude/skills/upstream-reconcile/leak-check.sh@85b0447bf417

- [x] G4: Managed-service strip check passes
  CHECK: node .claude/skills/upstream-reconcile/upstream-sync/check-managed.mjs && echo managed-ok
  EXPECT: /^managed-ok$/m
  EVIDENCE: automatic-evidence=v1; definition-sha256=a4272fb33c2c26a8a8051cb6195478ff79671df575ff7ff6403a57731c49f718; exit=0; EXPECT=matched; output-sha256=f599eb8068c90285b8dc35fb26bd1958d25979eb7077dea676796721583b3be0; output-bytes=29; shell=/bin/sh; cwd=.; path=b74b2630471d/35 entries; inputs=.claude/skills/upstream-reconcile/upstream-sync/check-managed.mjs@3178737a0d52

- [x] G5: Agent-core and gateway typecheck clean after the sweep
  CHECK: export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null; pnpm --filter @pymodel/agent-core-v2 exec tsc -p tsconfig.json --noEmit && pnpm --filter @pymodel/agent-gateway exec tsc -p tsconfig.json --noEmit && echo tsc-ok
  EXPECT: /^tsc-ok$/m
  EVIDENCE: automatic-evidence=v1; definition-sha256=1fffe446991363785110d2618789f094b37c546c8c919698e61090ee0d5ef926; exit=0; EXPECT=matched; output-sha256=6d297bcc257013119fae8923d0daeb3059368aeba8e2c7dc076af416f44bebfe; output-bytes=7; shell=/bin/sh; cwd=.; path=b74b2630471d/35 entries
