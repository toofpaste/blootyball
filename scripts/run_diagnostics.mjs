import { createInitialGameState, stepGame, betweenPlays } from '../src/engine/state.js';
import { summarizeDiagnostics } from '../src/engine/diagnostics.js';

const targetPlays = Number.parseInt(process.argv[2], 10) > 0
  ? Number.parseInt(process.argv[2], 10)
  : 20;

let state = createInitialGameState();
let completed = 0;
const dt = 1 / 30;

while (completed < targetPlays) {
  state = stepGame(state, dt);
  const play = state.play;
  if (!play) continue;
  if (play.phase === 'DEAD' && play.deadAt != null && play.elapsed > play.deadAt + 0.75) {
    const prevLog = state.playLog.length;
    state = betweenPlays(state);
    if (state.playLog.length > prevLog) completed += 1;
  }
}

const summary = summarizeDiagnostics(state, targetPlays);

console.log(`Diagnosed last ${summary.plays.length} play(s):`);
console.log(JSON.stringify(summary.totals, null, 2));
console.log('\nRecent play breakdown:');
for (const play of summary.plays) {
  const lastEvent = play.events[play.events.length - 1];
  const result = play.summary?.result || lastEvent?.type || 'Unknown';
  const gained = play.summary?.gained;
  console.log(`#${play.id} ${play.call} — ${result}${typeof gained === 'number' ? ` (${gained} yds)` : ''}`);
  const warnings = play.events.filter(evt => evt.type === 'ball:lost-carrier');
  if (warnings.length) {
    console.log('  ⚠️ Lost carrier warnings:', warnings.length);
  }
}
