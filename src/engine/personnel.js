import { ROLES_OFF, ROLES_DEF, TEAM_RED, TEAM_BLK } from './constants';
import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { clamp, choice, rand } from './helpers';
import { buildCoachForTeam } from './coaches';
import {
  ensurePlayerTemperament,
  cloneTemperament,
  computeTeamMood,
  updateTeamTemperament,
  temperamentScoutAdjustment,
  resetTemperamentToNeutral,
  roleGroupFor,
  getTeamCoach,
  adjustPlayerMood,
} from './temperament';

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

const ROLE_BODY_PROFILES = {
  QB: { height: [73, 78], weight: [208, 248] },
  RB: { height: [69, 73], weight: [198, 225] },
  WR1: { height: [71, 76], weight: [188, 212] },
  WR2: { height: [70, 75], weight: [184, 208] },
  WR3: { height: [69, 74], weight: [180, 204] },
  TE: { height: [75, 79], weight: [240, 268] },
  LT: { height: [77, 81], weight: [305, 335] },
  LG: { height: [76, 80], weight: [302, 332] },
  C: { height: [75, 79], weight: [298, 328] },
  RG: { height: [76, 80], weight: [302, 332] },
  RT: { height: [77, 81], weight: [305, 335] },
  LE: { height: [75, 79], weight: [272, 298] },
  DT: { height: [75, 79], weight: [300, 332] },
  RTk: { height: [75, 79], weight: [296, 326] },
  RE: { height: [75, 79], weight: [270, 296] },
  LB1: { height: [74, 78], weight: [234, 255] },
  LB2: { height: [73, 77], weight: [230, 252] },
  CB1: { height: [70, 74], weight: [186, 205] },
  CB2: { height: [69, 73], weight: [182, 202] },
  S1: { height: [71, 75], weight: [200, 220] },
  S2: { height: [70, 74], weight: [198, 218] },
  NB: { height: [69, 73], weight: [180, 202] },
  K: { height: [70, 75], weight: [182, 214] },
  DEFAULT: { height: [71, 76], weight: [198, 228] },
};

function profileTemplateForRole(role = 'DEFAULT') {
  if (!role) return ROLE_BODY_PROFILES.DEFAULT;
  return ROLE_BODY_PROFILES[role] || ROLE_BODY_PROFILES[role?.replace(/\d+$/, '')] || ROLE_BODY_PROFILES.DEFAULT;
}

function clampRating(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return clamp(Math.round(value), 0, 99);
}

function assignPhysicalProfile(player, role = 'QB') {
  if (!player) return;
  const template = profileTemplateForRole(role);
  const [minHeight, maxHeight] = template.height;
  const [minWeight, maxWeight] = template.weight;
  const resolvedHeight = clamp(player.height ?? player.body?.height ?? rand(minHeight, maxHeight), minHeight, maxHeight);
  const resolvedWeight = clamp(player.weight ?? player.body?.weight ?? rand(minWeight, maxWeight), minWeight, maxWeight);
  const heightInt = Math.round(resolvedHeight);
  const weightInt = Math.round(resolvedWeight);
  player.height = heightInt;
  player.weight = weightInt;
  player.body = { ...(player.body || {}), height: heightInt, weight: weightInt };
}

function computeCoachOverall(coach = {}) {
  const tactical = clamp((coach.tacticalIQ ?? 1) / 1.25, 0, 1);
  const playcalling = clamp((coach.playcallingIQ ?? coach.tacticalIQ ?? 1) / 1.25, 0, 1);
  const development = clamp(((coach.development?.offense ?? 0.2) + (coach.development?.defense ?? 0.2)) / 0.85, 0, 1);
  const skillFocus = clamp(((coach.development?.qb ?? 0.2) + (coach.development?.skill ?? 0.2)) / 0.75, 0, 1);
  const aggression = coach.tendencies?.aggression ?? 0;
  const aggressionScore = 1 - Math.min(1, Math.abs(aggression) * 1.25);
  const total = tactical * 0.3 + playcalling * 0.25 + development * 0.2 + skillFocus * 0.1 + aggressionScore * 0.15;
  return clampRating(40 + total * 55);
}

function computeScoutOverall(scout = {}) {
  const evaluation = clamp(scout.evaluation ?? 0.5, 0, 1);
  const development = clamp(scout.development ?? 0.5, 0, 1);
  const trade = clamp(scout.trade ?? 0.5, 0, 1);
  const temperament = clamp(scout.temperamentSense ?? 0.5, 0, 1);
  const aggression = clamp(1 - Math.min(1, Math.abs((scout.aggression ?? 0.5) - 0.5) * 2), 0, 1);
  const total = evaluation * 0.35 + development * 0.25 + trade * 0.2 + temperament * 0.12 + aggression * 0.08;
  return clampRating(40 + total * 55);
}

function computeGmOverall(gm = {}) {
  const evaluation = clamp(gm.evaluation ?? 0.5, 0, 1);
  const vision = clamp(gm.vision ?? 0.5, 0, 1);
  const culture = clamp(gm.culture ?? 0.5, 0, 1);
  const discipline = clamp(gm.discipline ?? 0.5, 0, 1);
  const patience = clamp(gm.patience ?? 0.5, 0, 1);
  const charisma = clamp(gm.charisma ?? 0.5, 0, 1);
  const total = evaluation * 0.24 + vision * 0.2 + culture * 0.16 + discipline * 0.16 + patience * 0.14 + charisma * 0.1;
  return clampRating(42 + total * 52);
}

function computeKickerOverall(player = {}) {
  const maxDistance = clamp(player.maxDistance ?? 48, 30, 70);
  const accuracy = clamp(player.accuracy ?? 0.75, 0.4, 0.99);
  const rangeScore = clamp((maxDistance - 35) / 40, 0, 1);
  const accuracyScore = clamp((accuracy - 0.45) / 0.5, 0, 1);
  const clutch = clamp(player.clutch ?? 0.6, 0, 1);
  const total = rangeScore * 0.45 + accuracyScore * 0.4 + clutch * 0.15;
  return clampRating(38 + total * 58);
}

function updateCoachOverall(coach) {
  if (!coach) return coach;
  coach.overall = computeCoachOverall(coach);
  return coach;
}

function updateScoutOverall(scout) {
  if (!scout) return scout;
  scout.overall = computeScoutOverall(scout);
  return scout;
}

function updateGmOverall(gm) {
  if (!gm) return gm;
  gm.overall = computeGmOverall(gm);
  return gm;
}

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

const COACH_FIRST = [
  'Aisha', 'Bruno', 'Celeste', 'Dante', 'Elena', 'Farrah', 'Gideon', 'Harlow', 'Imani', 'Jonas',
  'Kira', 'Luther', 'Maris', 'Nia', 'Orlando', 'Priya', 'Quentin', 'Rhea', 'Soren', 'Talia',
  'Ulrich', 'Vida', 'Wallace', 'Xenia', 'Yael', 'Zeke',
];

const COACH_LAST = [
  'Abernathy', 'Bellinger', 'Crowder', 'Duvall', 'Easton', 'Falk', 'Grayson', 'Hightower', 'Ivory', 'Jennings',
  'Kowalski', 'Lombard', 'Mackey', 'Nightingale', 'Oakford', 'Presley', 'Quaid', 'Romero', 'Stroud', 'Trevino',
  'Upchurch', 'Villar', 'Whitfield', 'Xavier', 'Youngblood', 'Zamora',
];

const GM_FIRST = [
  'Addison', 'Blaire', 'Cassidy', 'Devin', 'Ellery', 'Fallon', 'Greer', 'Hollis', 'Indigo', 'Jules',
  'Keegan', 'Lennon', 'Monroe', 'Noel', 'Oakley', 'Perrin', 'Quincy', 'Rowan', 'Sloane', 'Tobin',
  'Umber', 'Vale', 'Winslet', 'Xander', 'Yaeger', 'Zephyr',
];

