import { createInitialGameState, progressOffseason, resumeAssignedMatchup, stepGame } from './state';
import { applyGameResultToSeason, createSeasonState } from './league';
import { TEAM_IDS } from './data/teamLibrary';

describe('progressOffseason', () => {
  test('createInitialGameState ignores stray playoff results from global state', () => {
    window.__blootyball = { games: [] };

    const straySeason = createSeasonState({ seasonConfig: { longSeason: false } });
    const targetIndex = 1;
    const baseGame = straySeason.schedule[targetIndex];
    const playoffResult = {
      gameId: 'PO01-SF2',
      index: targetIndex,
      homeTeamId: baseGame.homeTeam,
      awayTeamId: baseGame.awayTeam,
      score: {
        [baseGame.homeTeam]: 35,
        [baseGame.awayTeam]: 14,
      },
      winner: baseGame.homeTeam,
      tag: 'playoff-semifinal',
      playerStats: {},
      playerTeams: {},
      playLog: [],
    };
    straySeason.results = [playoffResult];
    straySeason.completedGames = straySeason.results.length;
    straySeason.schedule[targetIndex] = {
      ...baseGame,
      tag: 'playoff-semifinal',
      played: true,
      result: playoffResult,
    };
    straySeason.playoffBracket = {
      stage: 'semifinals',
      semifinalGames: [
        {
          index: targetIndex,
          homeTeam: baseGame.homeTeam,
          awayTeam: baseGame.awayTeam,
        },
      ],
    };
    straySeason.phase = 'semifinals';

    window.__blootyball.games.push({ state: { season: straySeason } });

    const state = createInitialGameState({
      assignmentOffset: 1,
      assignmentStride: 2,
      lockstepAssignments: true,
      seasonConfig: { longSeason: false },
    });

    const assignedIndex = state.season.assignmentOffset;
    const scheduledGame = state.season.schedule[assignedIndex];

    expect(state.season.results).toHaveLength(0);
    expect(scheduledGame.tag).toBe('regular-season');
    expect(scheduledGame.played).not.toBe(true);
    expect(state.season.playoffBracket).toBeNull();

    delete window.__blootyball;
  });

  test('restarts season when league has already advanced', () => {
    const primary = createInitialGameState({
      assignmentOffset: 0,
      assignmentStride: 2,
      lockstepAssignments: true,
    });
    const sharedLeague = primary.league;
    const secondary = createInitialGameState({
      assignmentOffset: 1,
      assignmentStride: 2,
      league: sharedLeague,
      lockstepAssignments: true,
    });

    const teamId = TEAM_IDS[0];
    secondary.season.teams[teamId].record.wins = 12;
    secondary.season.teams[teamId].pointsFor = 300;

    sharedLeague.offseason ||= {};
    sharedLeague.offseason.active = false;
    sharedLeague.offseason.nextSeasonReady = true;
    sharedLeague.offseason.nextSeasonStarted = true;
    sharedLeague.seasonNumber = (sharedLeague.seasonNumber || 1) + 1;

    const updated = progressOffseason(secondary);

    expect(updated).not.toBe(secondary);
    expect(updated.season.seasonNumber).toBe(sharedLeague.seasonNumber);
    expect(updated.season.currentGameIndex).toBe(1);
    expect(updated.season.teams[teamId].record.wins).toBe(0);
    expect(updated.season.teams[teamId].pointsFor).toBe(0);
  });

  test('both assignment slots resume play after inaugural offseason', () => {
    const slots = [
      createInitialGameState({ assignmentOffset: 0, assignmentStride: 2, lockstepAssignments: true }),
      createInitialGameState({ assignmentOffset: 1, assignmentStride: 2, lockstepAssignments: true }),
    ];

    slots.forEach((state) => {
      state.league.offseason.active = false;
      state.league.offseason.nextSeasonReady = true;
      state.league.offseason.nextSeasonStarted = false;
    });

    const progressed = slots.map((state) => progressOffseason(state));

    expect(progressed[0].matchup).not.toBeNull();
    expect(progressed[1].matchup).not.toBeNull();
  });

  test('new season resumes with regular games even if previous season semifinals remain in globals', () => {
    window.__blootyball = { games: [] };

    const primary = createInitialGameState({
      assignmentOffset: 0,
      assignmentStride: 2,
      lockstepAssignments: true,
    });
    const sharedLeague = primary.league;
    const secondary = createInitialGameState({
      assignmentOffset: 1,
      assignmentStride: 2,
      league: sharedLeague,
      lockstepAssignments: true,
    });

    const semifinalIndex = secondary.season.assignmentOffset;
    const baseSemifinal = secondary.season.schedule[semifinalIndex];
    const semifinalResult = {
      gameId: 'PO01-SF2',
      index: semifinalIndex,
      homeTeamId: baseSemifinal.homeTeam,
      awayTeamId: baseSemifinal.awayTeam,
      score: {
        [baseSemifinal.homeTeam]: 24,
        [baseSemifinal.awayTeam]: 14,
      },
      winner: baseSemifinal.homeTeam,
      tag: 'playoff-semifinal',
      playerStats: {},
      playerTeams: {},
      playLog: [],
    };
    secondary.season.results.push(semifinalResult);
    secondary.season.schedule[semifinalIndex] = {
      ...baseSemifinal,
      tag: 'playoff-semifinal',
      played: true,
      result: semifinalResult,
    };
    secondary.season.playoffBracket = {
      stage: 'semifinals',
      semifinalGames: [
        {
          index: semifinalIndex,
          homeTeam: baseSemifinal.homeTeam,
          awayTeam: baseSemifinal.awayTeam,
          winner: baseSemifinal.homeTeam,
        },
      ],
    };
    secondary.season.phase = 'semifinals';

    window.__blootyball.games[0] = { state: primary };
    window.__blootyball.games[1] = { state: secondary };

    sharedLeague.offseason ||= {};
    sharedLeague.offseason.active = false;
    sharedLeague.offseason.nextSeasonReady = true;
    sharedLeague.offseason.nextSeasonStarted = false;
    sharedLeague.offseason.completedSeasonNumber = primary.season.seasonNumber;
    sharedLeague.seasonNumber = primary.season.seasonNumber + 1;

    const restarted = progressOffseason(primary);
    window.__blootyball.games[0] = { state: restarted };

    const resumed = resumeAssignedMatchup(restarted);
    const firstGame = resumed.season.schedule[resumed.season.assignmentOffset];

    expect(resumed.matchup).not.toBeNull();
    expect(resumed.matchup.tag).not.toBe('playoff-semifinal');
    expect(firstGame.tag).not.toBe('playoff-semifinal');

    delete window.__blootyball;
  });

  test('clears stray playoff bracket when regular season games remain', () => {
    window.__blootyball = { games: [] };

    const state = createInitialGameState({
      assignmentOffset: 1,
      assignmentStride: 2,
      lockstepAssignments: true,
    });

    const strayChampion = state.season.schedule[0].homeTeam;
    state.season.playoffBracket = {
      stage: 'semifinals',
      semifinalGames: [
        {
          index: state.season.assignmentOffset,
          homeTeam: state.season.schedule[state.season.assignmentOffset].homeTeam,
          awayTeam: state.season.schedule[state.season.assignmentOffset].awayTeam,
        },
      ],
      seeds: [],
    };
    state.season.phase = 'semifinals';
    state.season.championTeamId = strayChampion;
    state.season.championResult = { winner: strayChampion, tag: 'playoff-semifinal' };

    window.__blootyball.games.push({ state });

    const resumed = resumeAssignedMatchup(state);

    expect(resumed.season.playoffBracket).toBeNull();
    expect(resumed.season.phase).toBe('regular');
    expect(resumed.season.championTeamId).toBeNull();
    expect(resumed.season.championResult).toBeNull();
    expect(resumed.matchup).not.toBeNull();
    expect(resumed.matchup.tag).toBe('regular-season');

    delete window.__blootyball;
  });
});

