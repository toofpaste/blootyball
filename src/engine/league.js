import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { TEAM_RED, TEAM_BLK } from './constants';
import { clamp, rand } from './helpers';
import {
  initializeLeaguePersonnel,
  ensureSeasonPersonnel,
  advanceContractsForNewSeason,
  disperseFranchiseRostersToFreeAgency,
} from './personnel';
import { createInitialTeamWiki, cloneTeamWikiMap } from '../data/teamWikiTemplates';

const ATTRIBUTE_KEYS = ['speed', 'accel', 'agility', 'strength', 'awareness', 'catch', 'throwPow', 'throwAcc', 'tackle'];
const TEAM_STAT_KEYS = [
  'passingYards',
  'passingTD',
  'rushingYards',
  'rushingTD',
  'receivingYards',
  'receivingTD',
  'tackles',
  'sacks',
  'interceptions',
];

const PLAYER_RECORD_DEFINITIONS = [
  { key: 'mostPassingTouchdownsSeason', label: 'Most Passing TDs (Season)', type: 'player', unit: 'TDs', path: ['passing', 'touchdowns'] },
  { key: 'mostPassingYardsSeason', label: 'Most Passing Yards (Season)', type: 'player', unit: 'Yards', path: ['passing', 'yards'] },
  { key: 'mostReceptionsSeason', label: 'Most Receptions (Season)', type: 'player', unit: 'Receptions', path: ['receiving', 'receptions'] },
  { key: 'mostReceivingYardsSeason', label: 'Most Receiving Yards (Season)', type: 'player', unit: 'Yards', path: ['receiving', 'yards'] },
  { key: 'mostRushingYardsSeason', label: 'Most Rushing Yards (Season)', type: 'player', unit: 'Yards', path: ['rushing', 'yards'] },
  { key: 'mostRushingTouchdownsSeason', label: 'Most Rushing TDs (Season)', type: 'player', unit: 'TDs', path: ['rushing', 'touchdowns'] },
  { key: 'mostSacksSeason', label: 'Most Sacks (Season)', type: 'player', unit: 'Sacks', path: ['defense', 'sacks'] },
  { key: 'mostTacklesSeason', label: 'Most Tackles (Season)', type: 'player', unit: 'Tackles', path: ['defense', 'tackles'] },
  { key: 'mostInterceptionsSeason', label: 'Most Interceptions (Season)', type: 'player', unit: 'INT', path: ['defense', 'interceptions'] },
];

const TEAM_RECORD_DEFINITIONS = [
  { key: 'bestTeamRecordSeason', label: 'Best Team Record (Season)', type: 'team', unit: 'Wins' },
  { key: 'bestPointDifferentialSeason', label: 'Best Point Differential (Season)', type: 'team', unit: 'Points' },
];

const COACH_RECORD_DEFINITIONS = [
  { key: 'coachMostWinsSeason', label: 'Most Wins By A Coach (Season)', type: 'coach', unit: 'Wins' },
];

const RECORD_DEFINITIONS = [
  ...PLAYER_RECORD_DEFINITIONS,
  ...TEAM_RECORD_DEFINITIONS,
  ...COACH_RECORD_DEFINITIONS,
];

function createBlankRecordEntry(definition = {}) {
  return {
    key: definition.key || '',
    label: definition.label || definition.key || '',
    type: definition.type || 'player',
    unit: definition.unit || null,
    value: 0,
    holderId: null,
    holderName: null,
    teamId: null,
    teamName: null,
    seasonNumber: null,
    extra: {},
    updatedSeason: null,
  };
}

export function createInitialRecordBook() {
  const categories = {};
  RECORD_DEFINITIONS.forEach((definition) => {
    categories[definition.key] = createBlankRecordEntry(definition);
  });
  return {
    categories,
    lastUpdatedSeason: 0,
  };
}

export function cloneRecordBook(book = {}) {
  if (!book || typeof book !== 'object') {
    return { categories: {}, lastUpdatedSeason: 0 };
  }
  const categories = {};
  Object.entries(book.categories || {}).forEach(([key, entry]) => {
    categories[key] = {
      key: entry?.key || key,
      label: entry?.label || key,
      type: entry?.type || 'player',
      unit: entry?.unit || null,
      value: entry?.value ?? 0,
      holderId: entry?.holderId || null,
      holderName: entry?.holderName || null,
      teamId: entry?.teamId || null,
      teamName: entry?.teamName || null,
      seasonNumber: entry?.seasonNumber ?? null,
      extra: entry?.extra ? { ...entry.extra } : {},
      updatedSeason: entry?.updatedSeason ?? null,
    };
  });
  return {
    categories,
    lastUpdatedSeason: book.lastUpdatedSeason ?? 0,
  };
}

function ensureRecordBook(league) {
  if (!league.recordBook) {
    league.recordBook = createInitialRecordBook();
  }
  const missing = RECORD_DEFINITIONS.filter((definition) => !league.recordBook.categories?.[definition.key]);
  if (missing.length) {
    league.recordBook.categories ||= {};
    missing.forEach((definition) => {
      league.recordBook.categories[definition.key] = createBlankRecordEntry(definition);
    });
  }
  return league.recordBook;
}

function getStatValueByPath(stat = {}, path = []) {
  if (!Array.isArray(path) || !path.length) return 0;
  return path.reduce((acc, key) => {
    if (acc == null) return 0;
    const next = acc[key];
    return Number.isFinite(next) ? next : (next ?? 0);
  }, stat) || 0;
}

function buildSeasonPlayerTeamMap(season, league) {
  const map = {};
  (season?.results || []).forEach((result) => {
    Object.entries(result?.playerTeams || {}).forEach(([playerId, teamId]) => {
      if (!playerId || !teamId) return;
      map[playerId] = teamId;
    });
  });
  const directory = league?.playerDirectory || {};
  Object.entries(directory).forEach(([playerId, meta]) => {
    if (map[playerId]) return;
    if (meta?.teamId) map[playerId] = meta.teamId;
    else if (meta?.team) map[playerId] = meta.team;
  });
  return map;
}

function resolvePlayerName(meta, fallbackId) {
  if (!meta) return fallbackId || null;
  if (meta.fullName) return meta.fullName;
  if (meta.name) return meta.name;
  const parts = [meta.firstName, meta.lastName].filter(Boolean).join(' ').trim();
  return parts || fallbackId || null;
}

function resolveTeamDisplayName(season, teamId) {
  if (!teamId) return null;
  const info = season?.teams?.[teamId]?.info || getTeamIdentity(teamId) || null;
  return info?.displayName || info?.name || teamId;
}

function compareTeamRecord(candidate, existing) {
  if (!existing) return true;
  if (candidate.wins > existing.wins) return true;
  if (candidate.wins < existing.wins) return false;
  if (candidate.winPct > existing.winPct) return true;
  if (candidate.winPct < existing.winPct) return false;
  if (candidate.pointDiff > existing.pointDiff) return true;
  if (candidate.pointDiff < existing.pointDiff) return false;
  return candidate.pointsFor > existing.pointsFor;
}

function comparePointDifferential(candidate, existing) {
  if (!existing) return true;
  if (candidate.pointDiff > existing.pointDiff) return true;
  if (candidate.pointDiff < existing.pointDiff) return false;
  return candidate.pointsFor > existing.pointsFor;
}

function buildTeamRecordHighlights(recordBook, teamId) {
  if (!recordBook || !teamId) return [];
  const highlights = [];
  Object.values(recordBook.categories || {}).forEach((entry) => {
    if (!entry || entry.teamId !== teamId) return;
    highlights.push({
      key: entry.key,
      label: entry.label,
      value: entry.value ?? 0,
      unit: entry.unit || entry.extra?.unit || null,
      seasonNumber: entry.seasonNumber ?? entry.updatedSeason ?? null,
      holderName: entry.holderName || entry.teamName || null,
    });
  });
  highlights.sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));
  return highlights.slice(0, 12);
}

function collectTeamAwardsForSeason(season, league, teamId) {
  const awards = [];
  const awardSet = season?.awards || null;
  if (!awardSet) return awards;
  const labels = {
    mvp: 'League MVP',
    offensive: 'Offensive Player of the Year',
    defensive: 'Defensive Player of the Year',
  };
  Object.entries(labels).forEach(([key, label]) => {
    const award = awardSet[key];
    if (!award || award.teamId !== teamId) return;
    const meta = league?.playerDirectory?.[award.playerId] || null;
    const name = award.name || resolvePlayerName(meta, award.playerId) || 'Unknown Player';
    awards.push(`${label}: ${name}`);
  });
  return awards;
}

function buildSeasonNotes(recordText, playoffResult, awards, highlights) {
  const notes = [];
  if (recordText) notes.push(`Finished ${recordText}`);
  if (playoffResult && playoffResult !== 'Regular Season') {
    notes.push(`Postseason: ${playoffResult}`);
  }
  if (awards.length) {
    notes.push(`Awards – ${awards.join(', ')}`);
  }
  if (highlights.length) {
    notes.push(highlights[0].text);
  }
  return notes.join(' • ');
}