const GM_LAST = [
  'Ashcroft', 'Briar', 'Copeland', 'Drummond', 'Ellsworth', 'Fairchild', 'Graves', 'Halbrook', 'Ingles', 'Jasper',
  'Kingsley', 'Lachance', 'Maddox', 'Norwood', 'Oakridge', 'Prescott', 'Quimby', 'Rutherford', 'Sinclair', 'Thatcher',
  'Underhill', 'Vander', 'Warrick', 'Xenos', 'Yorke', 'Zell',
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

function randomCoachName() {
  return `${choice(COACH_FIRST)} ${choice(COACH_LAST)}`;
}

function randomGmName() {
  return `${choice(GM_FIRST)} ${choice(GM_LAST)}`;
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
    temperament: cloneTemperament(data.temperament),
    body: { ...(data.body || {}) },
    height: data.height ?? null,
    weight: data.weight ?? null,
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
  return clampRating(40 + normalizedScore * 55);
}

function decoratePlayerMetrics(player, role) {
  if (!player) return player;
  const updated = player;
  if (role === 'K') {
    const maxDistance = clamp(player.maxDistance ?? player.attrs?.maxDistance ?? 48, 30, 70);
    const accuracy = clamp(player.accuracy ?? player.attrs?.accuracy ?? 0.75, 0.4, 0.99);
    const clutch = clamp(player.clutch ?? rand(0.45, 0.9), 0, 1);
    updated.maxDistance = maxDistance;
    updated.accuracy = accuracy;
    updated.clutch = clutch;
    updated.attrs = { maxDistance, accuracy };
    updated.baseAttrs = updated.baseAttrs || { maxDistance, accuracy };
    updated.overall = computeKickerOverall(updated);
  } else {
    updated.overall = computeOverallFromRatings(updated.ratings, role);
  }
  if (updated.potential == null) {
    const variance = rand(0.05, 0.25);
    const normalized = clamp(updated.overall / 99 + variance, 0, 1.25);
    updated.potential = Math.max(normalized, updated.overall / 99);
  }
  updated.ceiling = updated.ceiling != null ? updated.ceiling : Math.max(updated.potential, updated.overall / 99 + 0.1);
  if (!updated.health) {
    updated.health = { durability: clamp(rand(0.7, 1.05), 0.5, 1.2), history: [] };
  }
  assignPhysicalProfile(updated, role);
  ensurePlayerTemperament(updated);
  return updated;
}

function initialiseRosterMetrics(league) {
  const rosters = ensureTeamRosterShell(league);
  Object.entries(rosters).forEach(([teamId, roster]) => {
    Object.entries(roster.offense || {}).forEach(([role, player]) => {
      roster.offense[role] = decoratePlayerMetrics(player, role);
      ensurePlayerDirectoryEntry(league, teamId, role, roster.offense[role]);
    });
    Object.entries(roster.defense || {}).forEach(([role, player]) => {
      roster.defense[role] = decoratePlayerMetrics(player, role);
      ensurePlayerDirectoryEntry(league, teamId, role, roster.defense[role]);
    });
    if (roster.special?.K) {
      roster.special.K = decoratePlayerMetrics(roster.special.K, 'K');
      ensurePlayerDirectoryEntry(league, teamId, 'K', roster.special.K);
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
    preferredRole: role,
  };
  if (role === 'K') {
    player.maxDistance = clamp(rand(43, 62), 35, 68);
    player.accuracy = clamp(rand(0.62, 0.92), 0.4, 0.98);
    player.clutch = clamp(rand(0.45, 0.9), 0.3, 1);
  }
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

let coachFreeAgentCounter = 1;
let scoutFreeAgentCounter = 1;
let gmFreeAgentCounter = 1;

function randomBoostAttribute() {
  const keys = Object.keys(ATTR_RANGES);
  return choice(keys);
}

function buildBoostMap(roles, count = 2, magnitude = [0.02, 0.06]) {
  const entries = {};
  const pool = [...roles];
  for (let i = 0; i < count && pool.length; i += 1) {
    const role = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (!role) continue;
    const attrA = randomBoostAttribute();
    const attrB = randomBoostAttribute();
    entries[role] = {
      [attrA]: rand(magnitude[0], magnitude[1]),
      ...(Math.random() < 0.65 ? { [attrB]: rand(magnitude[0] * 0.8, magnitude[1] * 0.9) } : {}),
    };
  }
  return entries;
}

function generateCoachCandidate() {
  const coach = buildCoachForTeam('FA', { slot: TEAM_RED });
  const idSuffix = String(coachFreeAgentCounter).padStart(3, '0');
  coachFreeAgentCounter += 1;
  coach.id = `COACH-FA-${idSuffix}`;
  coach.name = randomCoachName();
  coach.philosophy = choice(['offense', 'defense', 'balanced']);
  coach.tacticalIQ = clamp(rand(0.85, 1.25), 0.7, 1.35);
  coach.playcallingIQ = clamp(coach.tacticalIQ + rand(-0.08, 0.12), 0.7, 1.35);
  coach.clock = {
    hurry: clamp(Math.round(rand(130, 165)), 120, 180),
    defensive: clamp(Math.round(rand(110, 145)), 100, 160),
    must: clamp(Math.round(rand(28, 40)), 24, 45),
    margin: clamp(Math.round(rand(6, 11)), 4, 12),
  };
  coach.tendencies = {
    passBias: clamp(rand(-0.3, 0.35), -0.4, 0.4),
    runBias: clamp(rand(-0.25, 0.3), -0.35, 0.35),
    aggression: clamp(rand(-0.2, 0.35), -0.35, 0.45),
  };
  const offenseTeamBoost = { [randomBoostAttribute()]: rand(0.02, 0.05) };
  const defenseTeamBoost = { [randomBoostAttribute()]: rand(0.02, 0.05) };
  coach.playerBoosts = {
    offense: { team: offenseTeamBoost, positions: buildBoostMap(ROLES_OFF, 2) },
    defense: { team: defenseTeamBoost, positions: buildBoostMap(ROLES_DEF, 2) },
  };
  coach.development = {
    offense: clamp(rand(0.2, 0.32), 0.18, 0.36),
    defense: clamp(rand(0.2, 0.32), 0.18, 0.36),
    qb: clamp(rand(0.2, 0.35), 0.18, 0.38),
    skill: clamp(rand(0.2, 0.32), 0.18, 0.36),
    run: clamp(rand(0.18, 0.32), 0.16, 0.34),
  };
  const aggression = clamp(coach.tendencies.aggression ?? 0, -0.4, 0.45);
  const supportBase = ((coach.development.offense ?? 0.22) + (coach.development.defense ?? 0.22)) / 2;
  const support = clamp(supportBase - 0.25, -0.35, 0.4);
  const composure = clamp((coach.tacticalIQ ?? 1) - 1, -0.25, 0.35);
  coach.temperamentProfile = { aggression, support, composure };
  coach.origin = 'staff-free-agent';
  coach.resume ||= { experience: Math.round(rand(3, 12)) };
  delete coach.teamId;
  delete coach.identity;
  return updateCoachOverall(coach);
}

function generateScoutCandidate() {
  const idSuffix = String(scoutFreeAgentCounter).padStart(3, '0');
  scoutFreeAgentCounter += 1;
  const scout = {
    id: `SCOUT-FA-${idSuffix}`,
    name: randomScoutName(),
    evaluation: clamp(rand(0.45, 0.9), 0.35, 0.95),
    development: clamp(rand(0.35, 0.85), 0.3, 0.95),
    trade: clamp(rand(0.35, 0.88), 0.28, 0.95),
    aggression: clamp(rand(0.2, 0.85), 0.15, 0.95),
    temperamentSense: clamp(rand(0.3, 0.85), 0.2, 0.95),
    origin: 'staff-free-agent',
  };
  return updateScoutOverall(scout);
}

function generateGmCandidate({ teamId = null } = {}) {
  const id = teamId ? `GM-${teamId}` : `GM-FA-${String(gmFreeAgentCounter).padStart(3, '0')}`;
  if (!teamId) gmFreeAgentCounter += 1;
  const patience = clamp(rand(0.35, 0.9), 0.25, 0.95);
  const discipline = clamp(rand(0.45, 0.92), 0.3, 0.98);
  const evaluation = clamp(rand(0.45, 0.92), 0.35, 0.98);
  const vision = clamp(rand(0.4, 0.92), 0.3, 0.98);
  const culture = clamp(rand(0.4, 0.9), 0.3, 0.96);
  const gm = {
    id,
    teamId,
    name: randomGmName(),
    evaluation,
    culture,
    discipline,
    patience,
    vision,
    charisma: clamp(rand(0.3, 0.85), 0.2, 0.95),
    tenure: 0,
    frustration: 0,
    origin: teamId ? 'franchise' : 'staff-free-agent',
  };
  return updateGmOverall(gm);
}

function ensureTeamCoaches(league) {
  if (!league.teamCoaches) league.teamCoaches = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamCoaches[teamId]) {
      const identity = getTeamIdentity(teamId) || null;
      const coach = buildCoachForTeam(teamId, { identity });
      league.teamCoaches[teamId] = updateCoachOverall({ ...coach, teamId });
    } else {
      updateCoachOverall(league.teamCoaches[teamId]);
    }
  });
}

function ensureTeamGms(league) {
  if (!league.teamGms) league.teamGms = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamGms[teamId]) {
      league.teamGms[teamId] = generateGmCandidate({ teamId });
    } else {
      updateGmOverall(league.teamGms[teamId]);
    }
  });
}