describe('resumeAssignedMatchup', () => {
  afterEach(() => {
    if (window.__blootyball) {
      delete window.__blootyball;
    }
  });

  test('schedules semifinals once all assignment slots finish the regular season', () => {
    window.__blootyball = { games: [] };

    const slots = [
      createInitialGameState({
        assignmentOffset: 0,
        assignmentStride: 2,
        lockstepAssignments: true,
        seasonConfig: { longSeason: false },
      }),
      createInitialGameState({
        assignmentOffset: 1,
        assignmentStride: 2,
        lockstepAssignments: true,
        seasonConfig: { longSeason: false },
      }),
    ];

    slots.forEach((state, index) => {
      const stride = state.season.assignmentStride;
      const offset = state.season.assignmentOffset;

      for (let idx = offset; idx < state.season.schedule.length; idx += stride) {
        const game = state.season.schedule[idx];
        if (!game || String(game.tag || '').startsWith('playoff')) continue;
        const scores = {
          [game.homeTeam]: 31,
          [game.awayTeam]: 17,
        };
        state.season.currentGameIndex = idx;
        state.season = applyGameResultToSeason(state.season, game, scores, {}, {}, []);
      }

      state.matchup = null;
      state.pendingMatchup = null;
      state.awaitingNextMatchup = false;
      state.gameComplete = true;
      state.clock.running = false;
      state.season.currentGameIndex = state.season.schedule.length;

      window.__blootyball.games[index] = { state };
    });

    const slotOneResumed = resumeAssignedMatchup(slots[1]);
    window.__blootyball.games[1] = { state: slotOneResumed };

    const resumed = resumeAssignedMatchup(slots[0]);

    expect(slotOneResumed.gameComplete).toBe(false);
    expect(slotOneResumed.matchup).not.toBeNull();
    expect(slotOneResumed.matchup.tag).toBe('playoff-semifinal');

    expect(resumed.gameComplete).toBe(false);
    expect(resumed.matchup).not.toBeNull();
    expect(resumed.matchup.tag).toBe('playoff-semifinal');
    expect(resumed.season.phase).toBe('semifinals');
  });

  test('does not resume play while offseason is active', () => {
    const state = createInitialGameState({ assignmentOffset: 0, assignmentStride: 2, lockstepAssignments: true });
    state.league.offseason.active = true;
    state.league.offseason.nextSeasonStarted = false;
    state.league.offseason.completedSeasonNumber = state.season.seasonNumber;
    state.season.phase = 'complete';
    state.gameComplete = true;

    const resumed = resumeAssignedMatchup(state);

    expect(resumed).toBe(state);
  });

  test('restarts season when league season number has advanced', () => {
    const state = createInitialGameState({ assignmentOffset: 1, assignmentStride: 2, lockstepAssignments: true });
    state.league.offseason.active = false;
    state.league.offseason.nextSeasonReady = true;
    state.league.offseason.nextSeasonStarted = true;
    state.league.offseason.completedSeasonNumber = state.season.seasonNumber;
    state.league.seasonNumber = (state.league.seasonNumber || state.season.seasonNumber) + 1;

    const resumed = resumeAssignedMatchup(state);

    expect(resumed).not.toBe(state);
    expect(resumed.season.seasonNumber).toBe(state.league.seasonNumber);
    expect(resumed.matchup).not.toBeNull();
    expect(resumed.matchup.tag).toBe('regular-season');
  });

  test('restarts season when a parallel slot has already advanced', () => {
    window.__blootyball = { games: [] };

    const advanced = createInitialGameState({
      assignmentOffset: 0,
      assignmentStride: 2,
      lockstepAssignments: true,
    });
    const stale = createInitialGameState({
      assignmentOffset: 1,
      assignmentStride: 2,
      lockstepAssignments: true,
    });

    advanced.season.seasonNumber += 1;
    advanced.league.seasonNumber = advanced.season.seasonNumber;
    advanced.league.offseason.active = false;
    advanced.league.offseason.nextSeasonReady = true;
    advanced.league.offseason.nextSeasonStarted = true;
    advanced.league.offseason.completedSeasonNumber = advanced.season.seasonNumber - 1;

    stale.season.phase = 'semifinals';
    stale.matchup = null;
    stale.pendingMatchup = null;
    stale.gameComplete = true;

    window.__blootyball.games[0] = { state: advanced };
    window.__blootyball.games[1] = { state: stale };

    const resumed = resumeAssignedMatchup(stale);

    expect(resumed).not.toBe(stale);
    expect(resumed.season.seasonNumber).toBe(advanced.season.seasonNumber);
    expect(resumed.matchup).not.toBeNull();
    expect(resumed.matchup.tag).toBe('regular-season');
    expect(resumed.season.phase).toBe('regular');
  });
});

describe('stepGame', () => {
  test('halts simulation during the offseason', () => {
    const state = createInitialGameState({ assignmentOffset: 0, assignmentStride: 2, lockstepAssignments: true });
    state.league.offseason.active = true;
    state.league.offseason.nextSeasonStarted = false;
    state.league.offseason.completedSeasonNumber = state.season.seasonNumber;
    state.season.phase = 'complete';
    state.gameComplete = true;

    const progressed = stepGame(state, 1);

    expect(progressed).toBe(state);
  });
});