function buildTeamSeasonHighlights(teamId, season, league, playerTeams) {
  const highlights = [];
  if (!teamId) return highlights;
  const stats = season?.playerStats || {};
  const directory = league?.playerDirectory || {};
  const categories = [
    { key: 'passingYards', path: ['passing', 'yards'], label: 'Passing Yards Leader', unit: 'yds' },
    { key: 'rushingYards', path: ['rushing', 'yards'], label: 'Rushing Yards Leader', unit: 'yds' },
    { key: 'receivingYards', path: ['receiving', 'yards'], label: 'Receiving Yards Leader', unit: 'yds' },
    { key: 'sacks', path: ['defense', 'sacks'], label: 'Sack Leader', unit: 'sacks' },
    { key: 'tackles', path: ['defense', 'tackles'], label: 'Tackle Leader', unit: 'tackles' },
  ];

  categories.forEach((category) => {
    let best = null;
    Object.entries(stats).forEach(([playerId, stat]) => {
      if (playerTeams[playerId] !== teamId) return;
      const value = getStatValueByPath(stat, category.path);
      if (!Number.isFinite(value) || value <= 0) return;
      if (!best || value > best.value) {
        best = { playerId, value };
      }
    });
    if (best) {
      const meta = directory[best.playerId] || {};
      const name = resolvePlayerName(meta, best.playerId) || best.playerId;
      const text = `${category.label}: ${Math.round(best.value)} ${category.unit}`;
      highlights.push({
        playerId: best.playerId,
        name,
        text,
        value: best.value,
        category: category.key,
      });
    }
  });

  return highlights;
}

function ensureTeamWikiEntry(league, teamId) {
  if (!teamId) return null;
  league.teamWiki ||= createInitialTeamWiki();
  if (league.teamWiki[teamId]) return league.teamWiki[teamId];
  const templates = createInitialTeamWiki();
  if (templates[teamId]) {
    league.teamWiki[teamId] = cloneTeamWikiMap({ [teamId]: templates[teamId] })[teamId];
    return league.teamWiki[teamId];
  }
  const fallbackName = getTeamIdentity(teamId)?.displayName || teamId;
  league.teamWiki[teamId] = {
    id: teamId,
    displayName: fallbackName,
    sections: [],
    seasonSummaries: [],
    totals: {
      playoffAppearances: 0,
      championships: 0,
      awards: 0,
      bluperbowlWins: 0,
    },
    recordsSet: [],
    notablePlayers: [],
    lastUpdatedSeason: 0,
  };
  return league.teamWiki[teamId];
}

export function updateRecordBookForSeason(league, season) {
  if (!league || !season) return;
  const recordBook = ensureRecordBook(league);
  const seasonNumber = season.seasonNumber ?? league.seasonNumber ?? 1;
  const playerStats = season.playerStats || {};
  const playerTeams = buildSeasonPlayerTeamMap(season, league);
  const directory = league.playerDirectory || {};

  Object.entries(playerStats).forEach(([playerId, stat]) => {
    const meta = directory[playerId] || {};
    const teamId = playerTeams[playerId] || null;
    const teamName = resolveTeamDisplayName(season, teamId);
    PLAYER_RECORD_DEFINITIONS.forEach((definition) => {
      const value = Math.round(getStatValueByPath(stat, definition.path));
      if (!Number.isFinite(value) || value <= 0) return;
      const entry = recordBook.categories?.[definition.key];
      if (!entry || value <= (entry.value ?? 0)) return;
      entry.value = value;
      entry.holderId = playerId;
      entry.holderName = resolvePlayerName(meta, playerId);
      entry.teamId = teamId;
      entry.teamName = teamName;
      entry.seasonNumber = seasonNumber;
      entry.updatedSeason = seasonNumber;
      entry.extra = {
        ...(entry.extra || {}),
        unit: definition.unit || entry.unit || null,
      };
    });
  });

  Object.values(season.teams || {}).forEach((team) => {
    if (!team?.id) return;
    const record = team.record || {};
    const wins = record.wins ?? 0;
    const losses = record.losses ?? 0;
    const ties = record.ties ?? 0;
    const games = wins + losses + ties;
    const winPct = games ? (wins + 0.5 * ties) / games : 0;
    const pointDiff = (team.pointsFor ?? 0) - (team.pointsAgainst ?? 0);
    const teamName = resolveTeamDisplayName(season, team.id);

    const recordEntry = recordBook.categories?.bestTeamRecordSeason;
    if (recordEntry) {
      const candidate = { wins, losses, ties, winPct, pointDiff, pointsFor: team.pointsFor ?? 0, pointsAgainst: team.pointsAgainst ?? 0 };
      const current = recordEntry.extra || null;
      if (wins > 0 && compareTeamRecord(candidate, current)) {
        recordEntry.value = wins;
        recordEntry.holderId = team.id;
        recordEntry.holderName = teamName;
        recordEntry.teamId = team.id;
        recordEntry.teamName = teamName;
        recordEntry.seasonNumber = seasonNumber;
        recordEntry.updatedSeason = seasonNumber;
        recordEntry.extra = candidate;
      }
    }

    const diffEntry = recordBook.categories?.bestPointDifferentialSeason;
    if (diffEntry) {
      const candidate = { pointDiff, wins, losses, ties, pointsFor: team.pointsFor ?? 0, pointsAgainst: team.pointsAgainst ?? 0 };
      const current = diffEntry.extra || null;
      if (pointDiff > 0 && comparePointDifferential(candidate, current)) {
        diffEntry.value = pointDiff;
        diffEntry.holderId = team.id;
        diffEntry.holderName = teamName;
        diffEntry.teamId = team.id;
        diffEntry.teamName = teamName;
        diffEntry.seasonNumber = seasonNumber;
        diffEntry.updatedSeason = seasonNumber;
        diffEntry.extra = candidate;
      }
    }

    const coachEntry = recordBook.categories?.coachMostWinsSeason;
    if (coachEntry) {
      const coach = league.teamCoaches?.[team.id] || null;
      if (coach && wins > (coachEntry.value ?? 0)) {
        const coachName = coach.identity?.fullName
          || coach.identity?.name
          || coach.identity?.lastName
          || coach.name
          || coach.id
          || teamName;
        coachEntry.value = wins;
        coachEntry.holderId = coach.id || `${team.id}-coach`;
        coachEntry.holderName = coachName;
        coachEntry.teamId = team.id;
        coachEntry.teamName = teamName;
        coachEntry.seasonNumber = seasonNumber;
        coachEntry.updatedSeason = seasonNumber;
        coachEntry.extra = { losses, ties };
      }
    }
  });

  recordBook.lastUpdatedSeason = Math.max(recordBook.lastUpdatedSeason ?? 0, seasonNumber);
}

export function updateTeamWikiAfterSeason(league, season) {
  if (!league || !season) return;
  const seasonNumber = season.seasonNumber ?? league.seasonNumber ?? 1;
  league.teamWiki ||= createInitialTeamWiki();
  ensureRecordBook(league);
  computeSeasonAwards(season, league);
  const playerTeams = buildSeasonPlayerTeamMap(season, league);

  Object.values(season.teams || {}).forEach((team) => {
    if (!team?.id) return;
    const entry = ensureTeamWikiEntry(league, team.id);
    const recordText = formatRecord(team.record);
    const playoffResult = determinePlayoffOutcome(season, team.id);
    const awards = collectTeamAwardsForSeason(season, league, team.id);
    const highlights = buildTeamSeasonHighlights(team.id, season, league, playerTeams);
    const summary = {
      seasonNumber,
      recordText,
      playoffResult,
      pointsFor: team.pointsFor ?? 0,
      pointsAgainst: team.pointsAgainst ?? 0,
      awards,
      notablePlayers: highlights.map((highlight) => ({
        playerId: highlight.playerId,
        name: highlight.name,
        highlight: highlight.text,
      })),
      notes: buildSeasonNotes(recordText, playoffResult, awards, highlights),
    };

    const existingIndex = entry.seasonSummaries.findIndex((item) => item.seasonNumber === seasonNumber);
    if (existingIndex >= 0) entry.seasonSummaries[existingIndex] = summary;
    else entry.seasonSummaries.push(summary);
    entry.seasonSummaries.sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));

    const playerMap = new Map((entry.notablePlayers || []).map((player) => [
      player.playerId,
      {
        ...player,
        highlights: Array.isArray(player.highlights) ? player.highlights.slice() : [],
        seasons: Array.isArray(player.seasons) ? player.seasons.slice() : [],
      },
    ]));

    highlights.forEach((highlight) => {
      if (!highlight.playerId) return;
      const existing = playerMap.get(highlight.playerId);
      if (existing) {
        if (!existing.highlights.includes(highlight.text)) existing.highlights.push(highlight.text);
        if (!existing.seasons.includes(seasonNumber)) existing.seasons.push(seasonNumber);
      } else {
        playerMap.set(highlight.playerId, {
          playerId: highlight.playerId,
          name: highlight.name,
          highlights: [highlight.text],
          seasons: [seasonNumber],
        });
      }
    });

    entry.notablePlayers = Array.from(playerMap.values())
      .sort((a, b) => (b.seasons?.length || 0) - (a.seasons?.length || 0))
      .slice(0, 10);

    entry.recordsSet = buildTeamRecordHighlights(league.recordBook, team.id);

    const playoffAppearances = entry.seasonSummaries.filter((summary) => summary.playoffResult && summary.playoffResult !== 'Regular Season').length;
    const awardCount = entry.seasonSummaries.reduce((total, summary) => total + (summary.awards?.length || 0), 0);
    const championships = league.teamChampionships?.[team.id]?.count ?? 0;

    entry.totals = {
      playoffAppearances,
      championships,
      awards: awardCount,
      bluperbowlWins: championships,
    };

    entry.lastUpdatedSeason = seasonNumber;
  });

  league.teamWikiLastUpdatedSeason = Math.max(league.teamWikiLastUpdatedSeason ?? 0, seasonNumber);
}

