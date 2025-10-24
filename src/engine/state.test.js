import { createInitialGameState, progressOffseason, resumeAssignedMatchup, stepGame } from './state';
import { applyGameResultToSeason } from './league';
import { TEAM_IDS } from './data/teamLibrary';

describe('progressOffseason', () => {
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

  test('returns original state when league season number has advanced', () => {
    const state = createInitialGameState({ assignmentOffset: 1, assignmentStride: 2, lockstepAssignments: true });
    state.league.offseason.active = false;
    state.league.offseason.nextSeasonReady = true;
    state.league.offseason.nextSeasonStarted = true;
    state.league.offseason.completedSeasonNumber = state.season.seasonNumber;
    state.league.seasonNumber = (state.league.seasonNumber || state.season.seasonNumber) + 1;

    const resumed = resumeAssignedMatchup(state);

    expect(resumed).toBe(state);
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
