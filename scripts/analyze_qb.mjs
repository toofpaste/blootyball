import { createInitialGameState, stepGame, betweenPlays } from '../src/engine/state.js';

const targetPerRun = Number.parseInt(process.argv[2], 10) > 0
  ? Number.parseInt(process.argv[2], 10)
  : 120;
const runs = Number.parseInt(process.argv[3], 10) > 0
  ? Number.parseInt(process.argv[3], 10)
  : 1;

const totals = {
  passPlays: 0,
  completions: 0,
  incompletions: 0,
  throwaways: 0,
  interceptions: 0,
  sacks: 0,
  scrambles: 0,
  completionYards: [],
  scrambleYards: [],
};
const aggregateResults = new Map();

for (let run = 0; run < runs; run += 1) {
  let state = createInitialGameState();
  let passPlays = 0;
  while (passPlays < targetPerRun) {
    state = stepGame(state, 1 / 30);
    const play = state.play;
    if (!play) continue;
    if (play.phase === 'DEAD' && play.deadAt != null && play.elapsed > play.deadAt + 0.75) {
      const call = play.playCall || {};
      const result = play.resultWhy || 'Unknown';
      if (call.type === 'PASS') {
        passPlays += 1;
        totals.passPlays += 1;
        aggregateResults.set(result, (aggregateResults.get(result) || 0) + 1);

        const ball = play.ball || {};
        const qb = play.formation?.off?.QB;
        const qbIds = new Set([qb?.id, 'QB']);

        const prevLogLen = state.playLog?.length ?? 0;
        state = betweenPlays(state);
        const newEntry = (state.playLog && state.playLog.length > prevLogLen)
          ? state.playLog[state.playLog.length - 1]
          : null;
        const gained = typeof newEntry?.gained === 'number' ? newEntry.gained : null;

        if (!ball.carrierId) {
          if (result === 'Throw away') totals.throwaways += 1;
          else if (result === 'Incomplete') totals.incompletions += 1;
          else if (result === 'Interception') totals.interceptions += 1;
        } else if (qbIds.has(ball.carrierId)) {
          if (result === 'Sack') totals.sacks += 1;
          else {
            totals.scrambles += 1;
            if (gained != null) totals.scrambleYards.push(gained);
          }
        } else {
          totals.completions += 1;
          if (gained != null) totals.completionYards.push(gained);
        }
      } else {
        state = betweenPlays(state);
      }
    }
  }
}

const attempts = totals.passPlays - totals.sacks;
const completionPct = attempts > 0 ? (totals.completions / attempts) * 100 : 0;

console.log(`Simulated ${totals.passPlays} pass plays across ${runs} run(s) of ${targetPerRun}.`);
for (const [key, value] of [...aggregateResults.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${key}: ${value}`);
}
console.log('\nTotals:');
console.log(' Completions:', totals.completions);
console.log(' Incompletions:', totals.incompletions);
console.log(' Throwaways:', totals.throwaways);
console.log(' Interceptions:', totals.interceptions);
console.log(' Sacks:', totals.sacks);
console.log(' Scrambles:', totals.scrambles);
console.log(' Completion % (excludes sacks):', completionPct.toFixed(1));
if (runs > 1) {
  console.log(' Avg completions per run:', (totals.completions / runs).toFixed(2));
  console.log(' Avg incompletions per run:', (totals.incompletions / runs).toFixed(2));
}

if (totals.completionYards.length) {
  const avgGain = totals.completionYards.reduce((a, b) => a + b, 0) / totals.completionYards.length;
  console.log(' Avg yards per completion:', avgGain.toFixed(2));
}
if (totals.scrambleYards.length) {
  const avgScramble = totals.scrambleYards.reduce((a, b) => a + b, 0) / totals.scrambleYards.length;
  console.log(' Avg yards per scramble:', avgScramble.toFixed(2));
}