function createBlankTeamStats() {
  return TEAM_STAT_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function createZeroTeamSummary(teamId = null, info = null) {
  return {
    id: teamId,
    info: info || null,
    record: { wins: 0, losses: 0, ties: 0 },
    postseasonRecord: { wins: 0, losses: 0, ties: 0 },
    pointsFor: 0,
    pointsAgainst: 0,
    stats: createBlankTeamStats(),
  };
}

function ensureTeamSummary(map, teamId, infoLookup = {}) {
  if (!teamId) return null;
  if (!map[teamId]) {
    const info = infoLookup[teamId] || getTeamIdentity(teamId) || null;
    map[teamId] = createZeroTeamSummary(teamId, info);
  } else if (!map[teamId].postseasonRecord) {
    map[teamId].postseasonRecord = { wins: 0, losses: 0, ties: 0 };
  }
  return map[teamId];
}

function applyScoreToSummary(summary, scored, allowed) {
  if (!summary) return;
  summary.pointsFor += scored;
  summary.pointsAgainst += allowed;
}

function getRecordBucket(summary, scope = 'regular') {
  if (!summary) return null;
  if (scope === 'postseason') {
    summary.postseasonRecord ||= { wins: 0, losses: 0, ties: 0 };
    return summary.postseasonRecord;
  }
  summary.record ||= { wins: 0, losses: 0, ties: 0 };
  return summary.record;
}

function registerOutcome(summary, result, scope = 'regular') {
  if (!summary) return;
  const bucket = getRecordBucket(summary, scope);
  if (!bucket) return;
  if (result === 'win') bucket.wins += 1;
  else if (result === 'loss') bucket.losses += 1;
  else if (result === 'tie') bucket.ties += 1;
}

function clonePlayerStatsSnapshot(stats = {}) {
  const map = {};
  Object.entries(stats).forEach(([playerId, entry]) => {
    map[playerId] = clonePlayerSeasonEntry(entry);
  });
  return map;
}

function extractPlayerTeams(directory = {}) {
  const map = {};
  Object.entries(directory).forEach(([playerId, meta]) => {
    if (!playerId) return;
    const teamId = meta.team || meta.teamId || null;
    if (!teamId) return;
    map[playerId] = teamId;
  });
  return map;
}

function createEmptyTeamTotals(teamId = null, info = null) {
  const stats = TEAM_STAT_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  return {
    id: teamId,
    info: info || null,
    record: { wins: 0, losses: 0, ties: 0 },
    postseasonRecord: { wins: 0, losses: 0, ties: 0 },
    pointsFor: 0,
    pointsAgainst: 0,
    stats,
  };
}

function cloneTeamTotals(entry = {}, fallbackInfo = null) {
  const base = createEmptyTeamTotals(entry.id ?? null, entry.info || fallbackInfo || null);
  if (entry.record) {
    base.record = {
      wins: entry.record.wins ?? 0,
      losses: entry.record.losses ?? 0,
      ties: entry.record.ties ?? 0,
    };
  }
  if (entry.postseasonRecord) {
    base.postseasonRecord = {
      wins: entry.postseasonRecord.wins ?? 0,
      losses: entry.postseasonRecord.losses ?? 0,
      ties: entry.postseasonRecord.ties ?? 0,
    };
  }
  base.pointsFor = entry.pointsFor ?? 0;
  base.pointsAgainst = entry.pointsAgainst ?? 0;
  TEAM_STAT_KEYS.forEach((key) => {
    base.stats[key] = entry.stats?.[key] ?? 0;
  });
  return base;
}

function cloneAssignmentTotalsMap(map = {}, teams = {}) {
  const totals = {};
  Object.entries(teams).forEach(([teamId, team]) => {
    const existing = map[teamId];
    totals[teamId] = cloneTeamTotals(existing || { id: teamId, info: team?.info || null }, team?.info || null);
  });
  Object.entries(map).forEach(([teamId, entry]) => {
    if (!totals[teamId]) {
      totals[teamId] = cloneTeamTotals(entry);
    }
  });
  return totals;
}

function hashString(value = '') {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // eslint-disable-line no-bitwise
  }
  return hash;
}

function computeInitialAge(playerId) {
  const base = Math.abs(hashString(playerId)) % 14; // 0-13
  return 21 + base;
}

function buildGlobalPlayerDirectory() {
  const directory = {};
  TEAM_IDS.forEach((teamId) => {
    const data = getTeamData(teamId) || {};
    const identity = getTeamIdentity(teamId) || { id: teamId, displayName: teamId, abbr: teamId };
    const register = (collection = {}, side) => {
      Object.entries(collection).forEach(([role, entry]) => {
        if (!entry) return;
        const playerId = entry.id || `${teamId}-${role}`;
        directory[playerId] = {
          id: playerId,
          teamId: null,
          team: null,
          side,
          role,
          firstName: entry.firstName || role,
          lastName: entry.lastName || '',
          fullName: `${entry.firstName || role}${entry.lastName ? ` ${entry.lastName}` : ''}`,
          number: entry.number ?? null,
          originTeamId: teamId,
          originTeamName: identity.displayName,
          originTeamAbbr: identity.abbr,
        };
      });
    };
    register(data.offense, 'Offense');
    register(data.defense, 'Defense');
    if (data.specialTeams?.K) {
      const kicker = data.specialTeams.K;
      const playerId = kicker.id || `${teamId}-K`;
      directory[playerId] = {
        id: playerId,
        teamId: null,
        team: null,
        side: 'Special Teams',
        role: 'K',
        firstName: kicker.firstName || 'Kicker',
        lastName: kicker.lastName || '',
        fullName: `${kicker.firstName || 'Kicker'}${kicker.lastName ? ` ${kicker.lastName}` : ''}`,
        number: kicker.number ?? null,
        originTeamId: teamId,
        originTeamName: identity.displayName,
        originTeamAbbr: identity.abbr,
      };
    }
  });
  return directory;
}

function cloneAwards(entry = {}) {
  if (!entry) return null;
  return {
    seasonNumber: entry.seasonNumber ?? null,
    mvp: entry.mvp ? { ...entry.mvp } : null,
    offensive: entry.offensive ? { ...entry.offensive } : null,
    defensive: entry.defensive ? { ...entry.defensive } : null,
  };
}

function clonePlayoffBracket(bracket) {
  if (!bracket) return null;
  return {
    stage: bracket.stage || 'regular',
    seeds: Array.isArray(bracket.seeds) ? [...bracket.seeds] : [],
    semifinalGames: Array.isArray(bracket.semifinalGames)
      ? bracket.semifinalGames.map((game) => ({ ...game }))
      : [],
    championshipGame: bracket.championshipGame ? { ...bracket.championshipGame } : null,
    champion: bracket.champion ?? null,
  };
}

function normalizeRecord(record) {
  return {
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    ties: record?.ties ?? 0,
  };
}

export function createLeagueContext() {
  const playerDirectory = buildGlobalPlayerDirectory();
  const playerAges = {};
  Object.keys(playerDirectory).forEach((playerId) => {
    playerAges[playerId] = computeInitialAge(playerId);
  });
  const league = {
    seasonNumber: 0,
    playerDevelopment: {},
    playerAges,
    playerDirectory,
    careerStats: {},
    playerAwards: {},
    awardsHistory: [],
    teamChampionships: {},
    lastChampion: null,
    teamSeasonHistory: {},
    recordBook: createInitialRecordBook(),
    teamWiki: createInitialTeamWiki(),
    teamWikiLastUpdatedSeason: 0,
    teamWikiAiLog: [],
  };
  initializeLeaguePersonnel(league);
  ensureSeasonPersonnel(league, league.seasonNumber);
  disperseFranchiseRostersToFreeAgency(league);
  return league;
}

function cloneRecord(record) {
  return {
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    ties: record?.ties ?? 0,
  };
}

export function formatRecord(record) {
  if (!record) return '0-0';
  const { wins = 0, losses = 0, ties = 0 } = record;
  const base = `${wins}-${losses}`;
  return ties ? `${base}-${ties}` : base;
}

function computeRegularSeasonWeeks(schedule = [], teams = TEAM_IDS.length) {
  if (!Array.isArray(schedule) || !schedule.length) return 0;
  let maxWeek = 0;
  schedule.forEach((game) => {
    if (!game) return;
    const tag = String(game.tag || '');
    if (tag.startsWith('playoff')) return;
    const week = Number.isFinite(game.week) ? game.week : null;
    if (week == null) return;
    if (week > maxWeek) maxWeek = week;
  });
  if (maxWeek > 0) return maxWeek;
  const regularGames = schedule.filter((game) => game && !String(game.tag || '').startsWith('playoff')).length;
  if (regularGames <= 0) return 0;
  const teamCount = Number.isFinite(teams) && teams > 0 ? teams : TEAM_IDS.length;
  const gamesPerWeek = Math.max(1, Math.floor(teamCount / 2));
  return Math.max(1, Math.ceil(regularGames / gamesPerWeek));
}

