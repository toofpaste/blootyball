import { createInitialGameState, progressOffseason } from './state';
import { TEAM_IDS } from './constants';

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
});
