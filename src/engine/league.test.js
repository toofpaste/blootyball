import { generateSeasonSchedule } from './league';
import { TEAM_IDS } from './data/teamLibrary';

describe('generateSeasonSchedule', () => {
  it('creates a balanced 16-game season for each team', () => {
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
      expect(counts.get(id)).toBe(16);
    });

    pairCounts.forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(2);
    });

    expect(schedule).toHaveLength(64);
  });
});