function ensureStaffFreeAgents(league) {
  if (!league.staffFreeAgents) {
    league.staffFreeAgents = { coaches: [], scouts: [], gms: [] };
  }
  const pools = league.staffFreeAgents;
  pools.coaches = Array.isArray(pools.coaches) ? pools.coaches : [];
  pools.scouts = Array.isArray(pools.scouts) ? pools.scouts : [];
  pools.gms = Array.isArray(pools.gms) ? pools.gms : [];
  pools.coaches.forEach(updateCoachOverall);
  pools.scouts.forEach(updateScoutOverall);
  pools.gms.forEach(updateGmOverall);
  while (pools.coaches.length < 6) {
    pools.coaches.push(generateCoachCandidate());
  }
  while (pools.scouts.length < 6) {
    pools.scouts.push(generateScoutCandidate());
  }
  while (pools.gms.length < 4) {
    pools.gms.push(generateGmCandidate());
  }
}

const SUSPENSION_SCENARIOS = [
  {
    key: 'steroid-test',
    reason: 'testing positive for steroids',
    detail: 'League policy kicks in immediately — {games}-game ban and a confiscated gym keycard.',
    severity: 'major',
    games: [4, 6],
  },
  {
    key: 'gambling-show',
    reason: 'hosting an unsanctioned gambling advice stream',
    detail: 'League policy violation results in a {games}-game suspension and confiscated parlay slips.',
    severity: 'moderate',
    games: [2, 4],
  },
  {
    key: 'helmet-flip',
    reason: 'spiking a helmet into the stands after a game',
    detail: 'League cites fan safety and issues a {games}-game timeout from competition.',
    severity: 'moderate',
    games: [2, 3],
  },
  {
    key: 'drone-prank',
    reason: 'flying a drone during practice walkthroughs',
    detail: 'Player grounded for {games} games after buzzing the commissioner\'s suite.',
    severity: 'moderate',
    games: [1, 3],
  },
  {
    key: 'cryptic-booster',
    reason: 'using a banned “mental clarity” nasal spray',
    detail: 'Experimental focus mist backfires; {games}-game suspension issued.',
    severity: 'moderate',
    games: [3, 5],
  },
  {
    key: 'media-absence',
    reason: 'refusing every mandatory media session for a month',
    detail: 'The silent treatment earns a {games}-game suspension and a crash course in public speaking.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'fashion-fine',
    reason: 'showing up to media day in unlicensed rival merch',
    detail: 'League comes down hard with a {games}-game suspension and fashion counseling.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'sideline-hustle',
    reason: 'running a sideline hot sauce stand without permits',
    detail: 'Food safety inspectors drop the hammer — {games}-game suspension.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'playbook-leak',
    reason: 'leaking encrypted playbook pages to impress a date',
    detail: 'League security traces the leak and hands out a {games}-game suspension.',
    severity: 'major',
    games: [3, 5],
  },
  {
    key: 'mascot-incident',
    reason: 'wrestling the opposing mascot mid-game',
    detail: 'Mascot wrangling is frowned upon; {games}-game suspension issued.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'midnight-livestream',
    reason: 'live-streaming the playbook review from the locker room',
    detail: 'Team scrambles to change signals; league imposes a {games}-game ban.',
    severity: 'moderate',
    games: [2, 4],
  },
  {
    key: 'celebration-damage',
    reason: 'destroying the league trophy replica during celebrations',
    detail: 'League accountants tally the bill and tack on a {games}-game suspension.',
    severity: 'moderate',
    games: [2, 3],
  },
  {
    key: 'practice-no-show',
    reason: 'skipping practice to headline a pop-up DJ tour',
    detail: 'Coach fumes, league steps in with a {games}-game suspension.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'unauthorized-ad',
    reason: 'filming an unapproved energy drink commercial on the logo',
    detail: 'Marketing faux pas draws a {games}-game suspension and cleanup duty.',
    severity: 'moderate',
    games: [1, 3],
  },
];

const OFFFIELD_INJURY_SCENARIOS = [
  {
    key: 'gasoline-fight',
    description: 'freak gasoline fight incident',
    detail: 'Singed eyebrows, bruised ego — trainers call it {games}-game recovery.',
    severity: 'moderate',
    games: [2, 3],
  },
  {
    key: 'vr-mishap',
    description: 'virtual reality headset collision',
    detail: 'Walked straight into the trophy case during a VR walkthrough. Out {games} games.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'pet-iguana',
    description: 'pet iguana tail whip',
    detail: 'Exotic pet hobby strikes back — trainers expect {games}-game absence.',
    severity: 'minor',
    games: [1, 1],
  },
  {
    key: 'food-truck',
    description: 'gourmet food truck grease burn',
    detail: 'Went for seconds, came back with bandages. Sitting {games} games.',
    severity: 'moderate',
    games: [2, 4],
  },
  {
    key: 'trampoline',
    description: 'ill-advised victory trampoline routine',
    detail: 'Backyard celebrations go wrong; {games}-game rest mandated.',
    severity: 'moderate',
    games: [1, 3],
  },
  {
    key: 'escape-room',
    description: 'escape-room shoulder tweak',
    detail: 'Twisted wrong turning a fake key. Out {games} games.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'karaoke',
    description: 'overzealous karaoke mic drop',
    detail: 'Dove to catch the beat, sprained wrist. Misses {games} games.',
    severity: 'minor',
    games: [1, 1],
  },
  {
    key: 'arcade-claw',
    description: 'arcade claw machine rescue attempt',
    detail: 'Reached for the prize, strained shoulder — {games}-game hiatus.',
    severity: 'moderate',
    games: [1, 3],
  },
  {
    key: 'candle-workshop',
    description: 'spilled wax during an aromatherapy candle workshop',
    detail: 'Hot wax blisters require {games} games to cool off.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'board-game',
    description: 'slipped celebrating a board-game victory',
    detail: 'Victory dance ends with a sprained ankle — out {games} games.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'chef-knife',
    description: 'nicked a thumb perfecting a gourmet chop',
    detail: 'Thumb wrapped, player shelved for {games} games.',
    severity: 'minor',
    games: [1, 1],
  },
  {
    key: 'yoga-goat',
    description: 'was head-butted at goat yoga',
    detail: 'Mindfulness interrupted — medical staff orders {games}-game rest.',
    severity: 'moderate',
    games: [1, 3],
  },
  {
    key: 'home-reno',
    description: 'tweaked a back attempting DIY home renovation',
    detail: 'That backsplash can wait; {games}-game recovery prescribed.',
    severity: 'moderate',
    games: [2, 4],
  },
  {
    key: 'pet-obstacle',
    description: 'tripped over their dog\'s agility course',
    detail: 'Canine conditioning misstep sidelines them for {games} games.',
    severity: 'minor',
    games: [1, 2],
  },
  {
    key: 'laser-tag',
    description: 'collided in a late-night laser tag marathon',
    detail: 'Glow-in-the-dark bruise keeps them out {games} games.',
    severity: 'moderate',
    games: [1, 3],
  },
  {
    key: 'festival-crowd',
    description: 'rolled an ankle crowd-surfing at a music festival',
    detail: 'Fans caught them, trainers now catching them up after {games} games off.',
    severity: 'moderate',
    games: [2, 4],
  },
  {
    key: 'ice-sculpture',
    description: 'sliced a finger carving an ice sculpture',
    detail: 'Artistry paused; {games}-game bandage break ordered.',
    severity: 'minor',
    games: [1, 2],
  },
];

