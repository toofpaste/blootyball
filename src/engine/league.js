import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { TEAM_RED, TEAM_BLK } from './constants';

function cloneRecord(record) {
  return {
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    ties: record?.ties ?? 0,
  };
}

export function formatRecord(record) {
  if (!record) return '0-0-0';
  const { wins = 0, losses = 0, ties = 0 } = record;
  return `${wins}-${losses}-${ties}`;
}

export function generateSeasonSchedule(teamIds = TEAM_IDS) {
  const ids = [...teamIds];
  if (!ids.length) return [];

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

  const weeks = [...firstLegWeeks, ...rematchWeeks, ...extraWeeks];

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

export function createSeasonState() {
  const schedule = generateSeasonSchedule();
  const teams = {};
  TEAM_IDS.forEach((id) => {
    const info = getTeamIdentity(id) || { id, name: id, city: id, abbr: id, colors: {} };
    teams[id] = {
      id,
      info,
      record: { wins: 0, losses: 0, ties: 0 },
      pointsFor: 0,
      pointsAgainst: 0,
      stats: {
        passingYards: 0,
        passingTD: 0,
        rushingYards: 0,
        rushingTD: 0,
        receivingYards: 0,
        receivingTD: 0,
        tackles: 0,
        sacks: 0,
        interceptions: 0,
      },
    };
  });

  return {
    seasonNumber: 1,
    teams,
    schedule,
    currentGameIndex: 0,
    completedGames: 0,
    results: [],
    playerStats: {},
    playerDevelopment: {},
    relationships: {},
    coachStates: {},
  };
}

export function createMatchupFromGame(game) {
  if (!game) return null;
  const homeIdentity = getTeamIdentity(game.homeTeam);
  const awayIdentity = getTeamIdentity(game.awayTeam);
  return {
    gameId: game.id,
    index: game.index,
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
  };
}

function cloneTeamSeasonEntry(team) {
  if (!team) return null;
  const record = team.record || {};
  const stats = team.stats || {};
  return {
    ...team,
    record: {
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
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
    mergeCategory(entry.defense, stat.defense || {}, ['tackles', 'sacks', 'interceptions']);
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

  const homeEntry = cloneTeamSeasonEntry(season.teams[homeId]);
  const awayEntry = cloneTeamSeasonEntry(season.teams[awayId]);
  if (!homeEntry || !awayEntry) return season;

  homeEntry.pointsFor = (homeEntry.pointsFor || 0) + homeScore;
  homeEntry.pointsAgainst = (homeEntry.pointsAgainst || 0) + awayScore;
  awayEntry.pointsFor = (awayEntry.pointsFor || 0) + awayScore;
  awayEntry.pointsAgainst = (awayEntry.pointsAgainst || 0) + homeScore;

  if (homeScore > awayScore) {
    homeEntry.record.wins += 1;
    awayEntry.record.losses += 1;
  } else if (awayScore > homeScore) {
    awayEntry.record.wins += 1;
    homeEntry.record.losses += 1;
  } else {
    homeEntry.record.ties += 1;
    awayEntry.record.ties += 1;
  }

  const updatedTeams = {
    ...season.teams,
    [homeId]: homeEntry,
    [awayId]: awayEntry,
  };

  const nextSeason = {
    ...season,
    teams: updatedTeams,
    schedule: [...season.schedule],
    results: [...(season.results || [])],
    playerStats: { ...(season.playerStats || {}) },
  };

  accumulateTeamStatsFromPlayers(nextSeason, directory, playerStats);
  mergePlayerStatsIntoSeason(nextSeason, playerStats);

  const result = {
    gameId: game.id,
    index: game.index,
    homeTeamId: homeId,
    awayTeamId: awayId,
    score: { [homeId]: homeScore, [awayId]: awayScore },
    winner: homeScore === awayScore ? null : (homeScore > awayScore ? homeId : awayId),
    playLog: Array.isArray(playLog) ? [...playLog] : [],
  };
  nextSeason.results.push(result);
  nextSeason.schedule[game.index] = { ...game, played: true, result };
  nextSeason.completedGames = (season.completedGames || 0) + 1;

  return nextSeason;
}

export function prepareSeasonMatchup(season) {
  if (!season) return null;
  const game = season.schedule[season.currentGameIndex];
  return createMatchupFromGame(game);
}

export function advanceSeasonPointer(season) {
  if (!season) return null;
  const nextIndex = season.currentGameIndex + 1;
  if (nextIndex >= season.schedule.length) {
    season.currentGameIndex = nextIndex;
    return null;
  }
  season.currentGameIndex = nextIndex;
  return prepareSeasonMatchup(season);
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
