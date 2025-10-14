import { generateSeasonSchedule } from './league';
import { TEAM_IDS } from './data/teamLibrary';

describe('generateSeasonSchedule', () => {
  it('creates a balanced 14-game season for each team', () => {
    const schedule = generateSeasonSchedule();
    const counts = new Map(TEAM_IDS.map((id) => [id, 0]));
    const pairCounts = new Map();

    schedule.forEach(({ homeTeam, awayTeam }) => {
      counts.set(homeTeam, counts.get(homeTeam) + 1);
      counts.set(awayTeam, counts.get(awayTeam) + 1);
      const sortedKey = [homeTeam, awayTeam].sort().join(' vs ');
      pairCounts.set(sortedKey, (pairCounts.get(sortedKey) || 0) + 1);
    });

    TEAM_IDS.forEach((id) => {
      expect(counts.get(id)).toBe(14);
    });

    pairCounts.forEach((count) => {
      expect(count).toBe(2);
    });

    expect(schedule).toHaveLength(56);
  });

  it('ensures each team appears only once per week', () => {
    const schedule = generateSeasonSchedule();
    const weeks = new Map();

    schedule.forEach((game) => {
      const weekGames = weeks.get(game.week) || [];
      weekGames.push(game);
      weeks.set(game.week, weekGames);
    });

    expect(weeks.size).toBe(14);

    weeks.forEach((games) => {
      const seen = new Set();
      games.forEach(({ homeTeam, awayTeam }) => {
        expect(seen.has(homeTeam)).toBe(false);
        expect(seen.has(awayTeam)).toBe(false);
        seen.add(homeTeam);
        seen.add(awayTeam);
      });
      expect(seen.size).toBe(TEAM_IDS.length);
    });
  });

  it('prevents back-to-back opponents for any team', () => {
    const schedule = generateSeasonSchedule();
    const byTeam = new Map(TEAM_IDS.map((id) => [id, []]));

    schedule.forEach((game) => {
      byTeam.get(game.homeTeam).push({ week: game.week, opponent: game.awayTeam });
      byTeam.get(game.awayTeam).push({ week: game.week, opponent: game.homeTeam });
    });

    byTeam.forEach((entries) => {
      const sorted = entries.sort((a, b) => a.week - b.week);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].week).toBeGreaterThan(sorted[i - 1].week);
        expect(sorted[i].opponent).not.toBe(sorted[i - 1].opponent);
      }
    });
  });
});
