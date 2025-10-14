import { ROLES_OFF, ROLES_DEF } from './constants';
import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { clamp, choice, rand } from './helpers';

const ATTR_RANGES = {
  speed: [4.2, 7.2],
  accel: [10, 22],
  agility: [0.45, 1.35],
  strength: [0.5, 1.45],
  awareness: [0.35, 1.45],
  catch: [0.35, 1.35],
  throwPow: [0.4, 1.45],
  throwAcc: [0.4, 1.45],
  tackle: [0.4, 1.45],
};

const ROLE_FOCUS = {
  QB: { throwAcc: 0.9, throwPow: 0.85, awareness: 0.8, agility: 0.5 },
  RB: { speed: 0.75, agility: 0.8, strength: 0.6, catch: 0.45, awareness: 0.6 },
  WR1: { speed: 0.85, agility: 0.8, catch: 0.85, awareness: 0.55 },
  WR2: { speed: 0.8, agility: 0.75, catch: 0.75, awareness: 0.5 },
  WR3: { speed: 0.78, agility: 0.8, catch: 0.7, awareness: 0.45 },
  TE: { strength: 0.75, catch: 0.7, awareness: 0.65, speed: 0.55 },
  LT: { strength: 0.85, agility: 0.45, awareness: 0.6 },
  LG: { strength: 0.82, agility: 0.42, awareness: 0.58 },
  C: { strength: 0.82, agility: 0.44, awareness: 0.63 },
  RG: { strength: 0.8, agility: 0.42, awareness: 0.57 },
  RT: { strength: 0.83, agility: 0.44, awareness: 0.58 },
  LE: { strength: 0.78, speed: 0.62, tackle: 0.75, awareness: 0.58 },
  DT: { strength: 0.88, tackle: 0.8, awareness: 0.6 },
  RTk: { strength: 0.85, tackle: 0.78, awareness: 0.58 },
  RE: { strength: 0.8, speed: 0.65, tackle: 0.76, awareness: 0.58 },
  LB1: { tackle: 0.85, awareness: 0.74, speed: 0.65, strength: 0.7 },
  LB2: { tackle: 0.83, awareness: 0.7, speed: 0.62, strength: 0.68 },
  CB1: { speed: 0.85, agility: 0.82, awareness: 0.72, catch: 0.55 },
  CB2: { speed: 0.83, agility: 0.78, awareness: 0.65, catch: 0.5 },
  S1: { awareness: 0.78, speed: 0.72, tackle: 0.75, catch: 0.5 },
  S2: { awareness: 0.75, speed: 0.7, tackle: 0.72, catch: 0.48 },
  NB: { speed: 0.78, agility: 0.76, awareness: 0.66, catch: 0.52 },
};

const FIRST_NAMES = [
  'Aiden', 'Bryce', 'Carter', 'Damien', 'Elijah', 'Felix', 'Gavin', 'Hayden', 'Isaac', 'Jalen',
  'Kai', 'Landon', 'Mason', 'Noah', 'Owen', 'Parker', 'Quinn', 'Riley', 'Silas', 'Tobias',
  'Uri', 'Victor', 'Wyatt', 'Xavier', 'Yahir', 'Zane', 'Amari', 'Blake', 'Caleb', 'Darius',
  'Emmett', 'Finley', 'Griffin', 'Holden', 'Imani', 'Jasper', 'Kameron', 'Luca', 'Miles', 'Nico',
  'Orion', 'Paxton', 'Rowan', 'Sawyer', 'Tristan', 'Ulises', 'Vaughn', 'Weston', 'Zion', 'Matteo',
];