export function generateSeasonSchedule(teamIds = TEAM_IDS, options = {}) {
  const { longSeason = true } = options || {};
  const ids = [...teamIds];
  if (!ids.length) return [];

  if (ids.length === 8) {
    const baseWeeks = [
      [
        [0, 7],
        [1, 6],
        [2, 5],
        [3, 4],
      ],
      [
        [0, 6],
        [1, 5],
        [2, 4],
        [3, 7],
      ],
      [
        [0, 5],
        [1, 4],
        [2, 7],
        [3, 6],
      ],
      [
        [0, 4],
        [1, 7],
        [2, 6],
        [3, 5],
      ],
      [
        [0, 3],
        [1, 2],
        [4, 7],
        [5, 6],
      ],
      [
        [0, 2],
        [1, 3],
        [4, 6],
        [5, 7],
      ],
      [
        [0, 1],
        [2, 3],
        [4, 5],
        [6, 7],
      ],
    ];

    const buildWeek = (pairs, tag, swapHome) => pairs.map(([homeIndex, awayIndex]) => ({
      homeTeam: swapHome ? ids[awayIndex] : ids[homeIndex],
      awayTeam: swapHome ? ids[homeIndex] : ids[awayIndex],
      tag,
    }));

    const firstHalf = baseWeeks.map((pairs) => buildWeek(pairs, 'regular-season', false));
    const secondHalf = longSeason
      ? baseWeeks.map((pairs) => buildWeek(pairs, 'regular-season-rematch', true))
      : [];
    const weeks = longSeason ? [...firstHalf, ...secondHalf] : firstHalf;

    return weeks
      .flatMap((games, weekIndex) => games.map((game, slotIndex) => ({
        ...game,
        week: weekIndex + 1,
        slot: slotIndex,
      })))
      .map((game, index) => ({
        ...game,
        id: `G${String(index + 1).padStart(3, '0')}`,
        index,
      }));
  }

  const circle = [...ids];
  const totalTeams = circle.length;
  const half = totalTeams / 2;
  const rounds = totalTeams - 1;
  const firstLegWeeks = [];

  let rotation = [...circle];
  for (let round = 0; round < rounds; round += 1) {
    const games = [];
    for (let i = 0; i < half; i += 1) {
      const teamA = rotation[i];
      const teamB = rotation[totalTeams - 1 - i];
      const swap = round % 2 === 1;
      const homeTeam = swap ? teamB : teamA;
      const awayTeam = swap ? teamA : teamB;
      games.push({ homeTeam, awayTeam, tag: 'regular-season' });
    }
    firstLegWeeks.push(games);

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    const last = rest.pop();
    rotation = [fixed, last, ...rest];
  }

  const rematchWeeks = firstLegWeeks.map((week) => week.map((game) => ({
    homeTeam: game.awayTeam,
    awayTeam: game.homeTeam,
    tag: 'regular-season-rematch',
  })));

  const safePair = (aIndex, bIndex) => {
    const home = ids[aIndex];
    const away = ids[bIndex];
    if (!home || !away) return null;
    return [home, away];
  };

  const extraWeekPairs = [
    [safePair(0, 1), safePair(2, 3), safePair(4, 5), safePair(6, 7)].filter(Boolean),
    [safePair(0, 2), safePair(1, 3), safePair(4, 6), safePair(5, 7)].filter(Boolean),
  ];

  const extraWeeks = extraWeekPairs
    .filter((pairs) => pairs.length)
    .map((pairs, idx) => pairs.map(([a, b]) => ({
      homeTeam: idx % 2 === 0 ? a : b,
      awayTeam: idx % 2 === 0 ? b : a,
      tag: 'rivalry-week',
    })));

  const weeks = longSeason
    ? [...firstLegWeeks, ...rematchWeeks, ...extraWeeks]
    : firstLegWeeks;

  return weeks.flatMap((games, weekIndex) => games.map((game, slotIndex) => ({
    ...game,
    week: weekIndex + 1,
    slot: slotIndex,
  }))).map((game, index) => ({
    ...game,
    id: `G${String(index + 1).padStart(3, '0')}`,
    index,
  }));
}

export function createSeasonState(options = {}) {
  const {
    seasonNumber = 1,
    playerDevelopment = {},
    playerAges = {},
    previousAwards = [],
    longSeason: longSeasonOption = null,
    seasonConfig = {},
  } = options;

  const longSeason = seasonConfig.longSeason ?? (longSeasonOption ?? true);
  const resolvedConfig = { ...seasonConfig, longSeason };

  const schedule = generateSeasonSchedule(TEAM_IDS, { longSeason });
  const teams = {};
  const assignmentTotals = {};
  TEAM_IDS.forEach((id) => {
    const info = getTeamIdentity(id) || { id, name: id, city: id, abbr: id, colors: {} };
    teams[id] = createZeroTeamSummary(id, info);
    assignmentTotals[id] = createEmptyTeamTotals(id, info);
  });

  const regularSeasonWeeks = computeRegularSeasonWeeks(schedule, Object.keys(teams).length || TEAM_IDS.length);

  return {
    seasonNumber,
    teams,
    schedule,
    regularSeasonLength: schedule.length,
    regularSeasonWeeks,
    currentGameIndex: 0,
    completedGames: 0,
    results: [],
    playerStats: {},
    assignmentTotals,
    playerDevelopment,
    playerAges,
    relationships: {},
    coachStates: {},
    phase: 'regular',
    playoffBracket: null,
    awards: null,
    previousAwards,
    championTeamId: null,
    championResult: null,
    config: resolvedConfig,
  };
}

export function createMatchupFromGame(game) {
  if (!game) return null;
  const homeIdentity = getTeamIdentity(game.homeTeam);
  const awayIdentity = getTeamIdentity(game.awayTeam);
  return {
    gameId: game.id,
    index: game.index,
    tag: game.tag || null,
    round: game.round || null,
    homeTeamId: game.homeTeam,
    awayTeamId: game.awayTeam,
    slotToTeam: {
      [TEAM_RED]: game.homeTeam,
      [TEAM_BLK]: game.awayTeam,
    },
    identities: {
      [TEAM_RED]: homeIdentity,
      [TEAM_BLK]: awayIdentity,
    },
    meta: game.meta ? { ...game.meta } : null,
  };
}

function cloneTeamSeasonEntry(team) {
  if (!team) return null;
  const record = team.record || {};
  const postseasonRecord = team.postseasonRecord || {};
  const stats = team.stats || {};
  return {
    ...team,
    record: {
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
    },
    postseasonRecord: {
      wins: postseasonRecord.wins ?? 0,
      losses: postseasonRecord.losses ?? 0,
      ties: postseasonRecord.ties ?? 0,
    },
    stats: {
      passingYards: stats.passingYards ?? 0,
      passingTD: stats.passingTD ?? 0,
      rushingYards: stats.rushingYards ?? 0,
      rushingTD: stats.rushingTD ?? 0,
      receivingYards: stats.receivingYards ?? 0,
      receivingTD: stats.receivingTD ?? 0,
      tackles: stats.tackles ?? 0,
      sacks: stats.sacks ?? 0,
      interceptions: stats.interceptions ?? 0,
    },
  };
}

function compareStandings(a, b) {
  if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
  if (a.record.losses !== b.record.losses) return a.record.losses - b.record.losses;
  if (b.record.ties !== a.record.ties) return b.record.ties - a.record.ties;
  if (b.diff !== a.diff) return b.diff - a.diff;
  if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
  if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst;
  if ((b.passingYards ?? 0) !== (a.passingYards ?? 0)) return (b.passingYards ?? 0) - (a.passingYards ?? 0);
  return (a.name || '').localeCompare(b.name || '');
}

function buildStandings(season) {
  const entries = Object.values(season?.teams || {}).map((team) => {
    const record = normalizeRecord(team.record);
    const pointsFor = team.pointsFor || 0;
    const pointsAgainst = team.pointsAgainst || 0;
    const passingYards = team.stats?.passingYards ?? 0;
    return {
      id: team.id,
      name: team.info?.displayName || team.id,
      record,
      diff: pointsFor - pointsAgainst,
      pointsFor,
      pointsAgainst,
      passingYards,
    };
  });
  return entries.sort(compareStandings);
}

export function computeStandings(season) {
  return buildStandings(season);
}

export function computeAssignmentTotals(scheduleLength, offset, stride) {
  if (!Number.isFinite(scheduleLength) || scheduleLength <= 0) return 0;
  const safeStride = Math.max(1, stride || 1);
  const safeOffset = Math.min(Math.max(0, offset || 0), scheduleLength);
  return Math.max(0, Math.ceil((scheduleLength - safeOffset) / safeStride));
}

export function recomputeAssignmentTotals(season) {
  if (!season) return;
  const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
  const offset = season.assignmentOffset ?? season.assignment?.offset ?? 0;
  const totalGames = computeAssignmentTotals(season.schedule?.length || 0, offset, stride);
  if (season.assignment) {
    season.assignment.totalGames = totalGames;
  }
  season.assignmentStride = stride;
  season.assignmentOffset = offset;
  season.assignmentTotalGames = totalGames;
}

