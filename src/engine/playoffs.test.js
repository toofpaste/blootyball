import { TEAM_RED, TEAM_BLK } from './constants';
import { TEAM_IDS } from './data/teamLibrary';
import {
  advanceSeasonPointer,
  applyGameResultToSeason,
  createSeasonState,
  ensureChampionshipScheduled,
  ensurePlayoffsScheduled,
} from './league';

const markRegularSeasonComplete = (season) => {
  season.schedule = season.schedule.map((game, idx) => ({
    ...game,
    index: idx,
    played: true,
  }));
};

const regularSeasonWeekCount = (season) => {
  if (!season) return 0;
  if (Number.isFinite(season.regularSeasonWeeks) && season.regularSeasonWeeks > 0) {
    return season.regularSeasonWeeks;
  }
  const schedule = Array.isArray(season.schedule) ? season.schedule : [];
  const weeks = schedule
    .filter((game) => game && !String(game.tag || '').startsWith('playoff'))
    .map((game) => (Number.isFinite(game.week) ? game.week : null))
    .filter((week) => week != null);
  return weeks.length ? Math.max(...weeks) : 0;
};

describe('postseason scheduling', () => {
  test('semifinal games keep assignment stride and occupy separate slots', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    expect(season.assignmentStride).toBe(2);
    expect(season.assignment.stride).toBe(2);
    expect(season.phase).toBe('semifinals');

    const lastTwo = season.schedule.slice(-2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[0].slot).not.toBe(lastTwo[1].slot);
    expect(new Set(lastTwo.map((game) => game.slot))).toEqual(new Set([0, 1]));
  });

  test('semifinals align to assignment stride even when stride exceeds semifinal slots', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 4;
    season.assignment = { stride: 4, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.filter((game) => game?.tag === 'playoff-semifinal');
    expect(semifinalGames).toHaveLength(2);
    const [firstSemifinal, secondSemifinal] = semifinalGames.sort((a, b) => a.index - b.index);

    expect((firstSemifinal.index - season.assignmentOffset) % season.assignmentStride).toBe(0);
    expect(secondSemifinal.index).toBe(firstSemifinal.index + 1);
    expect(firstSemifinal.index).toBeGreaterThanOrEqual(season.regularSeasonLength);
  });

  test('existing semifinal bracket entries realign to assignment stride slots', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 4;
    season.assignment = { stride: 4, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const scheduledSemis = season.schedule
      .filter((game) => game?.tag === 'playoff-semifinal')
      .sort((a, b) => a.index - b.index);

    const originalFirstIndex = scheduledSemis[0].index;
    const originalSecondIndex = scheduledSemis[1].index;

    const misalignedFirstIndex = originalFirstIndex - 2;
    const misalignedSecondIndex = originalSecondIndex - 2;

    season.schedule[misalignedFirstIndex] = { ...scheduledSemis[0], index: misalignedFirstIndex };
    season.schedule[misalignedSecondIndex] = { ...scheduledSemis[1], index: misalignedSecondIndex };
    season.schedule[originalFirstIndex] = null;
    season.schedule[originalSecondIndex] = null;
    season.playoffBracket.semifinalGames[0].index = misalignedFirstIndex;
    season.playoffBracket.semifinalGames[1].index = misalignedSecondIndex;

    const aligned = ensurePlayoffsScheduled(season, null);

    const realignedSemis = season.schedule
      .filter((game) => game?.tag === 'playoff-semifinal')
      .sort((a, b) => a.index - b.index);

    expect(realignedSemis).toHaveLength(2);
    expect((realignedSemis[0].index - season.assignmentOffset) % season.assignmentStride).toBe(0);
    expect(realignedSemis[1].index).toBe(realignedSemis[0].index + 1);
    expect(realignedSemis[0].index).toBeGreaterThan(misalignedFirstIndex);
    expect(aligned).toEqual(realignedSemis.map((game) => game.index));
  });

  test('semifinals wait until regular season games finish before scheduling', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    season.schedule = season.schedule.map((game, idx) => ({
      ...game,
      index: idx,
      played: idx < season.schedule.length - 1,
    }));

    const firstAttempt = ensurePlayoffsScheduled(season, null);

    expect(firstAttempt).toHaveLength(0);
    expect(season.playoffBracket).toBeNull();
    expect(season.phase).toBe('regular');

    const lastIndex = season.schedule.length - 1;
    season.schedule[lastIndex] = { ...season.schedule[lastIndex], played: true };

    const scheduled = ensurePlayoffsScheduled(season, null);

    expect(scheduled).toHaveLength(2);
    expect(season.playoffBracket).not.toBeNull();
    expect(season.playoffBracket.stage).toBe('semifinals');
    expect(season.phase).toBe('semifinals');

    const semifinalGames = season.schedule.filter((game) => game?.tag === 'playoff-semifinal');
    expect(semifinalGames).toHaveLength(2);
    const expectedWeek = regularSeasonWeekCount(season);
    semifinalGames.forEach((game) => {
      expect(game.week).toBe(expectedWeek + 1);
    });
  });

  test('parallel assignments reuse semifinal slots without reviving regular games', () => {
    const primary = createSeasonState({ seasonConfig: { longSeason: false } });
    primary.assignmentStride = 2;
    primary.assignment = { stride: 2, offset: 0, totalGames: 0 };
    primary.assignmentOffset = 0;
    markRegularSeasonComplete(primary);

    const primaryAdded = ensurePlayoffsScheduled(primary, null);

    expect(primaryAdded).toHaveLength(2);

    const secondary = createSeasonState({ seasonConfig: { longSeason: false } });
    secondary.assignmentStride = 2;
    secondary.assignment = { stride: 2, offset: 1, totalGames: 0 };
    secondary.assignmentOffset = 1;
    markRegularSeasonComplete(secondary);

    secondary.playoffBracket = JSON.parse(JSON.stringify(primary.playoffBracket));
    secondary.regularSeasonStandings = primary.regularSeasonStandings?.slice() || null;

    const secondaryAdded = ensurePlayoffsScheduled(secondary, null);

    const primaryIndices = primary.playoffBracket.semifinalGames.map((game) => game.index);
    expect(secondaryAdded).toEqual(primaryIndices);

    const secondarySemis = secondary.schedule
      .filter((game) => game?.tag === 'playoff-semifinal')
      .sort((a, b) => a.index - b.index);

    expect(secondarySemis).toHaveLength(2);
    expect(secondarySemis.map((game) => game.index)).toEqual(primaryIndices);

    const lingeringRegular = secondary.schedule.filter(
      (game, idx) => game && !String(game.tag || '').startsWith('playoff') && !game.played && idx >= secondary.regularSeasonLength,
    );
    expect(lingeringRegular).toHaveLength(0);
  });

  test('top four seeds pair off 1v4 and 2v3 in semifinals', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });

    markRegularSeasonComplete(season);

    const rankingOrder = TEAM_IDS.slice(0, 6);
    rankingOrder.forEach((teamId, idx) => {
      season.teams[teamId].record = { wins: 10 - idx, losses: idx, ties: 0 };
      season.teams[teamId].pointsFor = 300 - idx * 10;
      season.teams[teamId].pointsAgainst = 200 + idx * 5;
    });

    const scheduled = ensurePlayoffsScheduled(season, null);

    expect(scheduled).toHaveLength(2);
    expect(season.playoffBracket.stage).toBe('semifinals');

    const seeds = season.playoffBracket.seeds.slice(0, 4);
    expect(seeds).toEqual(rankingOrder.slice(0, 4));

    const [firstSemifinal, secondSemifinal] = season.playoffBracket.semifinalGames
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    expect(firstSemifinal.homeTeam).toBe(seeds[0]);
    expect(firstSemifinal.awayTeam).toBe(seeds[3]);
    expect(firstSemifinal.meta?.seeds).toEqual([1, 4]);

    expect(secondSemifinal.homeTeam).toBe(seeds[1]);
    expect(secondSemifinal.awayTeam).toBe(seeds[2]);
    expect(secondSemifinal.meta?.seeds).toEqual([2, 3]);

    const semifinalSchedule = season.schedule
      .filter((game) => game?.tag === 'playoff-semifinal')
      .sort((a, b) => a.index - b.index);

    expect(semifinalSchedule).toHaveLength(2);
    expect(semifinalSchedule[0].homeTeam).toBe(seeds[0]);
    expect(semifinalSchedule[0].awayTeam).toBe(seeds[3]);
    expect(semifinalSchedule[1].homeTeam).toBe(seeds[1]);
    expect(semifinalSchedule[1].awayTeam).toBe(seeds[2]);
  });

  test('championship schedules after both semifinals complete without changing stride', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.slice(-2);

    semifinalGames.forEach((game) => {
      const scores = {
        [TEAM_RED]: 28,
        [TEAM_BLK]: 14,
      };
      season = applyGameResultToSeason(season, game, scores, {}, {}, []);
    });

    const championshipIndex = season.playoffBracket.championshipGame?.index;
    expect(championshipIndex).toBeDefined();

    const championship = season.schedule[championshipIndex];

    expect(championship.slot).toBe(0);
    expect(season.assignmentStride).toBe(2);
    expect(season.assignment.stride).toBe(2);
    expect(season.playoffBracket.stage).toBe('championship');
    expect(season.phase).toBe('championship');
    expect(championship.week).toBe(regularSeasonWeekCount(season) + 2);

    expect(ensureChampionshipScheduled(season)).toHaveLength(0);
  });

  test('season pointer advances to remaining semifinal before ending postseason', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.slice(-2);
    const firstSemifinal = semifinalGames[0];
    const secondSemifinal = semifinalGames[1];

    season.currentGameIndex = firstSemifinal.index;

    season = applyGameResultToSeason(
      season,
      firstSemifinal,
      { [TEAM_RED]: 31, [TEAM_BLK]: 14 },
      {},
      {},
      [],
    );

    const nextMatchup = advanceSeasonPointer(season);

    expect(season.playoffBracket.stage).toBe('semifinals');
    expect(season.currentGameIndex).toBe(secondSemifinal.index);
    expect(nextMatchup).not.toBeNull();
    expect(nextMatchup.tag).toBe('playoff-semifinal');
    expect(season.schedule[secondSemifinal.index].played).not.toBe(true);
  });

  test('championship aligns with assignment offset for secondary slot', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 1, totalGames: 0 };
    season.assignmentOffset = 1;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.slice(-2);

    semifinalGames.forEach((game) => {
      const scores = {
        [TEAM_RED]: 35,
        [TEAM_BLK]: 21,
      };
      season = applyGameResultToSeason(season, game, scores, {}, {}, []);
    });

    const lastSemifinal = semifinalGames[1];
    season.currentGameIndex = lastSemifinal.index + season.assignmentStride;

    const championshipIndex = season.playoffBracket.championshipGame?.index;
    expect(championshipIndex).toBeDefined();
    expect((championshipIndex - season.assignmentOffset) % season.assignmentStride).toBe(0);
    expect(season.schedule[championshipIndex]).toBeDefined();
    expect(season.schedule[championshipIndex].tag).toBe('playoff-championship');

    expect(ensureChampionshipScheduled(season)).toHaveLength(0);
  });

  test('championship waits until assignment offset when pointer trails offset', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 6, totalGames: 0 };
    season.assignmentOffset = 6;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.slice(-2);

    semifinalGames.forEach((game) => {
      const scores = {
        [TEAM_RED]: 42,
        [TEAM_BLK]: 21,
      };
      season = applyGameResultToSeason(season, game, scores, {}, {}, []);
    });

    season.currentGameIndex = 0;

    const championshipIndex = season.playoffBracket.championshipGame?.index;

    expect(championshipIndex).toBeDefined();

    expect(championshipIndex).toBeGreaterThanOrEqual(season.assignmentOffset);
    expect((championshipIndex - season.assignmentOffset) % season.assignmentStride).toBe(0);
    expect(season.schedule[championshipIndex].tag).toBe('playoff-championship');

    expect(ensureChampionshipScheduled(season)).toHaveLength(0);
  });

  test('advanceSeasonPointer skips placeholder slots to reach championship', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 6, totalGames: 0 };
    season.assignmentOffset = 6;

    markRegularSeasonComplete(season);

    ensurePlayoffsScheduled(season, null);

    const semifinalGames = season.schedule.slice(-2);
    const [firstSemifinal, secondSemifinal] = semifinalGames;

    season.currentGameIndex = firstSemifinal.index;
    season = applyGameResultToSeason(
      season,
      firstSemifinal,
      { [TEAM_RED]: 31, [TEAM_BLK]: 17 },
      {},
      {},
      [],
    );

    season.currentGameIndex = secondSemifinal.index;
    season = applyGameResultToSeason(
      season,
      secondSemifinal,
      { [TEAM_RED]: 24, [TEAM_BLK]: 21 },
      {},
      {},
      [],
    );

    const championshipIndex = season.playoffBracket.championshipGame?.index;
    expect(championshipIndex).toBeGreaterThanOrEqual(season.assignmentOffset);

    season.currentGameIndex = secondSemifinal.index;
    const nextMatchup = advanceSeasonPointer(season);

    expect(nextMatchup).not.toBeNull();
    expect(nextMatchup.tag).toBe('playoff-championship');
    expect(season.currentGameIndex).toBe(championshipIndex);
  });
});