const LAST_NAMES = [
  'Andrews', 'Bennett', 'Collins', 'Dawson', 'Ellison', 'Foster', 'Gallagher', 'Harris', 'Irving', 'Jenkins',
  'Kendrick', 'Lawson', 'Monroe', 'Nelson', 'Owens', 'Pratt', 'Qualls', 'Reynolds', 'Sanders', 'Turner',
  'Underwood', 'Vasquez', 'Walker', 'Xiong', 'Young', 'Zimmer', 'Beckett', 'Chapman', 'Dalton', 'Edwards',
  'Figueroa', 'Grayson', 'Henderson', 'Ingram', 'Jacobs', 'King', 'Lofton', 'Merritt', 'Nash', 'Ortega',
  'Price', 'Quintero', 'Ramsey', 'Simmons', 'Thompson', 'Vega', 'Whitaker', 'York', 'Zeller', 'McAllister',
];

const SCOUT_FIRST = [
  'Alex', 'Brooke', 'Cam', 'Dylan', 'Emerson', 'Frankie', 'Harper', 'Jordan', 'Kendall', 'Logan',
  'Morgan', 'Peyton', 'Reese', 'Rory', 'Sage', 'Taylor', 'Avery', 'Bailey', 'Casey', 'Devon',
];

const SCOUT_LAST = [
  'Adler', 'Briggs', 'Carmichael', 'Donovan', 'Eastman', 'Fielder', 'Garrett', 'Harlow', 'Iverson', 'Jennings',
  'Keaton', 'Langley', 'Merrick', 'North', 'Oakley', 'Prescott', 'Radcliffe', 'Sterling', 'Tate', 'Winslow',
];

function randomFirstName() {
  return choice(FIRST_NAMES);
}

function randomLastName() {
  return choice(LAST_NAMES);
}

function randomScoutName() {
  return `${choice(SCOUT_FIRST)} ${choice(SCOUT_LAST)}`;
}

function roleSide(role) {
  if (ROLES_OFF.includes(role)) return 'offense';
  if (ROLES_DEF.includes(role)) return 'defense';
  if (role === 'K') return 'special';
  return 'offense';
}

function clonePlayerData(data = {}) {
  return {
    id: data.id,
    firstName: data.firstName || 'Player',
    lastName: data.lastName || '',
    number: data.number ?? null,
    ratings: { ...(data.ratings || {}) },
    modifiers: { ...(data.modifiers || {}) },
    potential: data.potential ?? null,
    overall: data.overall ?? null,
    ceiling: data.ceiling ?? data.potential ?? null,
    origin: data.origin || 'internal',
    archetype: data.archetype || null,
    health: data.health || { durability: 1, history: [] },
    age: data.age ?? null,
  };
}

function ensureTeamRosterShell(league) {
  if (!league.teamRosters) league.teamRosters = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamRosters[teamId]) {
      const data = getTeamData(teamId) || {};
      const offense = {};
      const defense = {};
      const special = {};
      Object.entries(data.offense || {}).forEach(([role, player]) => {
        offense[role] = clonePlayerData({ ...player, origin: 'franchise' });
      });
      Object.entries(data.defense || {}).forEach(([role, player]) => {
        defense[role] = clonePlayerData({ ...player, origin: 'franchise' });
      });
      if (data.specialTeams?.K) {
        special.K = clonePlayerData({ ...data.specialTeams.K, origin: 'franchise' });
      }
      league.teamRosters[teamId] = { offense, defense, special };
    }
  });
  return league.teamRosters;
}

function computeOverallFromRatings(ratings = {}, role = 'QB') {
  const focuses = ROLE_FOCUS[role] || {};
  let total = 0;
  let weightSum = 0;
  Object.entries(ATTR_RANGES).forEach(([attr, [min, max]]) => {
    const value = ratings[attr];
    if (value == null) return;
    const weight = focuses[attr] != null ? (0.45 + focuses[attr] * 0.55) : 0.4;
    const normalized = (value - min) / (max - min || 1);
    total += normalized * weight;
    weightSum += weight;
  });
  if (weightSum <= 0) return 50;
  const normalizedScore = clamp(total / weightSum, 0, 1);
  return Math.round(40 + normalizedScore * 55);
}