function registerAward(league, key, info, seasonNumber) {
  if (!league || !info?.playerId) return;
  if (!league.playerAwards[info.playerId]) {
    league.playerAwards[info.playerId] = [];
  }
  const existing = league.playerAwards[info.playerId].find((entry) => entry.season === seasonNumber && entry.award === key);
  if (!existing) {
    league.playerAwards[info.playerId].push({
      season: seasonNumber,
      award: key,
      teamId: info.teamId || null,
    });
  }
}

function ensureAwardsHistory(league, seasonNumber, awards) {
  if (!league || !awards) return;
  const already = league.awardsHistory.find((entry) => entry.seasonNumber === seasonNumber);
  if (!already) {
    league.awardsHistory.push({ seasonNumber, ...awards });
  }
}

function offenseScore(stat = {}) {
  const passing = stat.passing || {};
  const rushing = stat.rushing || {};
  const receiving = stat.receiving || {};
  return (
    (passing.yards || 0) * 0.04 +
    (passing.touchdowns || 0) * 6 -
    (passing.interceptions || 0) * 5 +
    (rushing.yards || 0) * 0.085 +
    (rushing.touchdowns || 0) * 6 -
    (rushing.fumbles || 0) * 4 +
    (receiving.yards || 0) * 0.085 +
    (receiving.touchdowns || 0) * 6 -
    (receiving.drops || 0) * 2
  );
}

function defenseScore(stat = {}) {
  const defense = stat.defense || {};
  return (
    (defense.tackles || 0) * 1.2 +
    (defense.sacks || 0) * 6.5 +
    (defense.interceptions || 0) * 7 +
    (defense.forcedFumbles || 0) * 6
  );
}

function mvpScore(stat = {}) {
  const off = offenseScore(stat);
  const def = defenseScore(stat) * 0.75;
  const passing = stat.passing || {};
  const misc = (passing.completions || 0) * 0.4 - (stat.misc?.fumbles || 0) * 3;
  return off + def + misc;
}

function pickAwardWinner(stats, directory, scoreFn) {
  let best = null;
  Object.entries(stats || {}).forEach(([playerId, stat]) => {
    const score = scoreFn(stat);
    if (score <= 0) return;
    if (!best || score > best.score) {
      best = {
        playerId,
        score,
        teamId: directory?.[playerId]?.teamId || null,
        name: directory?.[playerId]?.fullName || null,
      };
    }
  });
  return best;
}

export function computeSeasonAwards(season, league) {
  if (!season) return null;
  if (season.awards) return season.awards;
  const stats = season.playerStats || {};
  if (!Object.keys(stats).length) return null;
  const directory = league?.playerDirectory || {};
  const mvp = pickAwardWinner(stats, directory, mvpScore);
  const offensive = pickAwardWinner(stats, directory, offenseScore);
  const defensive = pickAwardWinner(stats, directory, defenseScore);
  const awards = {
    seasonNumber: season.seasonNumber,
    mvp,
    offensive,
    defensive,
  };
  season.awards = cloneAwards(awards);
  if (league) {
    registerAward(league, 'MVP', mvp, season.seasonNumber);
    registerAward(league, 'Offensive Player', offensive, season.seasonNumber);
    registerAward(league, 'Defensive Player', defensive, season.seasonNumber);
    ensureAwardsHistory(league, season.seasonNumber, awards);
  }
  return season.awards;
}

function buildSemifinalGame({
  seasonNumber,
  homeTeam,
  awayTeam,
  index,
  order,
  seeds = [],
  meta = {},
}) {
  const normalizedSeeds = Array.isArray(seeds)
    ? seeds.filter((seed) => Number.isFinite(seed)).slice(0, 2)
    : [];
  const mergedMeta = { ...(meta || {}), order };
  if (normalizedSeeds.length === 2) {
    mergedMeta.seeds = normalizedSeeds;
  }
  return {
    id: `PO${String(seasonNumber).padStart(2, '0')}-SF${order}`,
    homeTeam,
    awayTeam,
    tag: 'playoff-semifinal',
    round: `Semifinal ${order}`,
    index,
    week: null,
    slot: order - 1,
    meta: mergedMeta,
  };
}

const PLAYOFF_STAGE_ORDER = { regular: 0, semifinals: 1, championship: 2, complete: 3 };

function stageRank(stage) {
  return PLAYOFF_STAGE_ORDER[stage] ?? -1;
}

function inferRegularSeasonLength(season) {
  if (!season) return 0;
  if (Number.isFinite(season.regularSeasonWeeks) && season.regularSeasonWeeks > 0) {
    return season.regularSeasonWeeks;
  }
  if (Number.isFinite(season.regularSeasonLength) && season.regularSeasonLength > 0) {
    const teams = Object.keys(season?.teams || {}).length || TEAM_IDS.length;
    return Math.max(1, Math.ceil(season.regularSeasonLength / Math.max(1, Math.floor(teams / 2))));
  }
  const schedule = Array.isArray(season.schedule) ? season.schedule : [];
  return computeRegularSeasonWeeks(schedule, Object.keys(season?.teams || {}).length || TEAM_IDS.length);
}

function alignIndexToAssignmentStride(season, desiredIndex = 0) {
  if (!season) return Math.max(0, desiredIndex || 0);
  const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
  const rawOffset = season.assignmentOffset ?? season.assignment?.offset ?? 0;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
  let target = Number.isFinite(desiredIndex) ? Math.max(desiredIndex, 0) : 0;
  target = Math.max(target, offset);
  if (stride <= 1) return target;
  const remainder = ((target - offset) % stride + stride) % stride;
  if (remainder === 0) return target;
  return target + (stride - remainder);
}

function listRegularSeasonGames(season) {
  const schedule = Array.isArray(season?.schedule) ? season.schedule : [];
  return schedule.filter((game) => {
    if (!game) return false;
    const tag = String(game.tag || '');
    return !tag.startsWith('playoff');
  });
}

function regularSeasonComplete(season) {
  if (!season) return false;
  const games = listRegularSeasonGames(season);
  if (!games.length) return false;
  return games.every((game) => game?.played);
}

function extractSemifinalOrder(entry) {
  if (!entry) return null;
  if (Number.isFinite(entry.order)) return entry.order;
  if (Number.isFinite(entry?.meta?.order)) return entry.meta.order;
  if (Number.isFinite(entry.slot)) return entry.slot + 1;
  return null;
}

function ensureSemifinalBracket(season, seeds) {
  if (!season || !Array.isArray(seeds) || seeds.length < 4) return null;
  const normalizedSeeds = seeds.slice(0, 4).map((id) => id || null);
  const bracket = season.playoffBracket && stageRank(season.playoffBracket.stage) >= stageRank('semifinals')
    ? season.playoffBracket
    : {
        stage: 'semifinals',
        seeds: [...normalizedSeeds],
        semifinalGames: [],
        championshipGame: null,
        champion: null,
      };

  bracket.stage = 'semifinals';
  bracket.seeds = [...normalizedSeeds];
  bracket.champion = null;
  if (bracket.championshipGame && stageRank(bracket.stage) <= stageRank('semifinals')) {
    bracket.championshipGame = null;
  }

  const existingGames = Array.isArray(bracket.semifinalGames) ? bracket.semifinalGames : [];

  const mergeEntry = (order, homeTeam, awayTeam, seedsPair) => {
    const existing = existingGames.find((entry) => extractSemifinalOrder(entry) === order) || existingGames[order - 1] || null;
    const label = existing?.label || existing?.round || `Semifinal ${order}`;
    const merged = {
      index: Number.isFinite(existing?.index) ? existing.index : null,
      winner: existing?.winner || null,
      homeTeam,
      awayTeam,
      label,
      order,
      slot: order - 1,
      meta: { ...(existing?.meta || {}), order, seeds: seedsPair },
    };
    if (existing?.score) {
      merged.score = { ...existing.score };
    }
    return merged;
  };

  bracket.semifinalGames = [
    mergeEntry(1, normalizedSeeds[0], normalizedSeeds[3], [1, 4]),
    mergeEntry(2, normalizedSeeds[1], normalizedSeeds[2], [2, 3]),
  ];

  season.playoffBracket = bracket;
  season.phase = 'semifinals';
  return bracket;
}

