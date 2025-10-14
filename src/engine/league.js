import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { TEAM_RED, TEAM_BLK } from './constants';
import { clamp, rand } from './helpers';
import {
  initializeLeaguePersonnel,
  ensureSeasonPersonnel,
} from './personnel';

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

function createEmptyTeamTotals(teamId = null, info = null) {
  const stats = TEAM_STAT_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
  return {
    id: teamId,
    info: info || null,
    record: { wins: 0, losses: 0, ties: 0 },
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
    const register = (collection = {}, side) => {
      Object.entries(collection).forEach(([role, entry]) => {
        if (!entry) return;
        const playerId = entry.id || `${teamId}-${role}`;
        directory[playerId] = {
          id: playerId,
          teamId,
          side,
          role,
          firstName: entry.firstName || role,
          lastName: entry.lastName || '',
          fullName: `${entry.firstName || role}${entry.lastName ? ` ${entry.lastName}` : ''}`,
          number: entry.number ?? null,
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
        teamId,
        side: 'Special Teams',
        role: 'K',
        firstName: kicker.firstName || 'Kicker',
        lastName: kicker.lastName || '',
        fullName: `${kicker.firstName || 'Kicker'}${kicker.lastName ? ` ${kicker.lastName}` : ''}`,
        number: kicker.number ?? null,
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
    seasonNumber: 1,
    playerDevelopment: {},
    playerAges,
    playerDirectory,
    careerStats: {},
    playerAwards: {},
    awardsHistory: [],
    teamChampionships: {},
    lastChampion: null,
  };
  initializeLeaguePersonnel(league);
  ensureSeasonPersonnel(league, league.seasonNumber);
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

export function generateSeasonSchedule(teamIds = TEAM_IDS) {
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
    const secondHalf = baseWeeks.map((pairs) => buildWeek(pairs, 'regular-season-rematch', true));
    const weeks = [...firstHalf, ...secondHalf];

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

export function createSeasonState(options = {}) {
  const {
    seasonNumber = 1,
    playerDevelopment = {},
    playerAges = {},
    previousAwards = [],
  } = options;

  const schedule = generateSeasonSchedule();
  const teams = {};
  const assignmentTotals = {};
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
    assignmentTotals[id] = createEmptyTeamTotals(id, info);
  });

  return {
    seasonNumber,
    teams,
    schedule,
    regularSeasonLength: schedule.length,
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

function compareStandings(a, b) {
  if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
  if (a.record.losses !== b.record.losses) return a.record.losses - b.record.losses;
  if (b.record.ties !== a.record.ties) return b.record.ties - a.record.ties;
  if (b.diff !== a.diff) return b.diff - a.diff;
  if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
  return (a.name || '').localeCompare(b.name || '');
}

function buildStandings(season) {
  const entries = Object.values(season?.teams || {}).map((team) => {
    const record = normalizeRecord(team.record);
    const pointsFor = team.pointsFor || 0;
    const pointsAgainst = team.pointsAgainst || 0;
    return {
      id: team.id,
      name: team.info?.displayName || team.id,
      record,
      diff: pointsFor - pointsAgainst,
      pointsFor,
      pointsAgainst,
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
}) {
  return {
    id: `PO${String(seasonNumber).padStart(2, '0')}-SF${order}`,
    homeTeam,
    awayTeam,
    tag: 'playoff-semifinal',
    round: `Semifinal ${order}`,
    index,
    week: null,
    slot: 0,
    meta: { order },
  };
}

export function ensurePlayoffsScheduled(season, league) {
  if (!season) return [];
  if (season.playoffBracket && season.playoffBracket.stage !== 'regular') return [];
  const seeds = buildStandings(season).slice(0, 4).map((entry) => entry.id).filter(Boolean);
  if (seeds.length < 4) return [];
  season.regularSeasonStandings = buildStandings(season);
  const startIndex = season.schedule.length;
  const games = [
    buildSemifinalGame({ seasonNumber: season.seasonNumber, homeTeam: seeds[0], awayTeam: seeds[3], index: startIndex, order: 1 }),
    buildSemifinalGame({ seasonNumber: season.seasonNumber, homeTeam: seeds[1], awayTeam: seeds[2], index: startIndex + 1, order: 2 }),
  ];
  games.forEach((game, idx) => {
    const entry = { ...game, index: startIndex + idx, week: (season.regularSeasonLength || startIndex) + idx + 1 };
    season.schedule.push(entry);
  });
  season.playoffBracket = {
    stage: 'semifinals',
    seeds: [...seeds],
    semifinalGames: games.map((game, idx) => ({
      index: startIndex + idx,
      winner: null,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      label: game.round,
    })),
    championshipGame: null,
    champion: null,
  };
  season.phase = 'playoffs';
  recomputeAssignmentTotals(season);
  computeSeasonAwards(season, league);
  return games.map((_, idx) => startIndex + idx);
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
  const index = season.schedule.length;
  const entry = {
    id: `PO${String(season.seasonNumber).padStart(2, '0')}-CH`,
    homeTeam,
    awayTeam,
    tag: 'playoff-championship',
    round: 'BluperBowl',
    index,
    week: (season.regularSeasonLength || index) + (bracket.semifinalGames.length) + 1,
    meta: { seeds: [seeds.indexOf(homeTeam) + 1, seeds.indexOf(awayTeam) + 1] },
  };
  season.schedule.push(entry);
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
  if (!league?.playerAges) return;
  Object.keys(league.playerAges).forEach((playerId) => {
    league.playerAges[playerId] = (league.playerAges[playerId] || 0) + 1;
  });
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

  const homeEntry = cloneTeamSeasonEntry(season.teams[homeId]);
  const awayEntry = cloneTeamSeasonEntry(season.teams[awayId]);
  if (!homeEntry || !awayEntry) return season;

  const assignmentTotals = cloneAssignmentTotalsMap(season.assignmentTotals || {}, season.teams || {});
  const homeTotals = assignmentTotals[homeId] || createEmptyTeamTotals(homeId, homeEntry.info || null);
  const awayTotals = assignmentTotals[awayId] || createEmptyTeamTotals(awayId, awayEntry.info || null);

  homeEntry.pointsFor = (homeEntry.pointsFor || 0) + homeScore;
  homeEntry.pointsAgainst = (homeEntry.pointsAgainst || 0) + awayScore;
  awayEntry.pointsFor = (awayEntry.pointsFor || 0) + awayScore;
  awayEntry.pointsAgainst = (awayEntry.pointsAgainst || 0) + homeScore;

  homeTotals.pointsFor = (homeTotals.pointsFor || 0) + homeScore;
  homeTotals.pointsAgainst = (homeTotals.pointsAgainst || 0) + awayScore;
  awayTotals.pointsFor = (awayTotals.pointsFor || 0) + awayScore;
  awayTotals.pointsAgainst = (awayTotals.pointsAgainst || 0) + homeScore;

  if (homeScore > awayScore) {
    homeEntry.record.wins += 1;
    awayEntry.record.losses += 1;
    homeTotals.record.wins += 1;
    awayTotals.record.losses += 1;
  } else if (awayScore > homeScore) {
    awayEntry.record.wins += 1;
    homeEntry.record.losses += 1;
    awayTotals.record.wins += 1;
    homeTotals.record.losses += 1;
  } else {
    homeEntry.record.ties += 1;
    awayEntry.record.ties += 1;
    homeTotals.record.ties += 1;
    awayTotals.record.ties += 1;
  }

  const updatedTeams = {
    ...season.teams,
    [homeId]: homeEntry,
    [awayId]: awayEntry,
  };

  assignmentTotals[homeId] = homeTotals;
  assignmentTotals[awayId] = awayTotals;

  const nextSeason = {
    ...season,
    teams: updatedTeams,
    schedule: [...season.schedule],
    results: [...(season.results || [])],
    playerStats: { ...(season.playerStats || {}) },
    assignmentTotals: { ...assignmentTotals },
  };

  accumulateTeamStatsFromPlayers(nextSeason, directory, playerStats);
  accumulateTeamStatsFromPlayers({ teams: assignmentTotals }, directory, playerStats);
  mergePlayerStatsIntoSeason(nextSeason, playerStats);

  const result = {
    gameId: game.id,
    index: game.index,
    homeTeamId: homeId,
    awayTeamId: awayId,
    score: { [homeId]: homeScore, [awayId]: awayScore },
    winner: homeScore === awayScore ? null : (homeScore > awayScore ? homeId : awayId),
    playLog: Array.isArray(playLog) ? [...playLog] : [],
    tag,
  };
  nextSeason.results.push(result);
  nextSeason.schedule[game.index] = { ...game, played: true, result };
  nextSeason.completedGames = (season.completedGames || 0) + 1;

  if (tag === 'playoff-semifinal' && nextSeason.playoffBracket) {
    const semifinal = nextSeason.playoffBracket.semifinalGames?.find((entry) => entry.index === game.index);
    if (semifinal) {
      semifinal.winner = result.winner;
      semifinal.score = result.score;
    }
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

  return nextSeason;
}

export function prepareSeasonMatchup(season) {
  if (!season) return null;
  const game = season.schedule[season.currentGameIndex];
  return createMatchupFromGame(game);
}

export function advanceSeasonPointer(season) {
  if (!season) return null;
  const stride = Math.max(1, season.assignmentStride || season.assignment?.stride || 1);
  const nextIndex = season.currentGameIndex + stride;
  const scheduleLength = season.schedule?.length ?? 0;
  if (nextIndex >= scheduleLength) {
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
