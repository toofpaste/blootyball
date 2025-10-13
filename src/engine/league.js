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
  const games = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      games.push({ homeTeam: ids[i], awayTeam: ids[j], tag: 'double-a' });
      games.push({ homeTeam: ids[j], awayTeam: ids[i], tag: 'double-b' });
    }
  }

  const extraPairs = [
    [ids[0], ids[1]],
    [ids[2], ids[3]],
    [ids[4], ids[5]],
    [ids[6], ids[7]],
    [ids[0], ids[2]],
    [ids[1], ids[3]],
    [ids[4], ids[6]],
    [ids[5], ids[7]],
  ];

  extraPairs.forEach((pair, idx) => {
    const [a, b] = pair;
    if (idx < extraPairs.length / 2) {
      games.push({ homeTeam: a, awayTeam: b, tag: 'extra-home' });
    } else {
      games.push({ homeTeam: b, awayTeam: a, tag: 'extra-away' });
    }
  });

  return games.map((game, index) => ({
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

function ensureSeasonPlayerEntry(season, playerId) {
  if (!season.playerStats[playerId]) {
    season.playerStats[playerId] = {
      passing: { attempts: 0, completions: 0, yards: 0, touchdowns: 0, interceptions: 0, sacks: 0, sackYards: 0 },
      rushing: { attempts: 0, yards: 0, touchdowns: 0, fumbles: 0 },
      receiving: { targets: 0, receptions: 0, yards: 0, touchdowns: 0, drops: 0 },
      defense: { tackles: 0, sacks: 0, interceptions: 0 },
      misc: { fumbles: 0 },
      kicking: { attempts: 0, made: 0, long: 0, patAttempts: 0, patMade: 0 },
    };
  }
  return season.playerStats[playerId];
}

function mergeCategory(target, source, keys) {
  keys.forEach((key) => {
    const t = target[key] || 0;
    const s = source[key] || 0;
    target[key] = t + s;
  });
}

export function mergePlayerStatsIntoSeason(season, playerStats = {}) {
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
  if (!season || !game) return;
  const homeId = game.homeTeam;
  const awayId = game.awayTeam;
  const homeScore = scores?.[TEAM_RED] ?? 0;
  const awayScore = scores?.[TEAM_BLK] ?? 0;

  const homeEntry = season.teams[homeId];
  const awayEntry = season.teams[awayId];
  if (!homeEntry || !awayEntry) return;

  homeEntry.pointsFor += homeScore;
  homeEntry.pointsAgainst += awayScore;
  awayEntry.pointsFor += awayScore;
  awayEntry.pointsAgainst += homeScore;

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

  accumulateTeamStatsFromPlayers(season, directory, playerStats);
  mergePlayerStatsIntoSeason(season, playerStats);

  const result = {
    gameId: game.id,
    index: game.index,
    homeTeamId: homeId,
    awayTeamId: awayId,
    score: { [homeId]: homeScore, [awayId]: awayScore },
    winner: homeScore === awayScore ? null : (homeScore > awayScore ? homeId : awayId),
    playLog: Array.isArray(playLog) ? [...playLog] : [],
  };
  season.results.push(result);
  season.schedule[game.index] = { ...game, played: true, result };
  season.completedGames += 1;
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