function alignSemifinalScheduleWithBracket(season) {
  const bracket = season?.playoffBracket;
  if (!season || !bracket || bracket.stage !== 'semifinals') return [];
  const games = Array.isArray(bracket.semifinalGames) ? bracket.semifinalGames : [];
  if (!games.length) return [];

  const added = [];
  season.schedule ||= [];
  const regularWeeks = inferRegularSeasonLength(season);
  if (!Number.isFinite(season.regularSeasonWeeks) || season.regularSeasonWeeks <= 0) {
    season.regularSeasonWeeks = regularWeeks;
  }
  const regularGames = Number.isFinite(season.regularSeasonLength)
    ? season.regularSeasonLength
    : (season.schedule ? season.schedule.filter((game) => game && !String(game.tag || '').startsWith('playoff')).length : 0);
  const existingIndices = games
    .map((entry) => (Number.isFinite(entry?.index) ? entry.index : null))
    .filter((index) => index != null);

  const canonicalSeason =
    season.assignmentOffset || season.assignment?.offset
      ? {
          ...season,
          assignmentOffset: 0,
          assignment: season.assignment ? { ...season.assignment, offset: 0 } : season.assignment,
        }
      : season;

  const desiredStart = existingIndices.length ? Math.min(...existingIndices) : season.schedule.length;
  const alignedStart = alignIndexToAssignmentStride(
    canonicalSeason,
    Math.max(desiredStart, regularGames, season.schedule.length),
  );
  const validExisting = existingIndices.filter((index) => Number.isFinite(index) && index >= regularGames);
  let allocationCursor = validExisting.length
    ? Math.max(alignedStart, Math.max(...validExisting) + 1)
    : alignedStart;
  const usedIndices = new Set();
  const baseWeek = Math.max(1, regularWeeks || 0) + 1;

  while (season.schedule.length < alignedStart) {
    season.schedule.push(null);
  }

  games.forEach((entry, idx) => {
    if (!entry) return;
    const order = Number.isFinite(entry.order) ? entry.order : idx + 1;
    const seedsPair = Array.isArray(entry?.meta?.seeds)
      ? entry.meta.seeds.slice(0, 2)
      : [];

    let targetIndex = Number.isFinite(entry.index) ? entry.index : null;
    const hasValidExistingIndex =
      targetIndex != null && targetIndex >= regularGames && !usedIndices.has(targetIndex);

    if (!hasValidExistingIndex) {
      if (Number.isFinite(targetIndex) && targetIndex < regularGames) {
        const previous = season.schedule[targetIndex];
        if (previous?.tag === 'playoff-semifinal' && !previous?.played) {
          season.schedule[targetIndex] = null;
        }
      }

      let candidate = Math.max(allocationCursor, regularGames);
      while (usedIndices.has(candidate)) {
        candidate += 1;
      }
      targetIndex = candidate;
      allocationCursor = candidate + 1;
    } else {
      allocationCursor = Math.max(allocationCursor, targetIndex + 1);
    }

    if (Number.isFinite(entry.index) && entry.index !== targetIndex) {
      const previous = season.schedule[entry.index];
      if (previous?.tag === 'playoff-semifinal' && !previous?.played) {
        season.schedule[entry.index] = null;
      }
    }

    while (season.schedule.length <= targetIndex) {
      season.schedule.push(null);
    }

    const existing = season.schedule[targetIndex];
    const needsCreate = !existing || existing.tag !== 'playoff-semifinal';

    const order = idx + 1;
    const seedsPair = Array.isArray(entry?.meta?.seeds)
      ? entry.meta.seeds.slice(0, 2)
      : [];
    const game = buildSemifinalGame({
      seasonNumber: season.seasonNumber,
      homeTeam: entry.homeTeam,
      awayTeam: entry.awayTeam,
      index: targetIndex,
      order,
      seeds: seedsPair,
      meta: entry.meta || {},
    });

    const scheduled = {
      ...(existing || {}),
      ...game,
      id: existing?.id || game.id,
      index: targetIndex,
      round: entry.label || existing?.round || game.round,
      week: baseWeek,
      slot: idx,
      meta: { ...(existing?.meta || {}), ...(entry?.meta || {}), order },
    };

    season.schedule[targetIndex] = scheduled;

    bracket.semifinalGames[idx] = {
      ...entry,
      index: targetIndex,
      homeTeam: scheduled.homeTeam,
      awayTeam: scheduled.awayTeam,
      label: scheduled.round,
      order,
      slot: order - 1,
      meta: { ...(entry?.meta || {}), order, seeds: seedsPair.length ? seedsPair : entry?.meta?.seeds || [] },
    };

    if (needsCreate || targetIndex !== entry.index) {
      if (!added.includes(targetIndex)) {
        added.push(targetIndex);
      }
    }

    usedIndices.add(targetIndex);
  });

  season.phase = 'semifinals';
  return added;
}

export function ensurePlayoffsScheduled(season, league) {
  if (!season) return [];
  const bracketStage = season.playoffBracket?.stage || 'regular';
  if (stageRank(bracketStage) > stageRank('semifinals')) {
    return [];
  }

  if (bracketStage === 'regular' && !regularSeasonComplete(season)) {
    return [];
  }

  const standings = buildStandings(season);
  const seeds = standings.slice(0, 4).map((entry) => entry.id).filter(Boolean);
  if (seeds.length < 4) return [];

  season.regularSeasonStandings = standings;

  const bracket = ensureSemifinalBracket(season, seeds);
  if (!bracket) return [];

  const aligned = alignSemifinalScheduleWithBracket(season);
  if (aligned.length) {
    recomputeAssignmentTotals(season);
  }

  computeSeasonAwards(season, league);
  return aligned;
}

export function ensureChampionshipScheduled(season) {
  if (!season?.playoffBracket) return [];
  const bracket = season.playoffBracket;
  if (bracket.stage !== 'semifinals') return [];
  const winners = bracket.semifinalGames.filter((game) => game.winner);
  if (winners.length < 2) return [];
  if (bracket.championshipGame) return [];
  const seeds = bracket.seeds || [];
  winners.sort((a, b) => seeds.indexOf(a.winner) - seeds.indexOf(b.winner));
  const homeTeam = winners[0].winner;
  const awayTeam = winners[1].winner;
  if (!homeTeam || !awayTeam) return [];

  const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
  const rawOffset = season.assignmentOffset ?? season.assignment?.offset ?? 0;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
  season.schedule ||= [];
  const scheduleLength = season.schedule.length;

  let index = Number.isFinite(season.currentGameIndex) ? season.currentGameIndex : scheduleLength;
  if (!Number.isFinite(index) || index < 0) index = scheduleLength;

  index = Math.max(index, scheduleLength, offset);

  const remainder = ((index - offset) % stride + stride) % stride;
  if (remainder !== 0) {
    index += stride - remainder;
  }

  while (season.schedule.length <= index) {
    season.schedule.push(null);
  }

  const regularWeeks = inferRegularSeasonLength(season);
  if (!Number.isFinite(season.regularSeasonWeeks) || season.regularSeasonWeeks <= 0) {
    season.regularSeasonWeeks = regularWeeks;
  }
  const entry = {
    id: `PO${String(season.seasonNumber).padStart(2, '0')}-CH`,
    homeTeam,
    awayTeam,
    tag: 'playoff-championship',
    round: 'BluperBowl',
    index,
    week: Math.max(1, regularWeeks) + 2,
    slot: 0,
    meta: { seeds: [seeds.indexOf(homeTeam) + 1, seeds.indexOf(awayTeam) + 1] },
  };
  season.schedule[index] = { ...(season.schedule[index] || {}), ...entry };
  bracket.championshipGame = {
    index,
    winner: null,
    homeTeam,
    awayTeam,
    label: 'BluperBowl',
  };
  bracket.stage = 'championship';
  season.phase = 'championship';
  recomputeAssignmentTotals(season);
  return [index];
}

export function registerChampion(season, league, result) {
  if (!season || !result) return;
  const winner = result.winner;
  if (!winner) return;
  season.championTeamId = winner;
  season.championResult = { ...result };
  season.phase = 'complete';
  season.playoffBracket ||= { stage: 'complete', champion: winner };
  if (season.playoffBracket.championshipGame) {
    season.playoffBracket.championshipGame.winner = winner;
  }
  season.playoffBracket.champion = winner;
  season.playoffBracket.stage = 'complete';
  if (league) {
    league.lastChampion = { teamId: winner, seasonNumber: season.seasonNumber };
    if (!league.teamChampionships[winner]) {
      league.teamChampionships[winner] = { count: 0, seasons: [] };
    }
    const record = league.teamChampionships[winner];
    if (!record.seasons.includes(season.seasonNumber)) {
      record.count += 1;
      record.seasons.push(season.seasonNumber);
    }
  }
}

function determinePlayoffOutcome(season, teamId) {
  if (!season || !teamId) return 'Regular Season';
  const bracket = season.playoffBracket || {};
  if (season.championTeamId === teamId || bracket.champion === teamId) {
    return 'Champion';
  }
  const champ = bracket.championshipGame || null;
  if (champ && (champ.homeTeam === teamId || champ.awayTeam === teamId)) {
    if (champ.winner === teamId) return 'Champion';
    if (champ.winner) return 'Runner-Up';
    return 'Championship';
  }
  const semifinal = (bracket.semifinalGames || []).find(
    (game) => game && (game.homeTeam === teamId || game.awayTeam === teamId),
  );
  if (semifinal) {
    if (semifinal.winner === teamId) {
      return 'Championship';
    }
    if (semifinal.winner) {
      return 'Semifinalist';
    }
    return 'Playoffs';
  }
  if (Array.isArray(bracket.seeds) && bracket.seeds.includes(teamId)) {
    return 'Playoffs';
  }
  return bracket.stage && bracket.stage !== 'regular' ? 'Playoffs' : 'Regular Season';
}

function cloneHistoryRecord(record) {
  return {
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    ties: record?.ties ?? 0,
  };
}

