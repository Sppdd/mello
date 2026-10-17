// Runs the live AI checks against Nebius Token Factory and exits non-zero if any fail.
//   npm run live-test -w @mello/api
import { runLiveTest } from '../src/liveTest.ts';

const r = await runLiveTest();
console.log(`Nemotron on ${r.baseUrl}\n  fast: ${r.models.fast}\n  agent: ${r.models.agent}\n  reasoning: ${r.models.reasoning}\n`);
for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(42)} ${String(c.ms).padStart(6)} ms  ${c.detail}`);
console.log(`\n${r.ok ? 'All checks passed.' : 'Some checks failed.'}`);
process.exit(r.ok ? 0 : 1);