function decoratePlayerMetrics(player, role) {
  if (!player) return player;
  const updated = player;
  updated.overall = computeOverallFromRatings(updated.ratings, role);
  if (updated.potential == null) {
    const variance = rand(0.05, 0.25);
    const normalized = clamp(updated.overall / 100 + variance, 0, 1.25);
    updated.potential = Math.max(normalized, updated.overall / 100);
  }
  updated.ceiling = updated.ceiling != null ? updated.ceiling : Math.max(updated.potential, updated.overall / 100 + 0.1);
  if (!updated.health) {
    updated.health = { durability: clamp(rand(0.7, 1.05), 0.5, 1.2), history: [] };
  }
  return updated;
}

function initialiseRosterMetrics(league) {
  const rosters = ensureTeamRosterShell(league);
  Object.entries(rosters).forEach(([teamId, roster]) => {
    Object.entries(roster.offense || {}).forEach(([role, player]) => {
      roster.offense[role] = decoratePlayerMetrics(player, role);
    });
    Object.entries(roster.defense || {}).forEach(([role, player]) => {
      roster.defense[role] = decoratePlayerMetrics(player, role);
    });
    if (roster.special?.K) {
      roster.special.K = decoratePlayerMetrics(roster.special.K, 'K');
    }
  });
}

function randomAttrValue(attr, skill, emphasis = 0.5) {
  const [min, max] = ATTR_RANGES[attr] || [0, 1];
  const noise = rand(-0.08, 0.08);
  const quality = clamp(skill * 0.65 + emphasis * 0.35 + noise, 0, 1);
  return clamp(min + (max - min) * quality, min, max);
}

function generateRatingsForRole(role, skillRating) {
  const ratings = {};
  const focus = ROLE_FOCUS[role] || {};
  Object.keys(ATTR_RANGES).forEach((attr) => {
    const emphasis = focus[attr] != null ? focus[attr] : 0.5;
    ratings[attr] = randomAttrValue(attr, skillRating, emphasis);
  });
  return ratings;
}

let freeAgentIdCounter = 1;

function nextFreeAgentId(role) {
  const suffix = String(freeAgentIdCounter).padStart(4, '0');
  freeAgentIdCounter += 1;
  return `FA-${role}-${suffix}`;
}

function randomAgeForProspect(type = 'balanced') {
  if (type === 'prospect') return Math.round(rand(20, 24));
  if (type === 'veteran') return Math.round(rand(28, 33));
  return Math.round(rand(23, 29));
}

function buildFreeAgent(role, archetype, tier, seasonNumber) {
  const skill = tier === 'veteran' ? rand(0.65, 0.95)
    : tier === 'prospect' ? rand(0.35, 0.65)
    : rand(0.5, 0.8);
  const potential = tier === 'prospect' ? clamp(skill + rand(0.25, 0.45), 0.6, 1.25)
    : tier === 'veteran' ? clamp(skill + rand(-0.05, 0.18), 0.5, 1.05)
    : clamp(skill + rand(0.05, 0.3), 0.55, 1.1);
  const ratings = generateRatingsForRole(role, skill);
  const firstName = randomFirstName();
  const lastName = randomLastName();
  const player = {
    id: nextFreeAgentId(role),
    firstName,
    lastName,
    number: null,
    ratings,
    modifiers: {},
    potential,
    ceiling: potential + rand(0.02, 0.1),
    origin: 'free-agent',
    archetype: archetype || tier,
    age: randomAgeForProspect(tier),
    createdSeason: seasonNumber,
    type: tier,
  };
  decoratePlayerMetrics(player, role);
  return player;
}

function generateFreeAgentClass(league, seasonNumber, count = 36) {
  const roles = [...ROLES_OFF, ...ROLES_DEF, 'K'];
  const pool = [];
  for (let i = 0; i < count; i += 1) {
    const role = choice(roles);
    const archetypeRoll = Math.random();
    const tier = archetypeRoll < 0.3 ? 'prospect' : archetypeRoll > 0.78 ? 'veteran' : 'balanced';
    pool.push(buildFreeAgent(role, null, tier, seasonNumber));
  }
  return pool;
}

