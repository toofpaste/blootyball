import { combineSeasonSnapshots } from './App';

function createSchedule(length = 4) {
  return Array.from({ length }).map((_, index) => ({
    id: `G${String(index + 1).padStart(3, '0')}`,
    index,
    homeTeam: `T${(index * 2) % 8}`,
    awayTeam: `T${(index * 2 + 1) % 8}`,
    tag: 'regular-season',
  }));
}

function createSeasonSnapshot({
  seasonNumber,
  assignmentOffset = 0,
  currentGameIndex = 0,
  results = [],
  scheduleLength = 4,
}) {
  const schedule = createSchedule(scheduleLength);
  return {
    label: `Slot ${assignmentOffset}`,
    season: {
      seasonNumber,
      teams: {},
      schedule,
      regularSeasonLength: schedule.length,
      currentGameIndex,
      completedGames: results.length,
      results,
      playerStats: {},
      assignmentTotals: {},
      assignmentStride: 2,
      assignmentOffset,
      assignmentTotalGames: Math.max(0, Math.ceil((schedule.length - assignmentOffset) / 2)),
      playerDevelopment: {},
      playerAges: {},
      relationships: {},
      coachStates: {},
      phase: 'regular',
      playoffBracket: null,
      awards: null,
      previousAwards: [],
      championTeamId: null,
      championResult: null,
      config: { longSeason: false },
    },
    currentMatchup: schedule[currentGameIndex]
      ? {
          ...schedule[currentGameIndex],
          slotToTeam: {},
          identities: {},
        }
      : null,
    currentScores: {},
    lastCompletedGame: results.length
      ? {
          matchup: {
            ...schedule[results[results.length - 1].index],
            slotToTeam: {},
            identities: {},
          },
          scores: {},
        }
      : null,
    league: {
      seasonNumber,
      offseason: { active: false, nextSeasonStarted: true },
    },
  };
}

function createResult(index, home = 'T0', away = 'T1') {
  return {
    index,
    gameId: `G${String(index + 1).padStart(3, '0')}`,
    homeTeamId: home,
    awayTeamId: away,
    score: { [home]: 21, [away]: 17 },
    playerStats: {},
    playerTeams: {},
  };
}

describe('combineSeasonSnapshots', () => {
  it('ignores completed games from previous seasons when a new season starts', () => {
    const previousSeason = createSeasonSnapshot({
      seasonNumber: 1,
      assignmentOffset: 0,
      currentGameIndex: 8,
      scheduleLength: 8,
      results: [createResult(0)],
    });
    const newSeason = createSeasonSnapshot({
      seasonNumber: 2,
      assignmentOffset: 0,
      currentGameIndex: 0,
      scheduleLength: 8,
      results: [],
    });

    const combined = combineSeasonSnapshots([previousSeason, newSeason]);

    expect(combined.season.seasonNumber).toBe(2);
    expect(combined.season.results).toHaveLength(0);
    expect(combined.currentMatchup?.index).toBe(0);
  });

  it('keeps regular season openers when stray playoff entries appear in snapshots', () => {
    const opener = createSeasonSnapshot({
      seasonNumber: 2,
      assignmentOffset: 0,
      currentGameIndex: 0,
      scheduleLength: 28,
    });
    const stray = createSeasonSnapshot({
      seasonNumber: 2,
      assignmentOffset: 1,
      currentGameIndex: 0,
      scheduleLength: 28,
    });

    const semifinal = {
      ...stray.season.schedule[1],
      tag: 'playoff-semifinal',
      round: 'Semifinal 2',
      played: false,
    };
    stray.season.schedule[1] = semifinal;
    stray.season.playoffBracket = {
      stage: 'semifinals',
      semifinalGames: [
        {
          index: 1,
          homeTeam: semifinal.homeTeam,
          awayTeam: semifinal.awayTeam,
        },
      ],
    };

    const combined = combineSeasonSnapshots([opener, stray]);

    expect(combined.season.schedule[1].tag).toBe('regular-season');
  });
});