const BOOST_SCENARIOS = [
  {
    key: 'lucky-penny',
    headline: 'finds a lucky penny heads-up at walkthrough',
    detail: 'Claims the shine boosted film-study IQ. Coaches expect sharper reads next game.',
    mood: 0.22,
    awareness: 0.04,
  },
  {
    key: 'community-clinic',
    headline: 'hosts a youth clinic and rediscovers the joy of the game',
    detail: 'Locker room vibes climb after the charity session.',
    mood: 0.18,
  },
  {
    key: 'chef-lesson',
    headline: 'takes a gourmet cooking class for team meal prep',
    detail: 'Sharper knife skills translate to sharper route timing.',
    agility: 0.03,
    mood: 0.12,
  },
  {
    key: 'meditation-retreat',
    headline: 'completes a surprise meditation retreat',
    detail: 'Focus drills raise awareness ahead of next matchup.',
    awareness: 0.05,
  },
  {
    key: 'book-club',
    headline: 'leads the team book club through a strategy memoir',
    detail: 'Unlocks new timing cues — teammates rave about leadership bump.',
    throwAcc: 0.03,
    mood: 0.1,
  },
  {
    key: 'sprint-coach',
    headline: 'spends the bye week with an Olympic sprint coach',
    detail: 'Footwork looks crisper already.',
    speed: 0.05,
  },
  {
    key: 'film-marathon',
    headline: 'breaks down every snap from the last month',
    detail: 'Coaches rave about the extra study time paying off.',
    awareness: 0.05,
  },
  {
    key: 'sleep-coach',
    headline: 'hires a sleep coach to perfect recovery',
    detail: 'Rested body means fresher legs heading into game day.',
    speed: 0.03,
    mood: 0.08,
  },
  {
    key: 'chef-pop-up',
    headline: 'runs a pop-up smoothie bar for teammates',
    detail: 'Nutrition boost has everyone buzzing — especially them.',
    strength: 0.03,
    mood: 0.06,
  },
  {
    key: 'vr-film',
    headline: 'uses VR reps to master coverage rotations',
    detail: 'Defensive reads trending upward after the tech sessions.',
    awareness: 0.04,
    agility: 0.02,
  },
  {
    key: 'mentorship',
    headline: 'spends off days mentoring rookies',
    detail: 'Leadership glow lifts locker room spirits.',
    mood: 0.16,
  },
  {
    key: 'track-relay',
    headline: 'anchors a local track relay for charity',
    detail: 'Burst looks improved after sprinting with sprinters.',
    accel: 0.05,
  },
  {
    key: 'strength-clinic',
    headline: 'joins a legendary strength coach for a weekend',
    detail: 'Weight room numbers spike immediately.',
    strength: 0.05,
  },
  {
    key: 'film-nap',
    headline: 'perfects the nap-to-film ratio',
    detail: 'Feels sharper and calmer under pressure.',
    awareness: 0.03,
    mood: 0.09,
  },
  {
    key: 'community-garden',
    headline: 'launches a community garden project',
    detail: 'Hands in the soil, mind at ease — team notices renewed focus.',
    mood: 0.14,
    awareness: 0.02,
  },
];

const QUIRKY_NEWS = [
  {
    key: 'puzzle-obsession',
    headline: 'cannot stop completing thousand-piece puzzles',
    detail: 'Team nutritionist confiscates jigsaw table before it becomes a distraction.',
    mood: -0.08,
  },
  {
    key: 'podcast-binge',
    headline: 'starts a conspiracy podcast about rival playbooks',
    detail: 'League issues a warning but fans cannot stop listening.',
    mood: 0,
  },
  {
    key: 'beekeeping',
    headline: 'takes up urban beekeeping between games',
    detail: 'A surprise honey sampling boosts the O-line\'s tea time.',
    mood: 0.05,
  },
  {
    key: 'esports-night',
    headline: 'hosts an all-night esports tournament',
    detail: 'Team shows up yawning — coaches threaten to unplug the routers.',
    mood: -0.12,
  },
  {
    key: 'fashion-line',
    headline: 'launches a sideline athleisure line',
    detail: 'Pre-orders sell out; teammates beg for samples.',
    mood: 0.09,
  },
  {
    key: 'reality-cameo',
    headline: 'films a chaotic reality-show cameo',
    detail: 'Producers capture a heated playbook debate — league keeps an eye on spoilers.',
    mood: -0.05,
  },
  {
    key: 'ferret-sitting',
    headline: 'volunteers to pet-sit a teammate\'s ferrets',
    detail: 'Locker room now smells faintly of ferret snacks; spirits oddly lifted.',
    mood: 0.04,
  },
  {
    key: 'cryptid-hunt',
    headline: 'organizes a midnight cryptid hunt in the practice facility',
    detail: 'Security unimpressed, but team group chat is on fire.',
    mood: -0.02,
  },
  {
    key: 'documentary-club',
    headline: 'forces everyone into a true-crime documentary club',
    detail: 'Players debate plot twists more than route trees this week.',
    mood: -0.04,
  },
  {
    key: 'mural-project',
    headline: 'paints a massive mural in the locker room',
    detail: 'Artistic flair brightens the hallways and teammates love it.',
    mood: 0.11,
  },
  {
    key: 'culinary-stream',
    headline: 'streams late-night cooking battles from the team kitchen',
    detail: 'Nutritionist concerned; fans demand the recipes.',
    mood: 0.03,
  },
  {
    key: 'mini-golf-tour',
    headline: 'books the entire squad on a surprise mini-golf tour',
    detail: 'Putting rivalry spills into practice with goofy trophies.',
    mood: 0.07,
  },
  {
    key: 'escape-room-guru',
    headline: 'becomes obsessed with escape rooms',
    detail: 'Keeps hiding the playbook to “improve puzzle skills.” Staff mildly annoyed.',
    mood: -0.06,
  },
  {
    key: 'fashion-police',
    headline: 'hands out pregame drip report cards',
    detail: 'Some egos bruised, others step up their wardrobe game.',
    mood: 0.01,
  },
  {
    key: 'streamer-collab',
    headline: 'collabs with a famous speedrunner for charity',
    detail: 'Stream hits big donation goals and boosts morale.',
    mood: 0.12,
  },
  {
    key: 'antique-hunting',
    headline: 'collects antique helmets and lines them in the meeting room',
    detail: 'Coach nearly trips, but history lesson captivates the rookies.',
    mood: 0.02,
  },
];

function resolveGamesRange(range) {
  if (Array.isArray(range) && range.length) {
    const [min, max = min] = range;
    return Math.max(1, Math.round(rand(min, max)));
  }
  if (Number.isFinite(range)) return Math.max(1, Math.round(range));
  return 1;
}

function formatScenarioDetail(template, games) {
  if (!template) return null;
  return template.replace('{games}', games);
}

function pickRandomActivePlayer(league) {
  if (!league) return null;
  const rosters = ensureTeamRosterShell(league);
  const pool = [];
  TEAM_IDS.forEach((teamId) => {
    const roster = rosters[teamId];
    if (!roster) return;
    const register = (player, role) => {
      if (!player?.id) return;
      if (league.injuredReserve && league.injuredReserve[player.id]) return;
      pool.push({ player, role, teamId });
    };
    Object.entries(roster.offense || {}).forEach(([role, player]) => register(player, role));
    Object.entries(roster.defense || {}).forEach(([role, player]) => register(player, role));
    if (roster.special?.K) register(roster.special.K, 'K');
  });
  if (!pool.length) return null;
  return choice(pool);
}

function applyScenarioAdjustments(selection, adjustments = {}) {
  if (!selection?.player) return;
  const { player, role } = selection;
  const attrDeltas = {};
  Object.keys(ATTR_RANGES).forEach((attr) => {
    const delta = adjustments[attr];
    if (typeof delta === 'number' && !Number.isNaN(delta) && delta !== 0) {
      attrDeltas[attr] = delta;
    }
  });
  if (Object.keys(attrDeltas).length) {
    player.ratings ||= {};
    Object.entries(attrDeltas).forEach(([attr, delta]) => {
      const [min, max] = ATTR_RANGES[attr];
      const current = player.ratings[attr] ?? min;
      player.ratings[attr] = clamp(current + delta, min, max);
    });
    decoratePlayerMetrics(player, role);
  }
  if (typeof adjustments.mood === 'number' && !Number.isNaN(adjustments.mood) && adjustments.mood !== 0) {
    adjustPlayerMood(player, adjustments.mood);
  }
}