function ensureFreeAgentPool(league, seasonNumber) {
  if (!Array.isArray(league.freeAgents)) {
    league.freeAgents = [];
  }
  if (league.lastFreeAgentSeason === seasonNumber) return;
  const generated = generateFreeAgentClass(league, seasonNumber, 42);
  league.freeAgents.push(...generated);
  league.lastFreeAgentSeason = seasonNumber;
}

function ensureScouts(league) {
  if (!league.teamScouts) league.teamScouts = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamScouts[teamId]) {
      const primary = clamp(rand(0.5, 0.95), 0.4, 0.98);
      league.teamScouts[teamId] = {
        id: `SCOUT-${teamId}`,
        name: randomScoutName(),
        evaluation: primary,
        development: clamp(primary + rand(-0.2, 0.15), 0.3, 0.95),
        trade: clamp(primary + rand(-0.15, 0.2), 0.35, 0.96),
        aggression: clamp(rand(0.3, 0.9), 0.2, 0.95),
      };
    }
  });
}

function ensureNewsFeed(league) {
  if (!Array.isArray(league.newsFeed)) league.newsFeed = [];
}

function ensureInjuryTracking(league) {
  if (!league.injuryLog) league.injuryLog = {};
  if (!league.injuredReserve) league.injuredReserve = {};
  if (!league.injuryCounts) league.injuryCounts = {};
}

export function initializeLeaguePersonnel(league) {
  if (!league) return;
  ensureTeamRosterShell(league);
  initialiseRosterMetrics(league);
  ensureScouts(league);
  ensureNewsFeed(league);
  ensureInjuryTracking(league);
  if (!Array.isArray(league.freeAgents)) league.freeAgents = [];
}

