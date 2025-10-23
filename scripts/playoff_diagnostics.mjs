// Usage: node --experimental-loader ./scripts/js-ext-loader.mjs scripts/playoff_diagnostics.mjs [--long] [--favor-seeds]

const constantsModule = await import('../src/engine/constants.js');
const { TEAM_RED, TEAM_BLK } =
  constantsModule?.TEAM_RED && constantsModule?.TEAM_BLK
    ? constantsModule
    : constantsModule?.default || {};

if (!TEAM_RED || !TEAM_BLK) {
  throw new Error('Failed to load team constants for playoff diagnostics');
}
const leagueModule = await import('../src/engine/league.js');
const {
  applyGameResultToSeason,
  createSeasonState,
  ensureChampionshipScheduled,
  ensurePlayoffsScheduled,
  registerChampion,
} =
  leagueModule?.applyGameResultToSeason && leagueModule?.createSeasonState
    ? leagueModule
    : leagueModule?.default || {};

if (!applyGameResultToSeason || !createSeasonState) {
  throw new Error('Failed to load league engine helpers for playoff diagnostics');
}

const argv = process.argv.slice(2);
const longSeason = argv.includes('--long') || argv.includes('--long-season');
const favorTopSeeds = argv.includes('--favor-seeds');

const seasonConfig = { longSeason };
let season = createSeasonState({ seasonConfig });

const tagLabel = (game) => {
  if (!game) return 'Unknown';
  if (game.tag === 'playoff-semifinal') return `Semifinal ${game.meta?.order ?? ''}`.trim();
  if (game.tag === 'playoff-championship') return 'Championship';
  if (game.week != null) return `Week ${game.week}`;
  return game.tag || `Game ${game.index ?? ''}`.trim();
};

const regularGames = season.schedule.filter((game) => game && !String(game.tag || '').startsWith('playoff'));
console.log('[PlayoffDiag] ----------------------------------------');
console.log(`[PlayoffDiag] Season ${season.seasonNumber} | longSeason=${longSeason}`);
console.log(`[PlayoffDiag] Regular season games: ${regularGames.length} (weeks: ${season.regularSeasonWeeks})`);

regularGames.forEach((game, idx) => {
  const homeFavored = idx % 2 === 0;
  const scores = {
    [TEAM_RED]: homeFavored ? 31 : 17,
    [TEAM_BLK]: homeFavored ? 17 : 31,
  };
  season = applyGameResultToSeason(season, game, scores, {}, {}, []);
  const added = ensurePlayoffsScheduled(season, null);
  if (added.length) {
    console.log(`[PlayoffDiag] Scheduled semifinals after ${tagLabel(game)} -> indices [${added.join(', ')}]`);
  }
});

if (!season.playoffBracket || season.playoffBracket.stage !== 'semifinals') {
  console.log('[PlayoffDiag] Semifinals did not schedule. Current phase:', season.phase);
  process.exit(0);
}

console.log('[PlayoffDiag] Semifinal seeds:', season.playoffBracket.seeds);
season.playoffBracket.semifinalGames.forEach((game) => {
  console.log(
    `[PlayoffDiag] Semifinal slot ${game.order ?? game.slot + 1}: ${game.homeTeam} vs ${game.awayTeam} (index ${game.index})`,
  );
});

const semifinalSchedule = season.schedule
  .filter((game) => game?.tag === 'playoff-semifinal')
  .sort((a, b) => a.index - b.index);

semifinalSchedule.forEach((game, idx) => {
  const bracketEntry = season.playoffBracket.semifinalGames.find((entry) => entry.index === game.index) || {};
  const seeds = Array.isArray(bracketEntry.meta?.seeds) ? bracketEntry.meta.seeds : [];
  const higherSeedIsHome = seeds.length === 2 ? seeds[0] < seeds[1] : true;
  const homeShouldWin = favorTopSeeds ? higherSeedIsHome : idx % 2 === 0;
  const scores = {
    [TEAM_RED]: homeShouldWin ? 35 : 20,
    [TEAM_BLK]: homeShouldWin ? 20 : 35,
  };
  season = applyGameResultToSeason(season, game, scores, {}, {}, []);
  const updated = season.playoffBracket.semifinalGames.find((entry) => entry.index === game.index);
  console.log(
    `[PlayoffDiag] Completed ${tagLabel(game)} -> winner ${updated?.winner ?? 'unknown'} (seeds ${seeds.join('v') || 'n/a'})`,
  );
});

const finalsIndices = ensureChampionshipScheduled(season);
if (finalsIndices.length) {
  console.log(`[PlayoffDiag] Championship scheduled at indices [${finalsIndices.join(', ')}]`);
}

const championshipInfo = season.playoffBracket.championshipGame || null;
if (!championshipInfo) {
  console.log('[PlayoffDiag] Championship not scheduled yet. Phase:', season.phase);
  process.exit(0);
}

const championshipGame = season.schedule[championshipInfo.index];
const topSeed = season.playoffBracket.seeds[0];
const homeIsTopSeed = championshipGame?.homeTeam === topSeed;
const homeShouldWin = favorTopSeeds ? homeIsTopSeed : true;
const titleScores = {
  [TEAM_RED]: homeShouldWin ? 38 : 24,
  [TEAM_BLK]: homeShouldWin ? 24 : 38,
};
season = applyGameResultToSeason(season, championshipGame, titleScores, {}, {}, []);
const finalResult = season.schedule[championshipInfo.index]?.result || null;
registerChampion(season, null, finalResult);

console.log(
  `[PlayoffDiag] Championship complete -> winner ${finalResult?.winner ?? 'unknown'} | phase=${season.phase} | bracketStage=${season.playoffBracket?.stage}`,
);
console.log('[PlayoffDiag] ----------------------------------------');