function ensureFunNewsTracker(league, seasonNumber) {
  league.funNewsTracker ||= { season: seasonNumber, weeklyCounts: {}, total: 0 };
  if (league.funNewsTracker.season !== seasonNumber) {
    league.funNewsTracker = { season: seasonNumber, weeklyCounts: {}, total: 0 };
  }
  league.funNewsTracker.weeklyCounts ||= {};
  return league.funNewsTracker;
}

function playerHeadlineName(player) {
  if (!player) return 'Player';
  const first = player.firstName || 'Player';
  const last = player.lastName ? ` ${player.lastName}` : '';
  return `${first}${last}`;
}

export function maybeGenerateLeagueHeadlines(league, season, { game = null } = {}) {
  if (!league) return;
  const seasonNumber = season?.seasonNumber || league.seasonNumber || 1;
  const tracker = ensureFunNewsTracker(league, seasonNumber);
  const week = game?.week ?? null;
  if (week != null) {
    tracker.weeklyCounts[week] = tracker.weeklyCounts[week] || 0;
    if (tracker.weeklyCounts[week] >= 2) return;
  }
  if (Math.random() > 0.22) return;
  const selection = pickRandomActivePlayer(league);
  if (!selection) return;
  const { player, role, teamId } = selection;
  const roll = Math.random();
  let executed = false;

  if (roll < 0.28) {
    const scenario = choice(BOOST_SCENARIOS);
    applyScenarioAdjustments(selection, scenario);
    const text = `${playerHeadlineName(player)} (${role}) ${scenario.headline}`;
    recordNewsInternal(league, {
      type: 'spotlight',
      teamId,
      text,
      detail: scenario.detail || null,
      seasonNumber,
    });
    executed = true;
  } else if (roll < 0.5) {
    const scenario = choice(QUIRKY_NEWS);
    applyScenarioAdjustments(selection, { mood: scenario.mood || 0 });
    const text = `${playerHeadlineName(player)} (${role}) ${scenario.headline}`;
    recordNewsInternal(league, {
      type: 'headline',
      teamId,
      text,
      detail: scenario.detail || null,
      seasonNumber,
    });
    executed = true;
  } else if (roll < 0.8) {
    const scenario = choice(OFFFIELD_INJURY_SCENARIOS);
    const games = resolveGamesRange(scenario.games);
    const irEntry = registerPlayerInjury(league, {
      player,
      teamId,
      role,
      severity: scenario.severity || 'minor',
      gamesMissed: Math.max(1, games),
      description: scenario.description,
      seasonNumber,
      headline: `injured in ${scenario.description}`,
      detail: formatScenarioDetail(scenario.detail, games),
      countTowardsLimit: false,
    });
    assignReplacementForAbsence(league, irEntry, { reason: 'off-field injury replacement' });
    adjustPlayerMood(player, -0.12);
    executed = true;
  } else {
    const scenario = choice(SUSPENSION_SCENARIOS);
    const games = resolveGamesRange(scenario.games);
    const irEntry = registerPlayerSuspension(league, {
      player,
      teamId,
      role,
      severity: scenario.severity || 'moderate',
      gamesMissed: Math.max(1, games),
      description: scenario.reason,
      seasonNumber,
      headline: `suspended after ${scenario.reason}`,
      detail: formatScenarioDetail(scenario.detail, games),
    });
    assignReplacementForAbsence(league, irEntry, { reason: 'suspension replacement' });
    adjustPlayerMood(player, -0.2);
    executed = true;
  }

  if (executed) {
    tracker.total = (tracker.total || 0) + 1;
    if (week != null) {
      tracker.weeklyCounts[week] = (tracker.weeklyCounts[week] || 0) + 1;
    }
  }
}

function ensureScouts(league) {
  if (!league.teamScouts) league.teamScouts = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamScouts[teamId]) {
      const primary = clamp(rand(0.5, 0.95), 0.4, 0.98);
      league.teamScouts[teamId] = updateScoutOverall({
        id: `SCOUT-${teamId}`,
        name: randomScoutName(),
        evaluation: primary,
        development: clamp(primary + rand(-0.2, 0.15), 0.3, 0.95),
        trade: clamp(primary + rand(-0.15, 0.2), 0.35, 0.96),
        aggression: clamp(rand(0.3, 0.9), 0.2, 0.95),
      });
    } else {
      updateScoutOverall(league.teamScouts[teamId]);
    }
  });
}

function ensureNewsFeed(league) {
  if (!Array.isArray(league.newsFeed)) league.newsFeed = [];
}

function coachCandidateScore(candidate = {}, gm = null) {
  const tactical = candidate.tacticalIQ ?? 1;
  const play = candidate.playcallingIQ ?? tactical;
  const dev = (candidate.development?.offense ?? 0.2) + (candidate.development?.defense ?? 0.2);
  const aggression = candidate.tendencies?.aggression ?? 0;
  const gmVision = gm?.vision ?? 0.5;
  const fit = 1 - Math.min(1, Math.abs(gmVision - (aggression + 0.5)));
  const experience = candidate.resume?.experience ?? 6;
  return tactical * 0.4 + play * 0.35 + dev * 0.18 + fit * 0.05 + experience * 0.02;
}