function recordNewsInternal(league, entry) {
  ensureNewsFeed(league);
  const payload = {
    id: entry?.id || `NEWS-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    createdAt: entry?.createdAt || new Date().toISOString(),
    ...entry,
  };
  league.newsFeed.unshift(payload);
  if (league.newsFeed.length > 150) {
    league.newsFeed.length = 150;
  }
}

export function recordLeagueNews(league, entry) {
  if (!league || !entry) return;
  recordNewsInternal(league, entry);
}

export function ensureSeasonPersonnel(league, seasonNumber) {
  if (!league) return;
  initializeLeaguePersonnel(league);
  ensureFreeAgentPool(league, seasonNumber);
  if (!league.injuryCounts[seasonNumber]) {
    league.injuryCounts[seasonNumber] = {};
  }
}

function evaluatePlayerTrueValue(player, mode = 'balanced') {
  const current = player.overall ?? 60;
  const potential = (player.ceiling ?? player.potential ?? current / 100) * 100;
  if (mode === 'win-now') {
    return current * 0.7 + potential * 0.3;
  }
  if (mode === 'future') {
    return current * 0.4 + potential * 0.6;
  }
  return current * 0.55 + potential * 0.45;
}

function applyScoutVariance(value, scoutSkill) {
  const noiseRange = (1 - clamp(scoutSkill, 0, 1)) * 28;
  return value + rand(-noiseRange, noiseRange);
}

function teamStrategyFromRecord(teamEntry) {
  if (!teamEntry) return 'balanced';
  const wins = teamEntry.record?.wins ?? 0;
  const losses = teamEntry.record?.losses ?? 0;
  if (wins >= losses + 2) return 'win-now';
  if (losses >= wins + 2) return 'future';
  return 'balanced';
}

function ensurePlayerDirectoryEntry(league, teamId, role, player) {
  if (!league || !player?.id) return;
  if (!league.playerDirectory) league.playerDirectory = {};
  const identity = getTeamIdentity(teamId) || { id: teamId, displayName: teamId, abbr: teamId };
  league.playerDirectory[player.id] = {
    id: player.id,
    teamId,
    role,
    side: roleSide(role),
    firstName: player.firstName,
    lastName: player.lastName,
    fullName: `${player.firstName}${player.lastName ? ` ${player.lastName}` : ''}`,
    number: player.number ?? null,
    teamName: identity.displayName,
    teamAbbr: identity.abbr,
  };
}

function removeDirectoryEntry(league, playerId) {
  if (league?.playerDirectory && playerId && league.playerDirectory[playerId]) {
    delete league.playerDirectory[playerId];
  }
}

function pushPlayerToFreeAgency(league, player, role, reason) {
  if (!league || !player) return;
  league.freeAgents ||= [];
  const released = { ...player, role, releasedReason: reason || 'released' };
  decoratePlayerMetrics(released, role);
  league.freeAgents.push(released);
}

function assignPlayerToRoster(league, teamId, role, player) {
  if (!league || !teamId || !player) return;
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  if (!rosters[teamId]) {
    rosters[teamId] = { offense: {}, defense: {}, special: {} };
  }
  if (side === 'offense') rosters[teamId].offense[role] = decoratePlayerMetrics(player, role);
  else if (side === 'defense') rosters[teamId].defense[role] = decoratePlayerMetrics(player, role);
  else rosters[teamId].special.K = decoratePlayerMetrics(player, role);
  ensurePlayerDirectoryEntry(league, teamId, role, player);
}

function removePlayerFromRoster(league, teamId, role) {
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  if (!rosters[teamId]) return null;
  let removed = null;
  if (side === 'offense') {
    removed = rosters[teamId].offense[role] || null;
    delete rosters[teamId].offense[role];
  } else if (side === 'defense') {
    removed = rosters[teamId].defense[role] || null;
    delete rosters[teamId].defense[role];
  } else {
    removed = rosters[teamId].special.K || null;
    delete rosters[teamId].special.K;
  }
  if (removed?.id) removeDirectoryEntry(league, removed.id);
  return removed;
}

function scoutEvaluationForPlayer(league, teamId, role, player, modeOverride) {
  ensureScouts(league);
  const scout = league.teamScouts?.[teamId] || { evaluation: 0.6 };
  const mode = modeOverride || 'balanced';
  const trueValue = evaluatePlayerTrueValue(player, mode);
  const evaluation = applyScoutVariance(trueValue, scout.evaluation);
  return { scout, evaluation, trueValue };
}

export function signBestFreeAgentForRole(league, teamId, role, {
  reason = 'depth move',
  mode,
  minImprovement = 0,
} = {}) {
  if (!league) return null;
  ensureSeasonPersonnel(league, league.seasonNumber || 1);
  const side = roleSide(role);
  league.freeAgents ||= [];
  const candidates = league.freeAgents
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => {
      if (!player || !player.id) return false;
      const candidateRole = player.role;
      if (role === 'K') {
        return candidateRole == null || candidateRole === 'K';
      }
      if (side === 'offense') {
        return candidateRole == null || candidateRole === role || ROLES_OFF.includes(candidateRole);
      }
      if (side === 'defense') {
        return candidateRole == null || candidateRole === role || ROLES_DEF.includes(candidateRole);
      }
      return true;
    });
  if (!candidates.length) {
    const emergency = buildFreeAgent(role, null, 'balanced', league.seasonNumber || 1);
    emergency.emergency = true;
    league.freeAgents.push(emergency);
    candidates.push({ player: emergency, index: league.freeAgents.length - 1 });
  }
  const strategy = mode || teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  let best = null;
  candidates.forEach(({ player, index }) => {
    const assessment = scoutEvaluationForPlayer(league, teamId, role, player, strategy);
    if (!best || assessment.evaluation > best.score) {
      best = { ...assessment, index, player };
    }
  });
  if (!best) return null;
  const roster = ensureTeamRosterShell(league)[teamId];
  const current = side === 'offense' ? roster.offense[role] : side === 'defense' ? roster.defense[role] : roster.special.K;
  if (current && best.trueValue < evaluatePlayerTrueValue(current, strategy) + minImprovement) {
    return null;
  }
  const [chosen] = league.freeAgents.splice(best.index, 1);
  const assigned = { ...chosen, role, origin: 'free-agent' };
  assignPlayerToRoster(league, teamId, role, assigned);
  recordNewsInternal(league, {
    type: 'signing',
    teamId,
    text: `${getTeamIdentity(teamId)?.abbr || teamId} sign ${assigned.firstName} ${assigned.lastName} (${role})`,
    detail: reason,
    seasonNumber: league.seasonNumber || null,
  });
  return assigned;
}

function trackInjury(league, playerId, info) {
  if (!league || !playerId) return;
  ensureInjuryTracking(league);
  league.injuryLog[playerId] = { ...(league.injuryLog[playerId] || {}), ...info };
}

export function registerPlayerInjury(league, {
  player,
  teamId,
  role,
  severity,
  gamesMissed,
  description,
  seasonNumber,
  degrade,
}) {
  if (!league || !player?.id || !teamId || !role) return;
  ensureSeasonPersonnel(league, seasonNumber || league.seasonNumber || 1);
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  const entry = side === 'offense'
    ? rosters[teamId]?.offense?.[role]
    : side === 'defense'
      ? rosters[teamId]?.defense?.[role]
      : rosters[teamId]?.special?.K;
  if (!entry || entry.id !== player.id) {
    assignPlayerToRoster(league, teamId, role, player);
  }
  const removed = removePlayerFromRoster(league, teamId, role);
  const irEntry = {
    player: decoratePlayerMetrics({ ...removed, role }, role),
    teamId,
    role,
    severity,
    gamesRemaining: gamesMissed,
    description,
    degrade,
  };
  league.injuredReserve[player.id] = irEntry;
  trackInjury(league, player.id, irEntry);
  const season = seasonNumber || league.seasonNumber || 1;
  league.injuryCounts[season] ||= {};
  league.injuryCounts[season][teamId] = (league.injuryCounts[season][teamId] || 0) + 1;
  if (degrade && removed?.ratings) {
    Object.entries(degrade).forEach(([attr, delta]) => {
      removed.ratings[attr] = clamp((removed.ratings[attr] || 0) + delta, ATTR_RANGES[attr]?.[0] || 0, ATTR_RANGES[attr]?.[1] || 10);
    });
    decoratePlayerMetrics(removed, role);
    irEntry.player = removed;
  }
  recordNewsInternal(league, {
    type: 'injury',
    teamId,
    text: `${removed?.firstName || player.firstName} ${removed?.lastName || player.lastName} (${role}) suffers ${description}`,
    detail: gamesMissed > 0 ? `Out ${gamesMissed} ${gamesMissed === 1 ? 'game' : 'games'}` : 'Day-to-day',
    severity,
    seasonNumber: season,
  });
  return irEntry;
}

function reinstatePlayer(league, irEntry) {
  if (!league || !irEntry?.player) return;
  const rosters = ensureTeamRosterShell(league);
  const roster = rosters[irEntry.teamId] || null;
  const side = roleSide(irEntry.role);
  let occupant = null;
  if (roster) {
    if (side === 'offense') occupant = roster.offense?.[irEntry.role] || null;
    else if (side === 'defense') occupant = roster.defense?.[irEntry.role] || null;
    else occupant = roster.special?.K || null;
  }
  if (occupant && occupant.id !== irEntry.player.id) {
    pushPlayerToFreeAgency(league, occupant, irEntry.role, 'injury replacement released');
  }
  assignPlayerToRoster(league, irEntry.teamId, irEntry.role, irEntry.player);
  recordNewsInternal(league, {
    type: 'return',
    teamId: irEntry.teamId,
    text: `${irEntry.player.firstName} ${irEntry.player.lastName} (${irEntry.role}) returns from injury`,
    detail: 'Activated from injured list',
    seasonNumber: league.seasonNumber || null,
  });
  delete league.injuredReserve[irEntry.player.id];
}

export function decrementInjuryTimers(league, teamId) {
  if (!league || !league.injuredReserve) return;
  const entries = Object.values(league.injuredReserve).filter((entry) => entry.teamId === teamId);
  entries.forEach((entry) => {
    if (entry.gamesRemaining > 0) entry.gamesRemaining -= 1;
    if (entry.gamesRemaining <= 0) {
      reinstatePlayer(league, entry);
    }
  });
}

function pickTradeRole() {
  const combined = [...ROLES_OFF.filter((role) => role !== 'LT' && role !== 'LG' && role !== 'RG' && role !== 'RT' && role !== 'C'), 'CB1', 'CB2', 'S1', 'S2', 'LB1', 'LB2', 'LE', 'RE'];
  return choice(combined);
}

function tradeValue(league, teamId, role, player, mode) {
  const { evaluation } = scoutEvaluationForPlayer(league, teamId, role, player, mode);
  return evaluation;
}

function performTrade(league, season, teamA, teamB, role, modeA, modeB) {
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  const playerA = side === 'offense' ? rosters[teamA]?.offense?.[role] : side === 'defense' ? rosters[teamA]?.defense?.[role] : rosters[teamA]?.special?.K;
  const playerB = side === 'offense' ? rosters[teamB]?.offense?.[role] : side === 'defense' ? rosters[teamB]?.defense?.[role] : rosters[teamB]?.special?.K;
  if (!playerA || !playerB) return false;
  const valueA = tradeValue(league, teamA, role, playerB, modeA);
  const currentA = tradeValue(league, teamA, role, playerA, modeA);
  const valueB = tradeValue(league, teamB, role, playerA, modeB);
  const currentB = tradeValue(league, teamB, role, playerB, modeB);
  const deltaA = valueA - currentA;
  const deltaB = valueB - currentB;
  if (deltaA <= -4 && deltaB <= -4) return false;
  const scoutA = league.teamScouts?.[teamA];
  const scoutB = league.teamScouts?.[teamB];
  const aggressionCheckA = Math.random() < (scoutA?.aggression ?? 0.5);
  const aggressionCheckB = Math.random() < (scoutB?.aggression ?? 0.5);
  if (!aggressionCheckA || !aggressionCheckB) return false;
  if (deltaA < -8 || deltaB < -8) return false;
  removePlayerFromRoster(league, teamA, role);
  removePlayerFromRoster(league, teamB, role);
  assignPlayerToRoster(league, teamA, role, { ...playerB, origin: 'trade' });
  assignPlayerToRoster(league, teamB, role, { ...playerA, origin: 'trade' });
  recordNewsInternal(league, {
    type: 'trade',
    text: `${getTeamIdentity(teamA)?.abbr || teamA} trade ${playerA.firstName} ${playerA.lastName} (${role}) for ${playerB.firstName} ${playerB.lastName}`,
    teamId: teamA,
    partnerTeam: teamB,
    seasonNumber: season?.seasonNumber || league.seasonNumber || null,
  });
  recordNewsInternal(league, {
    type: 'trade',
    text: `${getTeamIdentity(teamB)?.abbr || teamB} acquire ${playerA.firstName} ${playerA.lastName} (${role})`,
    teamId: teamB,
    partnerTeam: teamA,
    seasonNumber: season?.seasonNumber || league.seasonNumber || null,
  });
  return true;
}

function computeTeamStrategies(season) {
  if (!season) return {};
  const strategies = {};
  Object.entries(season.teams || {}).forEach(([teamId, team]) => {
    strategies[teamId] = teamStrategyFromRecord(team);
  });
  return strategies;
}

function runTradeMarket(league, season) {
  if (!league || !season) return;
  ensureScouts(league);
  const strategies = computeTeamStrategies(season);
  const contenders = TEAM_IDS.filter((teamId) => strategies[teamId] === 'win-now');
  const rebuilders = TEAM_IDS.filter((teamId) => strategies[teamId] === 'future');
  if (!contenders.length || !rebuilders.length) return;
  const attempts = Math.min(3, Math.floor((contenders.length + rebuilders.length) / 4));
  for (let i = 0; i < attempts; i += 1) {
    const teamA = choice(contenders);
    const teamB = choice(rebuilders);
    if (!teamA || !teamB || teamA === teamB) continue;
    const role = pickTradeRole();
    performTrade(league, season, teamA, teamB, role, strategies[teamA], strategies[teamB]);
  }
}

function evaluateRosterNeeds(league, teamId) {
  const roster = ensureTeamRosterShell(league)[teamId];
  const needs = [];
  if (!roster) return needs;
  ROLES_OFF.forEach((role) => {
    const player = roster.offense[role];
    if (!player) needs.push(role);
    else if (player.overall < 55 && Math.random() < 0.35) needs.push(role);
  });
  ROLES_DEF.forEach((role) => {
    const player = roster.defense[role];
    if (!player) needs.push(role);
    else if (player.overall < 55 && Math.random() < 0.35) needs.push(role);
  });
  if (!roster.special.K || roster.special.K.overall < 55) needs.push('K');
  return needs;
}

function fillRosterNeeds(league, teamId, needs, { reason, mode }) {
  needs.forEach((role) => {
    signBestFreeAgentForRole(league, teamId, role, { reason, mode });
  });
}

function simulateRosterCuts(league, teamId, mode) {
  const roster = ensureTeamRosterShell(league)[teamId];
  const candidates = [];
  ROLES_OFF.forEach((role) => {
    const player = roster.offense[role];
    if (!player) return;
    if (player.overall < 52 && Math.random() < 0.25) {
      candidates.push({ role, player });
    }
  });
  ROLES_DEF.forEach((role) => {
    const player = roster.defense[role];
    if (!player) return;
    if (player.overall < 52 && Math.random() < 0.25) {
      candidates.push({ role, player });
    }
  });
  if (roster.special.K && roster.special.K.overall < 52 && Math.random() < 0.25) {
    candidates.push({ role: 'K', player: roster.special.K });
  }
  if (!candidates.length) return;
  const scout = league.teamScouts?.[teamId];
  const limit = Math.max(1, Math.round((scout?.aggression ?? 0.4) * 2));
  for (let i = 0; i < Math.min(limit, candidates.length); i += 1) {
    const pick = candidates[i];
    const removed = removePlayerFromRoster(league, teamId, pick.role);
    if (removed) {
      pushPlayerToFreeAgency(league, removed, pick.role, 'waived');
      recordNewsInternal(league, {
        type: 'release',
        teamId,
        text: `${removed.firstName} ${removed.lastName} (${pick.role}) released`,
        detail: 'Roster spot opened',
        seasonNumber: league.seasonNumber || null,
      });
      signBestFreeAgentForRole(league, teamId, pick.role, { reason: 'replacing waived player', mode });
    }
  }
}

function processOffseasonInjuries(league) {
  if (!league?.injuredReserve) return;
  Object.values(league.injuredReserve).forEach((entry) => {
    entry.gamesRemaining = Math.max(0, entry.gamesRemaining - 4);
    if (entry.gamesRemaining <= 0) {
      reinstatePlayer(league, entry);
    }
  });
}

export function advanceLeagueOffseason(league, season) {
  if (!league) return;
  ensureSeasonPersonnel(league, (season?.seasonNumber || league.seasonNumber || 1) + 1);
  processOffseasonInjuries(league);
  TEAM_IDS.forEach((teamId) => {
    const strategy = teamStrategyFromRecord(season?.teams?.[teamId]);
    simulateRosterCuts(league, teamId, strategy);
    const needs = evaluateRosterNeeds(league, teamId);
    if (needs.length) {
      fillRosterNeeds(league, teamId, needs, { reason: 'offseason adjustments', mode: strategy });
    }
  });
  runTradeMarket(league, season);
}

export function getRosterSnapshot(league, teamId) {
  const roster = ensureTeamRosterShell(league)[teamId];
  if (!roster) return null;
  return {
    offense: { ...roster.offense },
    defense: { ...roster.defense },
    special: { ...roster.special },
  };
}

export function listNewsEntries(league) {
  return Array.isArray(league?.newsFeed) ? league.newsFeed.slice() : [];
}