describe('season records', () => {
  test('regular season and postseason records are tracked separately', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    const teamA = TEAM_IDS[0];
    const teamB = TEAM_IDS[1];
    const teamGames = season.schedule.filter(
      (game) => game.homeTeam === teamA || game.awayTeam === teamA,
    ).slice(0, 4);

    let workingSeason = season;
    teamGames.forEach((game) => {
      const scores = {
        [TEAM_RED]: game.homeTeam === teamA ? 31 : 17,
        [TEAM_BLK]: game.homeTeam === teamA ? 17 : 31,
      };
      workingSeason = applyGameResultToSeason(workingSeason, game, scores, {}, {}, []);
    });

    const playoffGame = {
      id: 'UNIT-PO',
      homeTeam: teamA,
      awayTeam: teamB,
      tag: 'playoff-semifinal',
      round: 'Unit Test Semifinal',
      index: workingSeason.schedule.length,
    };
    const playoffScores = { [TEAM_RED]: 24, [TEAM_BLK]: 21 };
    workingSeason = applyGameResultToSeason(workingSeason, playoffGame, playoffScores, {}, {}, []);

    const regularRecord = workingSeason.teams[teamA].record;
    const postseasonRecord = workingSeason.teams[teamA].postseasonRecord;

    expect(regularRecord.wins + regularRecord.losses + regularRecord.ties).toBe(4);
    expect(postseasonRecord.wins + postseasonRecord.losses + postseasonRecord.ties).toBe(1);
  });
});