function takeCoachCandidate(league, gm) {
  ensureStaffFreeAgents(league);
  const pool = league.staffFreeAgents.coaches;
  if (!pool.length) pool.push(generateCoachCandidate());
  let bestIndex = 0;
  let bestScore = -Infinity;
  pool.forEach((candidate, index) => {
    const score = coachCandidateScore(candidate, gm);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  const [candidate] = pool.splice(bestIndex, 1);
  return updateCoachOverall(candidate || generateCoachCandidate());
}

function scoutCandidateScore(candidate = {}, gm = null) {
  const evaluation = candidate.evaluation ?? 0.5;
  const development = candidate.development ?? 0.5;
  const trade = candidate.trade ?? 0.5;
  const temperament = candidate.temperamentSense ?? 0.5;
  const aggression = candidate.aggression ?? 0.5;
  const culture = gm?.culture ?? 0.5;
  const discipline = gm?.discipline ?? 0.5;
  const aggressionFit = 1 - Math.min(1, Math.abs(aggression - culture));
  return evaluation * 0.35 + development * 0.25 + trade * 0.2 + temperament * 0.1 + aggressionFit * 0.1 + discipline * 0.02;
}

function takeScoutCandidate(league, gm) {
  ensureStaffFreeAgents(league);
  const pool = league.staffFreeAgents.scouts;
  if (!pool.length) pool.push(generateScoutCandidate());
  let bestIndex = 0;
  let bestScore = -Infinity;
  pool.forEach((candidate, index) => {
    const score = scoutCandidateScore(candidate, gm);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  const [candidate] = pool.splice(bestIndex, 1);
  return updateScoutOverall(candidate || generateScoutCandidate());
}

function replaceCoach(league, teamId, coach, gm, seasonNumber, { reason } = {}) {
  if (!league || !teamId || !coach) return false;
  ensureStaffFreeAgents(league);
  const identity = getTeamIdentity(teamId) || { id: teamId, abbr: teamId, displayName: teamId };
  league.staffFreeAgents.coaches.push(updateCoachOverall({
    ...coach,
    teamId: null,
    origin: 'released',
    releasedFrom: teamId,
    releasedSeason: seasonNumber,
  }));
  recordNewsInternal(league, {
    type: 'staff_move',
    teamId,
    text: `${identity.abbr || teamId} dismiss head coach ${coach.name}`,
    detail: reason || 'Organizational pivot',
    seasonNumber,
  });
  const candidate = takeCoachCandidate(league, gm);
  const assigned = updateCoachOverall({ ...candidate, teamId, identity });
  assigned.resume = { ...(candidate.resume || {}), lastTeam: teamId };
  assigned.tendencies ||= { aggression: 0, passBias: 0, runBias: 0 };
  league.teamCoaches[teamId] = assigned;
  recordNewsInternal(league, {
    type: 'staff_move',
    teamId,
    text: `${identity.abbr || teamId} hire ${assigned.name} as head coach`,
    detail: 'GM announces fresh direction',
    seasonNumber,
  });
  return true;
}

function replaceScout(league, teamId, scout, gm, seasonNumber, { reason } = {}) {
  if (!league || !teamId) return false;
  ensureStaffFreeAgents(league);
  const identity = getTeamIdentity(teamId) || { id: teamId, abbr: teamId, displayName: teamId };
  if (scout) {
    league.staffFreeAgents.scouts.push(updateScoutOverall({
      ...scout,
      teamId: null,
      origin: 'released',
      releasedFrom: teamId,
      releasedSeason: seasonNumber,
    }));
    recordNewsInternal(league, {
      type: 'staff_move',
      teamId,
      text: `${identity.abbr || teamId} move on from scout ${scout.name}`,
      detail: reason || 'Talent department shake-up',
      seasonNumber,
    });
  }
  const candidate = takeScoutCandidate(league, gm);
  const assigned = updateScoutOverall({ ...candidate, teamId });
  league.teamScouts[teamId] = assigned;
  recordNewsInternal(league, {
    type: 'staff_move',
    teamId,
    text: `${identity.abbr || teamId} hire ${assigned.name} as lead scout`,
    detail: 'New evaluation voice joins the room',
    seasonNumber,
  });
  return true;
}

function evaluateStaffChanges(league, season) {
  if (!league || !season) return;
  ensureTeamCoaches(league);
  ensureTeamGms(league);
  ensureScouts(league);
  ensureStaffFreeAgents(league);
  TEAM_IDS.forEach((teamId) => {
    const gm = league.teamGms?.[teamId] || null;
    if (!gm) return;
    const teamEntry = season.teams?.[teamId] || null;
    const record = teamEntry?.record || { wins: 0, losses: 0, ties: 0 };
    const games = (record.wins || 0) + (record.losses || 0) + (record.ties || 0);
    const winPct = games > 0 ? ((record.wins || 0) + (record.ties || 0) * 0.5) / games : 0.5;
    const history = Array.isArray(league.teamSeasonHistory?.[teamId]) ? league.teamSeasonHistory[teamId] : [];
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
    const prevRecord = prevEntry?.record || null;
    const prevGames = prevRecord ? (prevRecord.wins || 0) + (prevRecord.losses || 0) + (prevRecord.ties || 0) : 0;
    const prevWinPct = prevGames > 0
      ? ((prevRecord.wins || 0) + (prevRecord.ties || 0) * 0.5) / prevGames
      : winPct;
    const trend = winPct - prevWinPct;
    const pointDiff = (teamEntry?.pointsFor ?? 0) - (teamEntry?.pointsAgainst ?? 0);
    let frustration = (gm.frustration || 0) * 0.45;
    if (winPct < 0.5) frustration += (0.55 - winPct) * (0.9 + (gm.discipline || 0.5) * 0.4);
    if (trend < -0.06) frustration += Math.abs(trend) * (0.9 + (gm.vision || 0.5) * 0.4);
    if (pointDiff < -40) frustration += 0.25;
    else if (pointDiff < -20) frustration += 0.12;
    frustration -= (gm.patience || 0.5) * 0.35;
    frustration = clamp(frustration, 0, 4);
    gm.frustration = frustration;
    gm.tenure = (gm.tenure || 0) + 1;

    const coach = league.teamCoaches?.[teamId] || null;
    const scout = league.teamScouts?.[teamId] || null;

    const coachStruggle = winPct < 0.45 || trend < -0.08;
    const fireCoachChance = coachStruggle
      ? clamp(frustration * 0.35 + (gm.discipline || 0.5) * 0.25, 0, 0.75)
      : clamp((frustration - 1.25) * 0.22, 0, 0.45);
    if (coach && Math.random() < fireCoachChance) {
      replaceCoach(league, teamId, coach, gm, season.seasonNumber || league.seasonNumber || 1, {
        reason: coachStruggle ? 'Performance evaluation' : 'Strategic refresh',
      });
    }

    const scoutStruggle = (scout?.evaluation ?? 0.55) < 0.58 && winPct < 0.5;
    const fireScoutChance = scoutStruggle
      ? clamp(frustration * 0.25 + (gm.discipline || 0.4) * 0.18, 0, 0.45)
      : clamp((frustration - 1.6) * 0.15, 0, 0.28);
    if (Math.random() < fireScoutChance) {
      replaceScout(league, teamId, scout, gm, season.seasonNumber || league.seasonNumber || 1, {
        reason: scoutStruggle ? 'Need sharper evaluations' : 'Shuffling scouting approach',
      });
    }
  });
}

function ensureInjuryTracking(league) {
  if (!league.injuryLog) league.injuryLog = {};
  if (!league.injuredReserve) league.injuredReserve = {};
  if (!league.injuryCounts) league.injuryCounts = {};
}

function recordMoodFromSeasonEntry(entry) {
  if (!entry) return 0;
  const record = entry.record || {};
  const wins = record.wins || 0;
  const losses = record.losses || 0;
  const ties = record.ties || 0;
  const total = wins + losses + ties;
  if (!total) return 0;
  return clamp((wins - losses) / Math.max(1, total), -1, 1) * 0.65;
}

function refreshTeamMood(league, teamId) {
  if (!league || !teamId) return;
  ensureTeamRosterShell(league);
  const roster = league.teamRosters?.[teamId];
  if (!roster) return;
  const seasonEntry = league.seasonSnapshot?.teams?.[teamId]
    || league.season?.teams?.[teamId]
    || null;
  const recordMood = recordMoodFromSeasonEntry(seasonEntry);
  const coach = getTeamCoach(league, teamId);
  const mood = computeTeamMood(roster, coach, { recordMood });
  league.teamMoods ||= {};
  league.teamMoods[teamId] = { ...mood, updatedAt: Date.now() };
}

function findPlayerRole(roster, playerId) {
  if (!roster || !playerId) return null;
  let found = null;
  Object.entries(roster.offense || {}).forEach(([role, player]) => {
    if (player && player.id === playerId) found = role;
  });
  Object.entries(roster.defense || {}).forEach(([role, player]) => {
    if (player && player.id === playerId) found = role;
  });
  if (roster.special?.K && roster.special.K.id === playerId) found = 'K';
  return found;
}

export function initializeLeaguePersonnel(league) {
  if (!league) return;
  ensureTeamRosterShell(league);
  initialiseRosterMetrics(league);
  ensureTeamCoaches(league);
  ensureTeamGms(league);
  ensureScouts(league);
  ensureStaffFreeAgents(league);
  ensureNewsFeed(league);
  ensureInjuryTracking(league);
  if (!Array.isArray(league.freeAgents)) league.freeAgents = [];
  league.teamMoods ||= {};
  Object.keys(league.teamRosters || {}).forEach((teamId) => {
    refreshTeamMood(league, teamId);
  });
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
  const potential = (player.ceiling ?? player.potential ?? current / 99) * 100;
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
    overall: clampRating(player.overall ?? player.rating ?? 0),
    height: player.height ?? player.body?.height ?? null,
    weight: player.weight ?? player.body?.weight ?? null,
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
  const released = { ...player, role, releasedReason: reason || 'released', temperament: cloneTemperament(player.temperament) };
  decoratePlayerMetrics(released, role);
  ensurePlayerTemperament(released);
  league.freeAgents.push(released);
}

function assignPlayerToRoster(league, teamId, role, player) {
  if (!league || !teamId || !player) return;
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  player.role = role;
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
  const coach = getTeamCoach(league, teamId);
  const teamMood = league.teamMoods?.[teamId] || null;
  let best = null;
  candidates.forEach(({ player, index }) => {
    const assessment = scoutEvaluationForPlayer(league, teamId, role, player, strategy);
    const temperamentBonus = temperamentScoutAdjustment(player, { coach, teamMood });
    const score = assessment.evaluation + temperamentBonus;
    if (!best || score > best.score) {
      best = { ...assessment, index, player, score };
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
  refreshTeamMood(league, teamId);
  return assigned;
}

function trackInjury(league, playerId, info) {
  if (!league || !playerId) return;
  ensureInjuryTracking(league);
  league.injuryLog[playerId] = { ...(league.injuryLog[playerId] || {}), ...info };
}

export function assignReplacementForAbsence(league, irEntry, { reason, mode } = {}) {
  if (!league || !irEntry?.player || !irEntry.teamId || !irEntry.role) return null;
  const replacement = signBestFreeAgentForRole(league, irEntry.teamId, irEntry.role, { reason, mode });
  if (replacement && league.injuredReserve?.[irEntry.player.id]) {
    league.injuredReserve[irEntry.player.id].replacementId = replacement.id;
    league.injuredReserve[irEntry.player.id].replacementGames ||= 0;
    league.injuredReserve[irEntry.player.id].replacementLastGameId ||= null;
  }
  return replacement;
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
  status = 'injury',
  headline = null,
  detail = null,
  countTowardsLimit = true,
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
  if (removed) adjustPlayerMood(removed, -0.18);
  const irEntry = {
    player: decoratePlayerMetrics({ ...removed, role }, role),
    teamId,
    role,
    severity,
    gamesRemaining: gamesMissed,
    description,
    degrade,
    replacementGames: 0,
    replacementLastGameId: null,
    status,
  };
  league.injuredReserve[player.id] = irEntry;
  trackInjury(league, player.id, irEntry);
  const season = seasonNumber || league.seasonNumber || 1;
  if (countTowardsLimit !== false) {
    league.injuryCounts[season] ||= {};
    league.injuryCounts[season][teamId] = (league.injuryCounts[season][teamId] || 0) + 1;
  }
  if (degrade && removed?.ratings) {
    Object.entries(degrade).forEach(([attr, delta]) => {
      removed.ratings[attr] = clamp((removed.ratings[attr] || 0) + delta, ATTR_RANGES[attr]?.[0] || 0, ATTR_RANGES[attr]?.[1] || 10);
    });
    decoratePlayerMetrics(removed, role);
    irEntry.player = removed;
  }
  const fullName = `${removed?.firstName || player.firstName || 'Player'}${removed?.lastName || player.lastName ? ` ${removed?.lastName || player.lastName}` : ''}`.trim();
  const newsText = headline
    ? `${fullName} (${role}) ${headline}`
    : status === 'suspension'
      ? `${fullName} (${role}) suspended for ${description}`
      : `${fullName} (${role}) suffers ${description}`;
  const defaultDetail = gamesMissed > 0
    ? status === 'suspension'
      ? `Suspended ${gamesMissed} ${gamesMissed === 1 ? 'game' : 'games'}`
      : `Out ${gamesMissed} ${gamesMissed === 1 ? 'game' : 'games'}`
    : status === 'suspension'
      ? 'Suspended indefinitely'
      : 'Day-to-day';
  recordNewsInternal(league, {
    type: status === 'suspension' ? 'suspension' : 'injury',
    teamId,
    text: newsText,
    detail: detail || defaultDetail,
    severity,
    status,
    seasonNumber: season,
  });
  refreshTeamMood(league, teamId);
  return irEntry;
}

export function registerPlayerSuspension(league, payload) {
  if (!payload) return null;
  return registerPlayerInjury(league, {
    ...payload,
    status: 'suspension',
    countTowardsLimit: false,
  });
}

function reinstatePlayer(league, irEntry) {
  if (!league || !irEntry?.player) return;
  const teamId = irEntry.teamId;
  const role = irEntry.role;
  const rosters = ensureTeamRosterShell(league);
  const roster = rosters[teamId] || null;
  const side = roleSide(role);
  if (!roster) return;
  const returning = decoratePlayerMetrics({ ...irEntry.player, role }, role);
  ensurePlayerTemperament(returning);
  const occupant = side === 'offense'
    ? roster.offense?.[role] || null
    : side === 'defense'
      ? roster.defense?.[role] || null
      : roster.special?.K || null;
  const replacementId = irEntry.replacementId
    ?? league.injuredReserve?.[returning.id]?.replacementId
    ?? null;
  const replacementGames = irEntry.replacementGames
    ?? league.injuredReserve?.[returning.id]?.replacementGames
    ?? 0;
  if (!occupant || occupant.id === returning.id) {
    assignPlayerToRoster(league, teamId, role, returning);
    recordNewsInternal(league, {
      type: 'return',
      teamId,
      text: `${returning.firstName} ${returning.lastName} (${role}) returns from injury`,
      detail: 'Activated from injured list',
      seasonNumber: league.seasonNumber || null,
    });
    delete league.injuredReserve[returning.id];
    adjustPlayerMood(returning, 0.12);
    refreshTeamMood(league, teamId);
    return;
  }

  const occupantId = occupant?.id || null;
  const coach = getTeamCoach(league, teamId);
  const teamMood = league.teamMoods?.[teamId] || null;
  const strategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  const groupRoles = roleGroupFor(role);
  const collectPlayer = (r, roleKey) => {
    if (!r) return null;
    const player = side === 'offense'
      ? roster.offense?.[roleKey] || null
      : side === 'defense'
        ? roster.defense?.[roleKey] || null
        : roster.special?.K || null;
    if (!player) return null;
    ensurePlayerTemperament(player);
    const base = evaluatePlayerTrueValue(player, strategy);
    const temperamentBonus = temperamentScoutAdjustment(player, { coach, teamMood }) * 0.2;
    const moodBonus = (player.temperament?.mood || 0) * 6;
    return {
      role: roleKey,
      player,
      evaluation: base + temperamentBonus + moodBonus,
      replacement: player.id === replacementId || (occupantId && player.id === occupantId && player.id !== returning.id),
    };
  };

  const candidates = [];
  groupRoles.forEach((groupRole) => {
    const entry = collectPlayer(roster, groupRole);
    if (entry) candidates.push(entry);
  });
  const returningEval = evaluatePlayerTrueValue(returning, strategy)
    + temperamentScoutAdjustment(returning, { coach, teamMood }) * 0.2
    + (returning.temperament?.mood || 0) * 6;
  candidates.push({ role, player: returning, evaluation: returningEval, returning: true });

  if (candidates.length <= 1) {
    assignPlayerToRoster(league, teamId, role, returning);
    recordNewsInternal(league, {
      type: 'return',
      teamId,
      text: `${returning.firstName} ${returning.lastName} (${role}) returns from injury`,
      detail: 'Activated from injured list',
      seasonNumber: league.seasonNumber || null,
    });
    delete league.injuredReserve[returning.id];
    adjustPlayerMood(returning, 0.12);
    refreshTeamMood(league, teamId);
    return;
  }

  let cutCandidate = null;
  candidates.forEach((entry) => {
    if (!cutCandidate || entry.evaluation < cutCandidate.evaluation - 0.01) {
      cutCandidate = entry;
    } else if (cutCandidate && Math.abs(entry.evaluation - cutCandidate.evaluation) <= 0.01) {
      if (entry.replacement && !cutCandidate.replacement) {
        cutCandidate = entry;
      }
    }
  });

  const replacementCandidates = candidates.filter((entry) => entry.replacement && !entry.returning);
  const primaryReplacement = replacementCandidates.reduce((best, entry) => {
    if (!best || entry.evaluation > best.evaluation) return entry;
    return best;
  }, null);
  let allowReplacementRetention = false;
  if (cutCandidate?.returning && primaryReplacement?.player?.origin === 'free-agent') {
    const evaluationGap = primaryReplacement.evaluation - cutCandidate.evaluation;
    if (replacementGames >= 1 && evaluationGap > 0.25) {
      const retentionChance = evaluationGap > 0.45 ? 0.5 : 0.2;
      if (Math.random() < retentionChance) {
        allowReplacementRetention = true;
      }
    }
  }

  if (cutCandidate?.returning && !allowReplacementRetention) {
    let fallback = null;
    candidates.forEach((entry) => {
      if (entry.returning) return;
      if (!fallback || entry.evaluation < fallback.evaluation - 0.01) {
        fallback = entry;
      } else if (fallback && Math.abs(entry.evaluation - fallback.evaluation) <= 0.01) {
        if (entry.replacement && !fallback.replacement) {
          fallback = entry;
        }
      }
    });
    if (fallback) {
      cutCandidate = fallback;
    } else if (primaryReplacement) {
      cutCandidate = primaryReplacement;
    }
  }

  let released = null;
  let movedReplacement = null;
  if (cutCandidate?.returning) {
    pushPlayerToFreeAgency(league, returning, role, 'recovered but replaced');
    recordNewsInternal(league, {
      type: 'release',
      teamId,
      text: `${returning.firstName} ${returning.lastName} (${role}) released after recovery`,
      detail: 'Replacement retained',
      seasonNumber: league.seasonNumber || null,
    });
    released = returning;
  } else if (cutCandidate?.replacement) {
    const removed = removePlayerFromRoster(league, teamId, role);
    if (removed) {
      pushPlayerToFreeAgency(league, removed, role, 'injury replacement released');
      adjustPlayerMood(removed, -0.22);
    }
    assignPlayerToRoster(league, teamId, role, returning);
    adjustPlayerMood(returning, 0.14);
  } else if (cutCandidate) {
    const removed = removePlayerFromRoster(league, teamId, cutCandidate.role);
    if (removed) {
      pushPlayerToFreeAgency(league, removed, cutCandidate.role, 'roster shuffle (injury)');
      adjustPlayerMood(removed, -0.2);
    }
    const replacementPlayer = (occupant && occupant.id !== returning.id) ? occupant : null;
    if (replacementPlayer && cutCandidate.role !== role) {
      removePlayerFromRoster(league, teamId, role);
      movedReplacement = { ...replacementPlayer, role: cutCandidate.role };
    }
    assignPlayerToRoster(league, teamId, role, returning);
    if (movedReplacement) {
      assignPlayerToRoster(league, teamId, cutCandidate.role, movedReplacement);
    }
    adjustPlayerMood(returning, 0.12);
  }

  if (!cutCandidate?.returning) {
    const status = irEntry.status === 'suspension' ? 'suspension' : 'injury';
    const detail = cutCandidate?.replacement ? 'Replacement waived' : cutCandidate ? `Roster move: ${cutCandidate.role}` : status === 'suspension' ? 'Reinstated to active roster' : 'Activated from injured list';
    const verb = status === 'suspension' ? 'returns from suspension' : 'returns from injury';
    recordNewsInternal(league, {
      type: 'return',
      teamId,
      text: `${returning.firstName} ${returning.lastName} (${role}) ${verb}`,
      detail,
      seasonNumber: league.seasonNumber || null,
    });
  }

  if (released) {
    delete league.injuredReserve[released.id];
  } else {
    delete league.injuredReserve[returning.id];
  }
  refreshTeamMood(league, teamId);
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

export function applyPostGameMoodAdjustments(league, game, scores, playerStats = {}, slotToTeam = {}) {
  if (!league || !game) return;
  ensureTeamRosterShell(league);
  const redTeam = slotToTeam[TEAM_RED] || game.homeTeam;
  const blkTeam = slotToTeam[TEAM_BLK] || game.awayTeam;
  const redScore = scores?.[TEAM_RED] ?? 0;
  const blkScore = scores?.[TEAM_BLK] ?? 0;
  const scoreByTeam = {
    [redTeam]: redScore,
    [blkTeam]: blkScore,
  };

  const homeId = game.homeTeam;
  const awayId = game.awayTeam;
  const homeScore = scoreByTeam[homeId] ?? 0;
  const awayScore = scoreByTeam[awayId] ?? 0;
  const tie = homeScore === awayScore;
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;

  const processTeam = (teamId, outcome) => {
    if (!teamId) return;
    const roster = league.teamRosters?.[teamId];
    if (!roster) return;
    const coach = getTeamCoach(league, teamId);
    const temperamentResult = updateTeamTemperament(roster, playerStats, {
      won: outcome === 'win',
      tie,
      coach,
    });
    refreshTeamMood(league, teamId);
    if (league.injuredReserve) {
      Object.values(league.injuredReserve).forEach((entry) => {
        if (!entry || entry.teamId !== teamId || !entry.replacementId) return;
        const side = roleSide(entry.role);
        const occupant = side === 'offense'
          ? roster.offense?.[entry.role] || null
          : side === 'defense'
            ? roster.defense?.[entry.role] || null
            : roster.special?.K || null;
        if (occupant?.id === entry.replacementId) {
          const marker = game?.id ?? `${game?.homeTeam || 'unknown'}-${game?.awayTeam || 'unknown'}-${game?.index ?? '0'}`;
          if (entry.replacementLastGameId !== marker) {
            entry.replacementGames = (entry.replacementGames || 0) + 1;
            entry.replacementLastGameId = marker;
          }
        }
      });
    }
    (temperamentResult.tradeCandidates || []).forEach((candidate) => {
      const role = candidate.role || findPlayerRole(roster, candidate.id);
      if (!role) return;
      const traded = attemptTradeForUnhappyPlayer(league, teamId, role, candidate);
      if (!traded) {
        recordNewsInternal(league, {
          type: 'rumor',
          teamId,
          text: `${candidate.firstName || 'Player'} ${candidate.lastName || ''} (${role}) requests a trade but remains with the team`,
          detail: 'Market check cooled',
          seasonNumber: league.seasonNumber || null,
        });
        adjustPlayerMood(candidate, -0.08);
      }
    });
    refreshTeamMood(league, teamId);
  };

  processTeam(homeId, homeWon ? 'win' : tie ? 'tie' : 'loss');
  processTeam(awayId, awayWon ? 'win' : tie ? 'tie' : 'loss');
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

function attemptTradeForUnhappyPlayer(league, teamId, role, player) {
  if (!league || !teamId || !role || !player) return false;
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  const teamStrategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  let best = null;
  TEAM_IDS.forEach((otherId) => {
    if (otherId === teamId) return;
    const otherRoster = rosters[otherId];
    if (!otherRoster) return;
    const otherPlayer = side === 'offense'
      ? otherRoster.offense?.[role] || null
      : side === 'defense'
        ? otherRoster.defense?.[role] || null
        : otherRoster.special?.K || null;
    if (!otherPlayer || otherPlayer.id === player.id) return;
    const otherStrategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[otherId]);
    const gainForOther = tradeValue(league, otherId, role, player, otherStrategy)
      - tradeValue(league, otherId, role, otherPlayer, otherStrategy);
    if (gainForOther < -2.5) return;
    const gainForTeam = tradeValue(league, teamId, role, otherPlayer, teamStrategy)
      - tradeValue(league, teamId, role, player, teamStrategy);
    const interest = gainForOther + gainForTeam * 0.6;
    if (interest <= -6) return;
    if (!best || interest > best.interest) {
      best = { otherId, otherPlayer, gainForOther, gainForTeam, interest };
    }
  });
  if (!best || best.interest < 0.5) return false;
  const outgoing = removePlayerFromRoster(league, teamId, role) || player;
  const incoming = removePlayerFromRoster(league, best.otherId, role) || best.otherPlayer;
  const incomingClone = { ...incoming, origin: 'trade-request' };
  const outgoingClone = { ...outgoing, origin: 'trade-request' };
  resetTemperamentToNeutral(incomingClone);
  resetTemperamentToNeutral(outgoingClone);
  assignPlayerToRoster(league, teamId, role, incomingClone);
  assignPlayerToRoster(league, best.otherId, role, outgoingClone);
  recordNewsInternal(league, {
    type: 'trade',
    teamId,
    partnerTeam: best.otherId,
    text: `${getTeamIdentity(teamId)?.abbr || teamId} trade ${outgoing.firstName} ${outgoing.lastName} (${role}) to ${getTeamIdentity(best.otherId)?.abbr || best.otherId}`,
    seasonNumber: league.seasonNumber || null,
  });
  recordNewsInternal(league, {
    type: 'trade',
    teamId: best.otherId,
    partnerTeam: teamId,
    text: `${getTeamIdentity(best.otherId)?.abbr || best.otherId} welcome ${outgoing.firstName} ${outgoing.lastName} (${role})`,
    seasonNumber: league.seasonNumber || null,
  });
  refreshTeamMood(league, teamId);
  refreshTeamMood(league, best.otherId);
  return true;
}

function simulateRosterCuts(league, teamId, mode) {
  const roster = ensureTeamRosterShell(league)[teamId];
  const candidates = [];
  ROLES_OFF.forEach((role) => {
    const player = roster.offense[role];
    if (!player) return;
    const temperament = ensurePlayerTemperament(player);
    if ((player.overall < 52 && Math.random() < 0.25) || (temperament.mood <= -0.55 && Math.random() < 0.6)) {
      candidates.push({ role, player });
    }
  });
  ROLES_DEF.forEach((role) => {
    const player = roster.defense[role];
    if (!player) return;
    const temperament = ensurePlayerTemperament(player);
    if ((player.overall < 52 && Math.random() < 0.25) || (temperament.mood <= -0.55 && Math.random() < 0.6)) {
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
      adjustPlayerMood(removed, -0.15);
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
  refreshTeamMood(league, teamId);
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
  evaluateStaffChanges(league, season);
  TEAM_IDS.forEach((teamId) => refreshTeamMood(league, teamId));
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