export function recordTeamSeasonHistory(league, season) {
  if (!league || !season) return;
  const seasonNumber = season.seasonNumber ?? league.seasonNumber ?? 1;
  league.teamSeasonHistory ||= {};
  Object.values(season.teams || {}).forEach((team) => {
    if (!team?.id) return;
    const entry = {
      seasonNumber,
      record: cloneHistoryRecord(team.record),
      postseasonRecord: cloneHistoryRecord(team.postseasonRecord),
      pointsFor: team.pointsFor ?? 0,
      pointsAgainst: team.pointsAgainst ?? 0,
      pointDifferential: (team.pointsFor ?? 0) - (team.pointsAgainst ?? 0),
      playoffResult: determinePlayoffOutcome(season, team.id),
    };
    if (!league.teamSeasonHistory[team.id]) {
      league.teamSeasonHistory[team.id] = [entry];
      return;
    }
    const history = league.teamSeasonHistory[team.id];
    const index = history.findIndex((item) => item.seasonNumber === seasonNumber);
    if (index >= 0) {
      history[index] = entry;
    } else {
      history.push(entry);
    }
    history.sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0));
  });
}

export function mergePlayerStatsIntoCareer(careerMap, seasonStats = {}) {
  if (!careerMap) return;
  Object.entries(seasonStats).forEach(([playerId, stat]) => {
    if (!careerMap[playerId]) {
      careerMap[playerId] = clonePlayerSeasonEntry(stat);
      return;
    }
    mergeCategory(careerMap[playerId].passing, stat.passing || {}, ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions', 'sacks', 'sackYards']);
    mergeCategory(careerMap[playerId].rushing, stat.rushing || {}, ['attempts', 'yards', 'touchdowns', 'fumbles']);
    mergeCategory(careerMap[playerId].receiving, stat.receiving || {}, ['targets', 'receptions', 'yards', 'touchdowns', 'drops']);
    mergeCategory(careerMap[playerId].defense, stat.defense || {}, ['tackles', 'sacks', 'interceptions', 'forcedFumbles']);
    mergeCategory(careerMap[playerId].misc, stat.misc || {}, ['fumbles']);
    mergeCategory(careerMap[playerId].kicking, stat.kicking || {}, ['attempts', 'made', 'long', 'patAttempts', 'patMade']);
  });
}

export function incrementPlayerAges(league) {
  if (!league) return;
  if (league.playerAges) {
    Object.keys(league.playerAges).forEach((playerId) => {
      league.playerAges[playerId] = (league.playerAges[playerId] || 0) + 1;
    });
  }
  advanceContractsForNewSeason(league);
}

function decayDevelopment(map, retention = 0.88) {
  Object.entries(map || {}).forEach(([playerId, attrs]) => {
    Object.entries(attrs || {}).forEach(([attr, value]) => {
      const next = value * retention;
      if (Math.abs(next) < 1e-3) delete attrs[attr];
      else attrs[attr] = next;
    });
    if (!Object.keys(attrs || {}).length) delete map[playerId];
  });
}

function adjustDevelopment(map, playerId, attr, amount) {
  if (!map[playerId]) map[playerId] = {};
  const current = map[playerId][attr] || 0;
  const next = clamp(current + amount, -0.5, 0.65);
  if (Math.abs(next) < 1e-3) {
    delete map[playerId][attr];
    if (!Object.keys(map[playerId]).length) delete map[playerId];
  } else {
    map[playerId][attr] = next;
  }
}

export function applyOffseasonDevelopment(league) {
  if (!league) return;
  league.playerDevelopment ||= {};
  decayDevelopment(league.playerDevelopment, 0.9);
  Object.entries(league.playerAges || {}).forEach(([playerId, age]) => {
    let base;
    if (age <= 25) base = rand(0.02, 0.08);
    else if (age <= 28) base = rand(-0.01, 0.05);
    else if (age <= 32) base = rand(-0.05, 0.03);
    else base = rand(-0.08, -0.015);
    ATTRIBUTE_KEYS.forEach((attr) => {
      const variance = rand(-0.015, 0.015);
      adjustDevelopment(league.playerDevelopment, playerId, attr, base + variance);
    });
  });
}

function clonePlayerSeasonEntry(entry) {
  if (!entry) {
    return {
      passing: { attempts: 0, completions: 0, yards: 0, touchdowns: 0, interceptions: 0, sacks: 0, sackYards: 0 },
      rushing: { attempts: 0, yards: 0, touchdowns: 0, fumbles: 0 },
      receiving: { targets: 0, receptions: 0, yards: 0, touchdowns: 0, drops: 0 },
      defense: { tackles: 0, sacks: 0, interceptions: 0 },
      misc: { fumbles: 0 },
      kicking: { attempts: 0, made: 0, long: 0, patAttempts: 0, patMade: 0 },
    };
  }

  return {
    passing: {
      attempts: entry.passing?.attempts ?? 0,
      completions: entry.passing?.completions ?? 0,
      yards: entry.passing?.yards ?? 0,
      touchdowns: entry.passing?.touchdowns ?? 0,
      interceptions: entry.passing?.interceptions ?? 0,
      sacks: entry.passing?.sacks ?? 0,
      sackYards: entry.passing?.sackYards ?? 0,
    },
    rushing: {
      attempts: entry.rushing?.attempts ?? 0,
      yards: entry.rushing?.yards ?? 0,
      touchdowns: entry.rushing?.touchdowns ?? 0,
      fumbles: entry.rushing?.fumbles ?? 0,
    },
    receiving: {
      targets: entry.receiving?.targets ?? 0,
      receptions: entry.receiving?.receptions ?? 0,
      yards: entry.receiving?.yards ?? 0,
      touchdowns: entry.receiving?.touchdowns ?? 0,
      drops: entry.receiving?.drops ?? 0,
    },
    defense: {
      tackles: entry.defense?.tackles ?? 0,
      sacks: entry.defense?.sacks ?? 0,
      interceptions: entry.defense?.interceptions ?? 0,
    },
    misc: {
      fumbles: entry.misc?.fumbles ?? 0,
    },
    kicking: {
      attempts: entry.kicking?.attempts ?? 0,
      made: entry.kicking?.made ?? 0,
      long: entry.kicking?.long ?? 0,
      patAttempts: entry.kicking?.patAttempts ?? 0,
      patMade: entry.kicking?.patMade ?? 0,
    },
  };
}

function ensureSeasonPlayerEntry(season, playerId) {
  season.playerStats ||= {};
  const existing = season.playerStats[playerId];
  if (existing) {
    season.playerStats[playerId] = clonePlayerSeasonEntry(existing);
    return season.playerStats[playerId];
  }

  const fresh = clonePlayerSeasonEntry(null);
  season.playerStats[playerId] = fresh;
  return fresh;
}

function mergeCategory(target, source, keys) {
  keys.forEach((key) => {
    const t = target[key] || 0;
    const s = source[key] || 0;
    target[key] = t + s;
  });
}

export function mergePlayerStatsIntoSeason(season, playerStats = {}) {
  season.playerStats ||= {};
  Object.entries(playerStats).forEach(([playerId, stat]) => {
    const entry = ensureSeasonPlayerEntry(season, playerId);
    if (!entry) return;
    mergeCategory(entry.passing, stat.passing || {}, ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions', 'sacks', 'sackYards']);
    mergeCategory(entry.rushing, stat.rushing || {}, ['attempts', 'yards', 'touchdowns', 'fumbles']);
    mergeCategory(entry.receiving, stat.receiving || {}, ['targets', 'receptions', 'yards', 'touchdowns', 'drops']);
    mergeCategory(entry.defense, stat.defense || {}, ['tackles', 'sacks', 'interceptions', 'forcedFumbles']);
    mergeCategory(entry.misc, stat.misc || {}, ['fumbles']);
    mergeCategory(entry.kicking, stat.kicking || {}, ['attempts', 'made', 'long', 'patAttempts', 'patMade']);
  });
}

export function accumulateTeamStatsFromPlayers(season, directory = {}, playerStats = {}) {
  Object.entries(playerStats).forEach(([playerId, stat]) => {
    const meta = directory[playerId];
    if (!meta) return;
    const teamEntry = season.teams[meta.team];
    if (!teamEntry) return;
    const { stats: totals } = teamEntry;
    const passing = stat.passing || {};
    const rushing = stat.rushing || {};
    const receiving = stat.receiving || {};
    const defense = stat.defense || {};

    totals.passingYards += passing.yards || 0;
    totals.passingTD += passing.touchdowns || 0;
    totals.rushingYards += rushing.yards || 0;
    totals.rushingTD += rushing.touchdowns || 0;
    totals.receivingYards += receiving.yards || 0;
    totals.receivingTD += receiving.touchdowns || 0;
    totals.tackles += defense.tackles || 0;
    totals.sacks += defense.sacks || 0;
    totals.interceptions += defense.interceptions || 0;
  });
}

export function applyGameResultToSeason(season, game, scores, directory, playerStats, playLog = []) {
  if (!season || !game) return season;
  const homeId = game.homeTeam;
  const awayId = game.awayTeam;
  const homeScore = scores?.[TEAM_RED] ?? 0;
  const awayScore = scores?.[TEAM_BLK] ?? 0;
  const tag = game.tag || null;

  const playerStatsClone = clonePlayerStatsSnapshot(playerStats || {});
  const playerTeams = extractPlayerTeams(directory || {});

  let winner = null;
  let decidedBy = null;
  if (homeScore > awayScore) {
    winner = homeId;
  } else if (awayScore > homeScore) {
    winner = awayId;
  }

  if (!winner && (tag === 'playoff-semifinal' || tag === 'playoff-championship')) {
    const playoffWinner = pickPlayoffWinnerBySeed(season?.playoffBracket, homeId, awayId);
    if (playoffWinner) {
      winner = playoffWinner;
      decidedBy = 'seed';
    }
  }

  const result = {
    gameId: game.id,
    index: game.index,
    homeTeamId: homeId,
    awayTeamId: awayId,
    score: { [homeId]: homeScore, [awayId]: awayScore },
    winner,
    decidedBy,
    playLog: Array.isArray(playLog) ? [...playLog] : [],
    tag,
    playerStats: playerStatsClone,
    playerTeams,
  };

  const nextSeasonTeams = {};
  Object.entries(season.teams || {}).forEach(([teamId, team]) => {
    nextSeasonTeams[teamId] = cloneTeamSeasonEntry(team);
  });

  const nextSeason = {
    ...season,
    teams: nextSeasonTeams,
    schedule: [...(season.schedule || [])],
    results: Array.isArray(season.results) ? season.results.filter(Boolean) : [],
    playerStats: {},
    assignmentTotals: cloneAssignmentTotalsMap(season.assignmentTotals, nextSeasonTeams),
    playoffBracket: clonePlayoffBracket(season.playoffBracket),
  };

  const existingIndex = nextSeason.results.findIndex((entry) => entry && entry.index === game.index);
  if (existingIndex >= 0) {
    nextSeason.results[existingIndex] = result;
  } else {
    nextSeason.results.push(result);
  }
  nextSeason.results.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  nextSeason.completedGames = nextSeason.results.length;

  if (nextSeason.schedule[game.index]) {
    nextSeason.schedule[game.index] = { ...nextSeason.schedule[game.index], ...game, played: true, result };
  } else {
    nextSeason.schedule[game.index] = { ...game, played: true, result };
  }

  if (tag === 'playoff-semifinal' && nextSeason.playoffBracket) {
    const semifinal = nextSeason.playoffBracket.semifinalGames?.find((entry) => entry.index === game.index);
    if (semifinal) {
      semifinal.winner = result.winner;
      semifinal.score = result.score;
    }
    ensureChampionshipScheduled(nextSeason);
  } else if (tag === 'playoff-championship' && nextSeason.playoffBracket) {
    if (!nextSeason.playoffBracket.championshipGame || nextSeason.playoffBracket.championshipGame.index === game.index) {
      nextSeason.playoffBracket.championshipGame = {
        ...(nextSeason.playoffBracket.championshipGame || {}),
        index: game.index,
        winner: result.winner,
        score: result.score,
        homeTeam: homeId,
        awayTeam: awayId,
        label: 'BluperBowl',
      };
    }
  }

  recalculateSeasonAggregates(nextSeason);

  return nextSeason;
}

function pickPlayoffWinnerBySeed(bracket, homeId, awayId) {
  if (!bracket) return null;
  const seeds = Array.isArray(bracket.seeds) ? bracket.seeds : [];
  const homeSeed = seeds.indexOf(homeId);
  const awaySeed = seeds.indexOf(awayId);
  if (homeSeed === -1 && awaySeed === -1) return homeId || awayId || null;
  if (homeSeed === -1) return awayId;
  if (awaySeed === -1) return homeId;
  if (homeSeed === awaySeed) return homeId || awayId || null;
  return homeSeed < awaySeed ? homeId : awayId;
}

function recalculateSeasonAggregates(season) {
  if (!season) return;

  const teams = {};
  const assignmentTotals = {};
  const infoLookup = {};

  Object.entries(season.teams || {}).forEach(([teamId, team]) => {
    teams[teamId] = createZeroTeamSummary(teamId, team?.info || null);
    infoLookup[teamId] = teams[teamId].info || null;
  });

  Object.entries(season.assignmentTotals || {}).forEach(([teamId, entry]) => {
    assignmentTotals[teamId] = createZeroTeamSummary(teamId, entry?.info || infoLookup[teamId] || null);
    if (!infoLookup[teamId]) {
      infoLookup[teamId] = assignmentTotals[teamId].info || null;
    }
  });

  TEAM_IDS.forEach((teamId) => {
    if (!teams[teamId]) {
      teams[teamId] = createZeroTeamSummary(teamId, getTeamIdentity(teamId) || null);
    }
    if (!assignmentTotals[teamId]) {
      assignmentTotals[teamId] = createZeroTeamSummary(teamId, teams[teamId].info || null);
    }
    if (!infoLookup[teamId]) {
      infoLookup[teamId] = teams[teamId].info || assignmentTotals[teamId].info || null;
    }
  });

  const aggregatedPlayers = { playerStats: {} };

  const results = Array.isArray(season.results) ? season.results.filter(Boolean) : [];
  results.forEach((result) => {
    const homeId = result.homeTeamId;
    const awayId = result.awayTeamId;
    const score = result.score || {};
    const gamePlayerStats = result.playerStats || {};
    const gamePlayerTeams = result.playerTeams || {};
    const isPostseason = (result.tag || '').startsWith('playoff-');
    const scope = isPostseason ? 'postseason' : 'regular';

    const homeScore = score[homeId] ?? 0;
    const awayScore = score[awayId] ?? 0;

    const homeTeam = ensureTeamSummary(teams, homeId, infoLookup);
    const awayTeam = ensureTeamSummary(teams, awayId, infoLookup);
    const homeTotals = ensureTeamSummary(assignmentTotals, homeId, infoLookup);
    const awayTotals = ensureTeamSummary(assignmentTotals, awayId, infoLookup);

    applyScoreToSummary(homeTeam, homeScore, awayScore);
    applyScoreToSummary(awayTeam, awayScore, homeScore);
    applyScoreToSummary(homeTotals, homeScore, awayScore);
    applyScoreToSummary(awayTotals, awayScore, homeScore);

    if (homeScore > awayScore) {
      registerOutcome(homeTeam, 'win', scope);
      registerOutcome(awayTeam, 'loss', scope);
      registerOutcome(homeTotals, 'win', scope);
      registerOutcome(awayTotals, 'loss', scope);
    } else if (awayScore > homeScore) {
      registerOutcome(awayTeam, 'win', scope);
      registerOutcome(homeTeam, 'loss', scope);
      registerOutcome(awayTotals, 'win', scope);
      registerOutcome(homeTotals, 'loss', scope);
    } else {
      registerOutcome(homeTeam, 'tie', scope);
      registerOutcome(awayTeam, 'tie', scope);
      registerOutcome(homeTotals, 'tie', scope);
      registerOutcome(awayTotals, 'tie', scope);
    }

    const directory = {};
    Object.entries(gamePlayerTeams).forEach(([playerId, teamId]) => {
      if (!playerId || !teamId) return;
      directory[playerId] = { team: teamId };
      if (!infoLookup[teamId]) {
        infoLookup[teamId] = getTeamIdentity(teamId) || null;
      }
      ensureTeamSummary(teams, teamId, infoLookup);
      ensureTeamSummary(assignmentTotals, teamId, infoLookup);
    });

    accumulateTeamStatsFromPlayers({ teams }, directory, gamePlayerStats);
    accumulateTeamStatsFromPlayers({ teams: assignmentTotals }, directory, gamePlayerStats);
    mergePlayerStatsIntoSeason(aggregatedPlayers, gamePlayerStats);
  });

  season.teams = teams;
  season.assignmentTotals = assignmentTotals;
  season.playerStats = aggregatedPlayers.playerStats || {};
}

export function prepareSeasonMatchup(season) {
  if (!season) return null;
  const game = season.schedule[season.currentGameIndex];
  return createMatchupFromGame(game);
}

export function advanceSeasonPointer(season) {
  if (!season) return null;
  const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
  const scheduleLength = season.schedule?.length ?? 0;
  const currentIndex = Number.isFinite(season.currentGameIndex) ? season.currentGameIndex : 0;

  let nextIndex = currentIndex + stride;
  const indicesToCheck = [];
  if (nextIndex < scheduleLength) {
    indicesToCheck.push(nextIndex);
  }

  for (let idx = currentIndex + 1; idx < scheduleLength; idx += 1) {
    if (idx === nextIndex) continue;
    indicesToCheck.push(idx);
  }

  for (let idx = 0; idx < indicesToCheck.length; idx += 1) {
    const targetIndex = indicesToCheck[idx];
    const entry = season.schedule[targetIndex];
    if (!entry) continue;
    if (entry.played) continue;
    season.currentGameIndex = targetIndex;
    return prepareSeasonMatchup(season);
  }

  season.currentGameIndex = nextIndex;
  return null;
}

export function seasonCompleted(season) {
  if (!season) return true;
  return season.currentGameIndex >= season.schedule.length;
}

export function getTeamRecord(season, teamId) {
  const entry = season?.teams?.[teamId];
  if (!entry) return cloneRecord();
  return cloneRecord(entry.record);
}

export function getTeamInfo(season, teamId) {
  return season?.teams?.[teamId]?.info || getTeamIdentity(teamId) || null;
}

export function getTeamColors(teamId) {
  const data = getTeamData(teamId);
  return data?.colors || {};
}
