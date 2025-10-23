import { TEAM_RED, TEAM_BLK } from './constants';
import { TEAM_IDS } from './data/teamLibrary';
import {
  advanceSeasonPointer,
  applyGameResultToSeason,
  createSeasonState,
  ensureChampionshipScheduled,
  ensurePlayoffsScheduled,
} from './league';

describe('postseason scheduling', () => {
  test('semifinal games keep assignment stride and occupy separate slots', () => {
    const season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

    ensurePlayoffsScheduled(season, null);

    expect(season.assignmentStride).toBe(2);
    expect(season.assignment.stride).toBe(2);

    const lastTwo = season.schedule.slice(-2);
    expect(lastTwo).toHaveLength(2);
    expect(lastTwo[0].slot).not.toBe(lastTwo[1].slot);
    expect(new Set(lastTwo.map((game) => game.slot))).toEqual(new Set([0, 1]));
  });

  test('championship schedules after both semifinals complete without changing stride', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

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

    expect(ensureChampionshipScheduled(season)).toHaveLength(0);
  });

  test('season pointer advances to remaining semifinal before ending postseason', () => {
    let season = createSeasonState({ seasonConfig: { longSeason: false } });
    season.assignmentStride = 2;
    season.assignment = { stride: 2, offset: 0, totalGames: 0 };
    season.assignmentOffset = 0;

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
