import { ROLES_OFF, ROLES_DEF, TEAM_RED, TEAM_BLK } from './constants';
import { TEAM_IDS, getTeamData, getTeamIdentity } from './data/teamLibrary';
import { clamp, choice, rand } from './helpers';
import { buildCoachForTeam } from './coaches';
import {
  ensurePlayerTemperament,
  ensurePlayerLoyalty,
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

const DEFAULT_SALARY_CAP = 100_000_000;
const MIN_CONTRACT_SALARY = 750_000;
const BARGAIN_MIN_SALARY = 350_000;
const PUNISHMENT_PLAYER_SALARY = 250_000;
const PUNISHMENT_PLAYER_OVERALL = 15;
const MAX_CONTRACT_LENGTH = 6;
const CONTRACT_ROUNDING = 50_000;
const LONG_TERM_DISCOUNT = 0.06;
const SHORT_TERM_PREMIUM = 0.08;

function ensureSalaryStructures(league) {
  if (!league) return;
  if (!Number.isFinite(league.salaryCap)) {
    league.salaryCap = DEFAULT_SALARY_CAP;
  }
  if (!league.teamPayroll) {
    league.teamPayroll = {};
  }
  if (!league.capPenalties) {
    league.capPenalties = {};
  }
  if (league.capPenaltiesVersion == null) {
    league.capPenaltiesVersion = 0;
  }
}

function bumpTeamRostersVersion(league) {
  if (!league) return;
  league.teamRostersVersion = (league.teamRostersVersion || 0) + 1;
}

function bumpCapPenaltiesVersion(league) {
  if (!league) return;
  league.capPenaltiesVersion = (league.capPenaltiesVersion || 0) + 1;
}

function resolvePlayerAge(league, player) {
  if (!player) return null;
  if (Number.isFinite(player.age)) return player.age;
  if (player.id && Number.isFinite(league?.playerAges?.[player.id])) {
    return league.playerAges[player.id];
  }
  return null;
}

function determinePreferredContractLength(age, player = {}) {
  const resolvedAge = Number.isFinite(age) ? age : (Number.isFinite(player.age) ? player.age : null);
  if (!Number.isFinite(resolvedAge)) {
    return 3;
  }
  if (resolvedAge <= 23) return 5;
  if (resolvedAge <= 26) return 4;
  if (resolvedAge <= 29) return 4;
  if (resolvedAge <= 31) return 3;
  if (resolvedAge <= 34) return 2;
  return 1;
}

function adjustSalaryForTerm(baseSalary, preferredYears, offeredYears) {
  if (!Number.isFinite(baseSalary)) return baseSalary;
  const delta = offeredYears - preferredYears;
  if (delta > 0) {
    return baseSalary * Math.pow(1 - LONG_TERM_DISCOUNT, delta);
  }
  if (delta < 0) {
    return baseSalary * Math.pow(1 + SHORT_TERM_PREMIUM, Math.abs(delta));
  }
  return baseSalary;
}

function finalizeContract({
  teamId,
  salary,
  years,
  startSeason,
  basis = 'free-agent',
  loyaltyAdjustment = 0,
  demandSnapshot = null,
  minimumSalary = MIN_CONTRACT_SALARY,
}) {
  const normalizedYears = Math.max(1, Math.min(MAX_CONTRACT_LENGTH, Math.round(years || 1)));
  const resolvedMinimum = Number.isFinite(minimumSalary) ? Math.max(0, minimumSalary) : MIN_CONTRACT_SALARY;
  const roundedSalary = Math.max(
    resolvedMinimum,
    Math.round((salary || resolvedMinimum) / CONTRACT_ROUNDING) * CONTRACT_ROUNDING,
  );
  return {
    teamId,
    salary: roundedSalary,
    years: normalizedYears,
    yearsRemaining: normalizedYears,
    startSeason: Number.isFinite(startSeason) ? startSeason : null,
    totalValue: roundedSalary * normalizedYears,
    basis,
    loyaltyAdjustment,
    demand: demandSnapshot,
    capHit: roundedSalary,
  };
}

function summarizeContractForNews(contract) {
  if (!contract) return null;
  const summary = {
    salary: Number.isFinite(contract.salary) ? contract.salary : null,
    years: Number.isFinite(contract.years) ? contract.years : null,
    totalValue: Number.isFinite(contract.totalValue) ? contract.totalValue : null,
    temporary: !!contract.temporary,
    temporaryGames: Number.isFinite(contract.temporaryGames) ? contract.temporaryGames : null,
  };
  if (contract.basis) summary.basis = contract.basis;
  if (contract.teamId) summary.teamId = contract.teamId;
  if (contract.startSeason != null) summary.startSeason = contract.startSeason;
  if (Number.isFinite(contract.capHit)) summary.capHit = contract.capHit;
  if (contract.temporaryForPlayerId) summary.temporaryForPlayerId = contract.temporaryForPlayerId;
  return summary;
}

function formatCurrency(amount) {
  if (!Number.isFinite(amount)) return '$0';
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (absolute >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return `$${Math.round(amount)}`;
}

function applyContractToPlayer(player, contract) {
  if (!player) return;
  if (!contract) {
    player.contract = null;
    delete player.salary;
    delete player.capHit;
    delete player.contractYears;
    delete player.contractYearsRemaining;
    return;
  }
  player.contract = { ...contract };
  player.salary = contract.salary;
  const capHit = Number.isFinite(contract.capHit)
    ? contract.capHit
    : (contract.temporary ? 0 : contract.salary);
  player.capHit = capHit;
  player.contract.capHit = capHit;
  player.contractYears = contract.years;
  player.contractYearsRemaining = contract.yearsRemaining;
}

function clearPlayerContract(player) {
  if (!player) return;
  applyContractToPlayer(player, null);
}

function ensureCapPenaltyLedger(league, teamId) {
  ensureSalaryStructures(league);
  if (!teamId) return [];
  const existing = league.capPenalties[teamId] || [];
  const filtered = existing
    .filter((entry) => entry && entry.seasonsRemaining > 0 && entry.amount > 0);
  if (filtered.length !== existing.length) {
    league.capPenalties[teamId] = filtered;
    bumpCapPenaltiesVersion(league);
  } else {
    league.capPenalties[teamId] = filtered;
  }
  return league.capPenalties[teamId];
}

function sumActiveCapPenalties(league, teamId) {
  if (!league?.capPenalties || !teamId) return 0;
  const ledger = ensureCapPenaltyLedger(league, teamId);
  return ledger.reduce((total, entry) => total + (entry.amount || 0), 0);
}

function applyReleaseContractOutcome(league, player, {
  teamId,
  reason,
  careerEnding = false,
  skipCapPenalty = false,
} = {}) {
  if (!league || !player?.contract) return;
  const contract = player.contract;
  if (contract.temporary) return;
  if (careerEnding || skipCapPenalty) return;
  const releaseTeamId = teamId || contract.teamId || player.currentTeamId || player.originalTeamId || null;
  if (!releaseTeamId) return;
  const remainingYears = Number.isFinite(contract.yearsRemaining)
    ? contract.yearsRemaining
    : contract.years;
  if (!Number.isFinite(remainingYears) || remainingYears <= 0) return;
  const salary = Number.isFinite(contract.salary) ? contract.salary : 0;
  if (salary <= 0) return;
  const penaltyPerSeason = Math.round(salary * 0.1);
  if (penaltyPerSeason <= 0) return;
  const ledger = ensureCapPenaltyLedger(league, releaseTeamId);
  ledger.push({
    amount: penaltyPerSeason,
    seasonsRemaining: remainingYears,
    reason: reason || 'contract release',
    playerId: player.id || null,
    createdAt: Date.now(),
  });
  bumpCapPenaltiesVersion(league);
  recalculateTeamPayroll(league, releaseTeamId);
}

function convertTemporaryContractToStandard(league, teamId, role, player, {
  reason = 'injury replacement retained',
} = {}) {
  if (!league || !teamId || !player) return null;
  const strategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  const incumbentValue = evaluatePlayerTrueValue(player, strategy);
  let negotiation = negotiateContractForTeam(league, teamId, player, {
    teamNeedScore: Math.max(1, incumbentValue ? 0.8 : 1),
    seasonNumber: league.seasonNumber || 1,
    basis: reason,
    replacingSalary: 0,
  });
  if (!negotiation) {
    const fallbackMinimum = minimumSalaryForPlayer(player);
    negotiation = {
      contract: finalizeContract({
        teamId,
        salary: Math.max(fallbackMinimum, player.contract?.salary || fallbackMinimum),
        years: 1,
        startSeason: league.seasonNumber || 1,
        basis: reason,
        minimumSalary: fallbackMinimum,
      }),
      preference: 1,
    };
  }
  const contract = { ...negotiation.contract, temporary: false, capHit: negotiation.contract.salary };
  applyContractToPlayer(player, contract);
  assignPlayerToRoster(league, teamId, role, player);
  recalculateTeamPayroll(league, teamId);
  return contract;
}

function recalculateTeamPayroll(league, teamId) {
  ensureSalaryStructures(league);
  if (!teamId) return 0;
  const roster = league?.teamRosters?.[teamId];
  let total = 0;
  const add = (player) => {
    if (!player?.contract) return;
    const remaining = player.contract.yearsRemaining ?? player.contract.years ?? 0;
    if (remaining <= 0) return;
    if (player.contract.temporary) return;
    const hit = Number.isFinite(player.contract.capHit)
      ? player.contract.capHit
      : Number.isFinite(player.contract.salary)
        ? player.contract.salary
        : 0;
    if (hit > 0) total += hit;
  };
  if (roster) {
    Object.values(roster.offense || {}).forEach(add);
    Object.values(roster.defense || {}).forEach(add);
    if (roster.special?.K) add(roster.special.K);
  }
  const penalty = sumActiveCapPenalties(league, teamId);
  league.teamPayroll[teamId] = Math.round(total + penalty);
  return league.teamPayroll[teamId];
}

function getCapSpace(league, teamId) {
  ensureSalaryStructures(league);
  if (!teamId) return 0;
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const payroll = recalculateTeamPayroll(league, teamId);
  return Math.max(0, cap - payroll);
}

function computeTeamNeedScore(incumbentValue, candidateValue) {
  if (!Number.isFinite(candidateValue)) return 0;
  if (!Number.isFinite(incumbentValue)) return 1;
  const delta = candidateValue - incumbentValue;
  if (delta <= 0) return 0;
  return clamp(delta / 10, 0.05, 1.1);
}

const ATTRIBUTE_SPREAD_POWER = 0.82;

function amplifyNormalized(value, power = ATTRIBUTE_SPREAD_POWER) {
  if (value == null || Number.isNaN(value)) return 0.5;
  const normalized = clamp(value, 0, 1);
  const delta = normalized - 0.5;
  const distance = Math.abs(delta);
  if (distance <= 1e-6) return 0.5;
  const ratio = clamp(distance / 0.5, 0, 1);
  const amplified = Math.pow(ratio, power) * 0.5;
  return clamp(0.5 + Math.sign(delta) * amplified, 0, 1);
}

function applyAttributeSpreadValue(value, attr) {
  if (value == null || Number.isNaN(value)) return value;
  const range = ATTR_RANGES[attr];
  if (!range) return value;
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return value;
  const normalized = (value - min) / (max - min || 1);
  const amplified = amplifyNormalized(normalized);
  return clamp(min + (max - min) * amplified, min, max);
}

function applyAttributeSpreadMap(ratings = {}) {
  const entries = {};
  Object.entries(ratings).forEach(([attr, value]) => {
    entries[attr] = applyAttributeSpreadValue(value, attr);
  });
  return entries;
}

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
  return clampRating(32 + total * 63);
}

function computeScoutOverall(scout = {}) {
  const evaluation = clamp(scout.evaluation ?? 0.5, 0, 1);
  const development = clamp(scout.development ?? 0.5, 0, 1);
  const trade = clamp(scout.trade ?? 0.5, 0, 1);
  const temperament = clamp(scout.temperamentSense ?? 0.5, 0, 1);
  const aggression = clamp(1 - Math.min(1, Math.abs((scout.aggression ?? 0.5) - 0.5) * 2), 0, 1);
  const total = evaluation * 0.35 + development * 0.25 + trade * 0.2 + temperament * 0.12 + aggression * 0.08;
  return clampRating(30 + total * 65);
}

function computeGmOverall(gm = {}) {
  const evaluation = clamp(gm.evaluation ?? 0.5, 0, 1);
  const vision = clamp(gm.vision ?? 0.5, 0, 1);
  const culture = clamp(gm.culture ?? 0.5, 0, 1);
  const discipline = clamp(gm.discipline ?? 0.5, 0, 1);
  const patience = clamp(gm.patience ?? 0.5, 0, 1);
  const charisma = clamp(gm.charisma ?? 0.5, 0, 1);
  const capFocus = clamp(gm.capFocus ?? 0.5, 0, 1);
  const capStewardship = clamp(1 - clamp(gm.capTolerance ?? 0.2, 0, 0.6) / 0.6, 0, 1);
  const total = evaluation * 0.22
    + vision * 0.18
    + culture * 0.14
    + discipline * 0.15
    + patience * 0.12
    + charisma * 0.09
    + capFocus * 0.06
    + capStewardship * 0.04;
  return clampRating(35 + total * 60);
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

function isBargainPlayer(player) {
  if (!player) return false;
  return !!(player.bargainBin || player.type === 'bargain');
}

function minimumSalaryForPlayer(player) {
  if (!player) return MIN_CONTRACT_SALARY;
  if (Number.isFinite(player.minimumSalaryOverride)) {
    return Math.max(0, player.minimumSalaryOverride);
  }
  if (player.punishmentReplacement) {
    return PUNISHMENT_PLAYER_SALARY;
  }
  if (isBargainPlayer(player)) {
    return BARGAIN_MIN_SALARY;
  }
  return MIN_CONTRACT_SALARY;
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
  if (league.teamRostersVersion == null) league.teamRostersVersion = 0;
  TEAM_IDS.forEach((teamId) => {
    const existing = league.teamRosters[teamId];
    if (!existing) {
      league.teamRosters[teamId] = { offense: {}, defense: {}, special: {} };
      bumpTeamRostersVersion(league);
    } else {
      existing.offense ||= {};
      existing.defense ||= {};
      existing.special ||= {};
    }
  });
  return league.teamRosters;
}

function createFranchiseFreeAgent(teamId, role, data) {
  if (!data) return null;
  const cloned = clonePlayerData({ ...data, origin: data.origin || 'franchise' });
  cloned.originalTeamId = cloned.originalTeamId || teamId;
  cloned.currentTeamId = null;
  cloned.preferredRole = cloned.preferredRole || role;
  const decorated = decoratePlayerMetrics(cloned, role);
  decorated.role = role;
  decorated.currentTeamId = null;
  decorated.originalTeamId = decorated.originalTeamId || teamId;
  decorated.origin = decorated.origin || 'franchise';
  decorated.releasedReason = 'inaugural dispersal';
  clearPlayerContract(decorated);
  ensurePlayerTemperament(decorated);
  ensurePlayerLoyalty(decorated);
  return decorated;
}

export function disperseFranchiseRostersToFreeAgency(league) {
  if (!league) return;
  if (league.initialRosterDispersalComplete) return;
  const rosters = ensureTeamRosterShell(league);
  const teamsWithRosteredPlayers = [];
  Object.entries(rosters || {}).forEach(([teamId, roster]) => {
    if (!roster) return;
    const hasOffense = Object.keys(roster.offense || {}).length > 0;
    const hasDefense = Object.keys(roster.defense || {}).length > 0;
    const hasKicker = !!roster.special?.K;
    if (hasOffense || hasDefense || hasKicker) {
      teamsWithRosteredPlayers.push(teamId);
      const rosterEntries = gatherRosterPlayers(roster);
      rosterEntries.forEach(({ player }) => {
        if (!player?.id || !league.playerDirectory?.[player.id]) return;
        const identity = getTeamIdentity(teamId);
        league.playerDirectory[player.id] = {
          ...league.playerDirectory[player.id],
          teamId: null,
          team: null,
          teamName: null,
          teamAbbr: null,
          originTeamId: league.playerDirectory[player.id].originTeamId || teamId,
          originTeamAbbr: league.playerDirectory[player.id].originTeamAbbr || identity?.abbr || teamId,
        };
      });
    }
  });
  league.freeAgents ||= [];
  const existingIds = new Set(league.freeAgents.map((player) => player?.id).filter(Boolean));
  TEAM_IDS.forEach((teamId) => {
    const data = getTeamData(teamId) || {};
    Object.entries(data.offense || {}).forEach(([role, player]) => {
      if (!player) return;
      const candidate = createFranchiseFreeAgent(teamId, role, player);
      if (!candidate || existingIds.has(candidate.id)) return;
      league.freeAgents.push(candidate);
      existingIds.add(candidate.id);
      if (league.playerDirectory?.[candidate.id]) {
        league.playerDirectory[candidate.id] = {
          ...league.playerDirectory[candidate.id],
          teamId: null,
          team: null,
          teamName: null,
          teamAbbr: null,
          originTeamId: league.playerDirectory[candidate.id].originTeamId || teamId,
          originTeamAbbr: league.playerDirectory[candidate.id].originTeamAbbr || getTeamIdentity(teamId)?.abbr || teamId,
        };
      }
    });
    Object.entries(data.defense || {}).forEach(([role, player]) => {
      if (!player) return;
      const candidate = createFranchiseFreeAgent(teamId, role, player);
      if (!candidate || existingIds.has(candidate.id)) return;
      league.freeAgents.push(candidate);
      existingIds.add(candidate.id);
      if (league.playerDirectory?.[candidate.id]) {
        league.playerDirectory[candidate.id] = {
          ...league.playerDirectory[candidate.id],
          teamId: null,
          team: null,
          teamName: null,
          teamAbbr: null,
          originTeamId: league.playerDirectory[candidate.id].originTeamId || teamId,
          originTeamAbbr: league.playerDirectory[candidate.id].originTeamAbbr || getTeamIdentity(teamId)?.abbr || teamId,
        };
      }
    });
    if (data.specialTeams?.K) {
      const candidate = createFranchiseFreeAgent(teamId, 'K', data.specialTeams.K);
      if (candidate && !existingIds.has(candidate.id)) {
        league.freeAgents.push(candidate);
        existingIds.add(candidate.id);
        if (league.playerDirectory?.[candidate.id]) {
          league.playerDirectory[candidate.id] = {
            ...league.playerDirectory[candidate.id],
            teamId: null,
            team: null,
            teamName: null,
            teamAbbr: null,
            originTeamId: league.playerDirectory[candidate.id].originTeamId || teamId,
            originTeamAbbr: league.playerDirectory[candidate.id].originTeamAbbr || getTeamIdentity(teamId)?.abbr || teamId,
          };
        }
      }
    }
  });
  if (teamsWithRosteredPlayers.length) {
    teamsWithRosteredPlayers.forEach((teamId) => {
      rosters[teamId] = { offense: {}, defense: {}, special: {} };
      recalculateTeamPayroll(league, teamId);
    });
    bumpTeamRostersVersion(league);
  }
  league.initialRosterDispersalComplete = true;
}

export function computeOverallFromRatings(ratings = {}, role = 'QB') {
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

function computeBaseSalary(player, league = null) {
  if (!player) return MIN_CONTRACT_SALARY;
  const role = player.role || player.preferredRole || 'WR1';
  let overall = Number.isFinite(player.overall) ? player.overall : null;
  if (!Number.isFinite(overall)) {
    const ratingSource = player.ratings || player.attrs || null;
    if (ratingSource) {
      overall = computeOverallFromRatings(ratingSource, role);
    }
  }
  if (!Number.isFinite(overall)) {
    overall = 60;
  }
  const potentialRaw = player.ceiling != null
    ? player.ceiling * 100
    : player.potential != null
      ? player.potential * 100
      : overall + 8;
  const normalized = clamp(((overall * 0.7) + (potentialRaw * 0.3)) / 100, 0.3, 1.05);
  let salary = 800_000 + Math.pow(Math.max(0.32, normalized), 1.85) * 9_500_000;
  const age = resolvePlayerAge(league, player);
  if (Number.isFinite(age)) {
    if (age <= 23) salary *= 1.18;
    else if (age <= 26) salary *= 1.1;
    else if (age >= 31 && age <= 33) salary *= 0.94;
    else if (age >= 34) salary *= 0.88;
  }
  if (role === 'K') {
    salary *= 0.55;
  }
  const minimum = minimumSalaryForPlayer(player);
  return Math.max(minimum, salary);
}

function computeContractValueBonus(player, league = null) {
  if (!player) return 0;
  const contract = player.contract || null;
  if (!contract || contract.temporary) return 0;
  const salary = Number.isFinite(contract.salary)
    ? contract.salary
    : Number.isFinite(contract.capHit)
      ? contract.capHit
      : Number.isFinite(player.salary)
        ? player.salary
        : null;
  if (!Number.isFinite(salary) || salary <= 0) return 0;
  const expected = computeBaseSalary(player, league);
  if (!Number.isFinite(expected) || expected <= 0) return 0;
  const deltaRatio = clamp((expected - salary) / expected, -0.7, 0.8);
  return deltaRatio * 18;
}

function decoratePlayerMetrics(player, role) {
  if (!player) return player;
  const updated = player;
  if (!updated.__attributeSpreadApplied) {
    const sourceRatings = updated.ratings ? { ...updated.ratings } : null;
    const sourceAttrs = updated.attrs ? { ...updated.attrs } : null;
    const sourceBase = updated.baseAttrs ? { ...updated.baseAttrs } : null;
    if (sourceRatings) {
      updated.ratings = applyAttributeSpreadMap(sourceRatings);
    }
    if (sourceAttrs) {
      updated.attrs = applyAttributeSpreadMap(sourceAttrs);
    } else if (sourceRatings) {
      updated.attrs = { ...updated.ratings };
    }
    if (sourceBase) {
      updated.baseAttrs = applyAttributeSpreadMap(sourceBase);
    }
    if (!updated.baseAttrs && updated.attrs) {
      updated.baseAttrs = { ...updated.attrs };
    }
    updated.__attributeSpreadApplied = true;
  }
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
    const ratingSource = updated.ratings || updated.attrs || {};
    updated.overall = computeOverallFromRatings(ratingSource, role);
    if (!updated.attrs && updated.ratings) {
      updated.attrs = { ...updated.ratings };
    }
    if (!updated.baseAttrs && updated.attrs) {
      updated.baseAttrs = { ...updated.attrs };
    }
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
  if (updated.punishmentReplacement) {
    updated.overall = clampRating(PUNISHMENT_PLAYER_OVERALL);
  } else if (Number.isFinite(updated.overallOverride)) {
    updated.overall = clampRating(updated.overallOverride);
  }
  return updated;
}

function initialiseRosterMetrics(league) {
  const rosters = ensureTeamRosterShell(league);
  Object.entries(rosters).forEach(([teamId, roster]) => {
    league.playerAges ||= {};
    Object.entries(roster.offense || {}).forEach(([role, player]) => {
      const decorated = decoratePlayerMetrics(player, role);
      decorated.currentTeamId = decorated.currentTeamId || teamId;
      if (!decorated.contract) {
        decorated.contract = generateInitialContract(league, teamId, decorated);
      }
      applyContractToPlayer(decorated, decorated.contract);
      const age = resolvePlayerAge(league, decorated);
      if (decorated.id && Number.isFinite(age)) {
        league.playerAges[decorated.id] = age;
      }
      roster.offense[role] = decorated;
      ensurePlayerDirectoryEntry(league, teamId, role, decorated);
    });
    Object.entries(roster.defense || {}).forEach(([role, player]) => {
      const decorated = decoratePlayerMetrics(player, role);
      decorated.currentTeamId = decorated.currentTeamId || teamId;
      if (!decorated.contract) {
        decorated.contract = generateInitialContract(league, teamId, decorated);
      }
      applyContractToPlayer(decorated, decorated.contract);
      const age = resolvePlayerAge(league, decorated);
      if (decorated.id && Number.isFinite(age)) {
        league.playerAges[decorated.id] = age;
      }
      roster.defense[role] = decorated;
      ensurePlayerDirectoryEntry(league, teamId, role, decorated);
    });
    if (roster.special?.K) {
      const decorated = decoratePlayerMetrics(roster.special.K, 'K');
      decorated.currentTeamId = decorated.currentTeamId || teamId;
      if (!decorated.contract) {
        decorated.contract = generateInitialContract(league, teamId, decorated);
      }
      applyContractToPlayer(decorated, decorated.contract);
      const age = resolvePlayerAge(league, decorated);
      if (decorated.id && Number.isFinite(age)) {
        league.playerAges[decorated.id] = age;
      }
      roster.special.K = decorated;
      ensurePlayerDirectoryEntry(league, teamId, 'K', decorated);
    }
    enforceInitialCapDiscipline(league, teamId);
    recalculateTeamPayroll(league, teamId);
  });
}

function enforceInitialCapDiscipline(league, teamId) {
  ensureSalaryStructures(league);
  if (!league || !teamId) return;
  const roster = league.teamRosters?.[teamId] || null;
  if (!roster) return;
  const players = gatherRosterPlayers(roster);
  if (!players.length) return;
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const totalSalary = players.reduce((sum, { player }) => {
    const contract = player?.contract || null;
    if (!contract || contract.temporary) return sum;
    const hit = Number.isFinite(contract.salary)
      ? contract.salary
      : Number.isFinite(contract.capHit)
        ? contract.capHit
        : 0;
    return sum + Math.max(0, hit);
  }, 0);
  const alreadyDiscounted = players.every(({ player }) => player?.contract?.initialDiscounted);
  if (alreadyDiscounted) return;
  if (totalSalary <= cap) {
    players.forEach(({ player }) => {
      if (player?.contract) player.contract.initialDiscounted = true;
    });
    return;
  }
  const targetTotal = Math.min(cap * 0.88, totalSalary * 0.92);
  const scale = targetTotal / Math.max(totalSalary, 1);
  const appliedScale = clamp(scale, 0.35, 0.95);
  players.forEach(({ player }) => {
    const contract = player?.contract || null;
    if (!contract || contract.temporary) return;
    const baseSalary = Number.isFinite(contract.salary) ? contract.salary : 0;
    if (baseSalary <= 0) return;
    const minimum = minimumSalaryForPlayer(player);
    const adjustedSalary = Math.max(
      minimum,
      Math.round((baseSalary * appliedScale) / CONTRACT_ROUNDING) * CONTRACT_ROUNDING,
    );
    const years = Number.isFinite(contract.years) ? contract.years : 1;
    const yearsRemaining = Number.isFinite(contract.yearsRemaining)
      ? Math.min(contract.yearsRemaining, years)
      : years;
    const updated = {
      ...contract,
      salary: adjustedSalary,
      capHit: adjustedSalary,
      totalValue: adjustedSalary * years,
      years,
      yearsRemaining,
      initialDiscounted: true,
    };
    applyContractToPlayer(player, updated);
  });
}

function gatherRosterPlayers(roster) {
  const players = [];
  if (!roster) return players;
  Object.entries(roster.offense || {}).forEach(([role, player]) => {
    if (player) players.push({ player, role });
  });
  Object.entries(roster.defense || {}).forEach(([role, player]) => {
    if (player) players.push({ player, role });
  });
  if (roster.special?.K) {
    players.push({ player: roster.special.K, role: 'K' });
  }
  return players;
}

function computeTeamGrowthProfile(league, teamId) {
  if (!league || !teamId) {
    return { averageOverall: 0, averagePotential: 0, averageCeiling: 0, growthGap: 0, playerCount: 0 };
  }
  const roster = league.teamRosters?.[teamId] || null;
  const entries = gatherRosterPlayers(roster);
  if (!entries.length) {
    return { averageOverall: 0, averagePotential: 0, averageCeiling: 0, growthGap: 0, playerCount: 0 };
  }
  let totalOverall = 0;
  let totalPotential = 0;
  let totalCeiling = 0;
  entries.forEach(({ player, role }) => {
    const ratingSource = player.attrs || player.ratings || {};
    const overall = clamp(
      player.overall != null ? player.overall : computeOverallFromRatings(ratingSource, role),
      0,
      99,
    );
    const potentialScore = clamp(
      (player.potential != null ? player.potential : player.ceiling != null ? player.ceiling : overall / 99) * 100,
      0,
      130,
    );
    const ceilingScore = clamp(
      (player.ceiling != null ? player.ceiling : player.potential != null ? player.potential : overall / 99) * 100,
      0,
      135,
    );
    totalOverall += overall;
    totalPotential += potentialScore;
    totalCeiling += ceilingScore;
  });
  const count = entries.length;
  const averageOverall = totalOverall / count;
  const averagePotential = totalPotential / count;
  const averageCeiling = totalCeiling / count;
  return {
    averageOverall,
    averagePotential,
    averageCeiling,
    growthGap: averagePotential - averageOverall,
    playerCount: count,
  };
}

function resolveTeamResultsProfile(league, season, teamId) {
  const seasonSource = season || league?.season || league?.seasonSnapshot || null;
  const teamEntry = seasonSource?.teams?.[teamId]
    || league?.season?.teams?.[teamId]
    || league?.seasonSnapshot?.teams?.[teamId]
    || null;
  const record = teamEntry?.record || { wins: 0, losses: 0, ties: 0 };
  const games = (record.wins || 0) + (record.losses || 0) + (record.ties || 0);
  const winPct = games > 0 ? ((record.wins || 0) + (record.ties || 0) * 0.5) / games : 0.5;
  const history = Array.isArray(league?.teamSeasonHistory?.[teamId]) ? league.teamSeasonHistory[teamId] : [];
  const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
  const prevRecord = prevEntry?.record || null;
  const prevGames = prevRecord ? (prevRecord.wins || 0) + (prevRecord.losses || 0) + (prevRecord.ties || 0) : 0;
  const prevWinPct = prevGames > 0
    ? ((prevRecord.wins || 0) + (prevRecord.ties || 0) * 0.5) / prevGames
    : winPct;
  const pointDiff = (teamEntry?.pointsFor ?? 0) - (teamEntry?.pointsAgainst ?? 0);
  return {
    record,
    games,
    winPct,
    trend: winPct - prevWinPct,
    pointDiff,
  };
}

function buildTeamDecisionContext(league, teamId, season = null) {
  const growth = computeTeamGrowthProfile(league, teamId);
  const results = resolveTeamResultsProfile(league, season, teamId);
  ensureSalaryStructures(league);
  const payroll = recalculateTeamPayroll(league, teamId);
  const cap = Number.isFinite(league?.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const capRatio = cap > 0 ? payroll / cap : 1;
  const capSpace = Math.max(0, cap - payroll);
  return {
    teamId,
    winPct: results.winPct,
    trend: results.trend,
    pointDiff: results.pointDiff,
    games: results.games,
    averageOverall: growth.averageOverall,
    averagePotential: growth.averagePotential,
    averageCeiling: growth.averageCeiling,
    growthGap: growth.growthGap,
    playerCount: growth.playerCount,
    payroll,
    salaryCap: cap,
    capRatio,
    capSpace,
  };
}

function randomAttrValue(attr, skill, emphasis = 0.5) {
  const [min, max] = ATTR_RANGES[attr] || [0, 1];
  const noise = rand(-0.12, 0.12);
  let quality = clamp(skill * 0.6 + emphasis * 0.4 + noise, 0, 1);
  if (Math.random() < 0.18) {
    const extreme = amplifyNormalized(Math.random());
    quality = clamp(quality * 0.6 + extreme * 0.4, 0, 1);
  }
  const stretchedQuality = amplifyNormalized(quality);
  return clamp(min + (max - min) * stretchedQuality, min, max);
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

function buildFreeAgent(role, archetype, tier, seasonNumber, options = {}) {
  const { bargain = false } = options;
  const effectiveTier = bargain ? 'veteran' : tier;
  const skill = bargain
    ? rand(0.1, 0.28)
    : tier === 'veteran' ? rand(0.65, 0.95)
      : tier === 'prospect' ? rand(0.35, 0.65)
        : rand(0.5, 0.8);
  const potential = bargain
    ? clamp(skill + rand(-0.08, 0.08), 0.2, 0.48)
    : tier === 'prospect' ? clamp(skill + rand(0.25, 0.45), 0.6, 1.25)
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
    ceiling: bargain ? clamp(potential + rand(0.005, 0.025), 0.24, 0.5) : potential + rand(0.02, 0.1),
    origin: 'free-agent',
    archetype: bargain ? 'bargain' : archetype || tier,
    age: randomAgeForProspect(effectiveTier),
    createdSeason: seasonNumber,
    type: bargain ? 'bargain' : tier,
    preferredRole: role,
  };
  if (bargain) {
    player.bargainBin = true;
    player.loyalty = clamp(rand(0.12, 0.32), 0.08, 0.4);
    player.minimumSalaryOverride = BARGAIN_MIN_SALARY;
    player.overallOverride = clampRating(rand(30, 38));
  }
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

function hasFreeAgentForRole(freeAgents, role) {
  if (!Array.isArray(freeAgents) || !freeAgents.length) return false;
  return freeAgents.some((player) => {
    if (!player) return false;
    const candidateRole = player.role || player.preferredRole || null;
    if (!candidateRole) return false;
    if (role === 'K') {
      return candidateRole === 'K';
    }
    return candidateRole === role;
  });
}

function hasCheapFreeAgentForRole(freeAgents, role) {
  if (!Array.isArray(freeAgents) || !freeAgents.length) return false;
  return freeAgents.some((player) => {
    if (!player || (!player.bargainBin && player.type !== 'bargain')) return false;
    const candidateRole = player.role || player.preferredRole || null;
    if (!candidateRole) return false;
    if (role === 'K') {
      return candidateRole === 'K';
    }
    return candidateRole === role;
  });
}

function ensureFreeAgentRoleCoverage(league, seasonNumber, roles = null) {
  if (!league) return;
  const pool = league.freeAgents || (league.freeAgents = []);
  const resolvedSeason = seasonNumber || league.seasonNumber || 1;
  const roleList = roles
    ? (Array.isArray(roles) ? roles.filter(Boolean) : [roles]).filter(Boolean)
    : [...ROLES_OFF, ...ROLES_DEF, 'K'];
  roleList.forEach((role) => {
    if (!role || hasFreeAgentForRole(pool, role)) return;
    for (let i = 0; i < 3; i += 1) {
      pool.push(buildFreeAgent(role, null, 'balanced', resolvedSeason));
    }
  });
  roleList.forEach((role) => {
    if (!role || hasCheapFreeAgentForRole(pool, role)) return;
    for (let i = 0; i < 3; i += 1) {
      pool.push(buildFreeAgent(role, null, 'balanced', resolvedSeason, { bargain: true }));
    }
  });
}

function ensureFreeAgentPool(league, seasonNumber) {
  if (!Array.isArray(league.freeAgents)) {
    league.freeAgents = [];
  }
  if (league.lastFreeAgentSeason !== seasonNumber) {
    const generated = generateFreeAgentClass(league, seasonNumber, 42);
    league.freeAgents.push(...generated);
    league.lastFreeAgentSeason = seasonNumber;
  }
  ensureFreeAgentRoleCoverage(league, seasonNumber);
}

function buildPunishmentReplacementPlayer(teamId, role, seasonNumber) {
  const ratings = {};
  Object.entries(ATTR_RANGES).forEach(([attr, [min, max]]) => {
    const span = Math.max(0, max - min);
    ratings[attr] = clamp(min + span * rand(0, 0.04), min, min + span * 0.05);
  });
  return {
    id: `PEN-${teamId}-${role}-${Math.floor(Date.now() % 1_000_000)}-${Math.floor(Math.random() * 1000)}`,
    firstName: randomFirstName(),
    lastName: randomLastName(),
    number: null,
    ratings,
    modifiers: {},
    potential: 0.2,
    ceiling: 0.22,
    origin: 'league-punishment',
    archetype: 'punishment',
    age: Math.round(rand(27, 34)),
    createdSeason: seasonNumber,
    type: 'punishment',
    preferredRole: role,
    punishmentReplacement: true,
    minimumSalaryOverride: PUNISHMENT_PLAYER_SALARY,
    overallOverride: PUNISHMENT_PLAYER_OVERALL,
    loyalty: clamp(rand(0.05, 0.16), 0.02, 0.24),
  };
}

export function enforceGameDayRosterMinimums(league, teamIds = null, { reason = 'game-day penalty' } = {}) {
  if (!league) return [];
  if (league?.offseason?.active) {
    return [];
  }
  const rosters = ensureTeamRosterShell(league);
  const targets = teamIds
    ? [...new Set((Array.isArray(teamIds) ? teamIds : [teamIds]).filter(Boolean))]
    : Object.keys(rosters || {});
  if (!targets.length) return [];
  const seasonNumber = league.seasonNumber || 1;
  const additions = [];
  targets.forEach((teamId) => {
    const roster = rosters[teamId];
    if (!roster) return;
    const addedForTeam = [];
    const ensureRoleFilled = (role) => {
      if (!role) return;
      const side = roleSide(role);
      const occupied = side === 'offense'
        ? roster.offense?.[role]
        : side === 'defense'
          ? roster.defense?.[role]
          : roster.special?.K;
      if (occupied) return;
      const replacement = buildPunishmentReplacementPlayer(teamId, role, seasonNumber);
      const contract = finalizeContract({
        teamId,
        salary: PUNISHMENT_PLAYER_SALARY,
        years: 1,
        startSeason: seasonNumber,
        basis: 'league-punishment',
        minimumSalary: PUNISHMENT_PLAYER_SALARY,
      });
      replacement.contract = contract;
      applyContractToPlayer(replacement, contract);
      assignPlayerToRoster(league, teamId, role, replacement);
      const identity = getTeamIdentity(teamId) || { abbr: teamId, displayName: teamId };
      recordNewsInternal(league, {
        type: 'roster',
        teamId,
        text: `${identity.abbr || teamId} assigned punitive replacement ${replacement.firstName} ${replacement.lastName} (${role})`,
        detail: 'League issues a replacement for an empty roster slot at kickoff.',
        seasonNumber,
        playerId: replacement.id,
        playerName: `${replacement.firstName} ${replacement.lastName}`.trim(),
        role,
      });
      additions.push({ teamId, role, player: replacement });
      addedForTeam.push(replacement);
    };
    ROLES_OFF.forEach(ensureRoleFilled);
    ROLES_DEF.forEach(ensureRoleFilled);
    if (!roster.special?.K) {
      ensureRoleFilled('K');
    }
    if (addedForTeam.length) {
      const gm = league.teamGms?.[teamId] || null;
      if (gm) {
        gm.frustration = clamp((gm.frustration || 0) + 1.7 + addedForTeam.length * 0.2, 0, 4);
        gm.lastPunishment = { seasonNumber, reason };
      }
      refreshTeamMood(league, teamId);
    }
  });
  return additions;
}

let coachFreeAgentCounter = 1;
let scoutFreeAgentCounter = 1;
let gmFreeAgentCounter = 1;

function randomBoostAttribute() {
  const keys = Object.keys(ATTR_RANGES);
  return choice(keys);
}

function tieredRandom(lowRange, midRange, highRange, { lowChance = 0.22, highChance = 0.18 } = {}) {
  const roll = Math.random();
  if (roll < lowChance && lowRange) {
    const [min, max] = lowRange;
    return rand(min, max);
  }
  if (roll > 1 - highChance && highRange) {
    const [min, max] = highRange;
    return rand(min, max);
  }
  const range = midRange || highRange || lowRange || [0, 1];
  const [min, max] = range;
  return rand(min, max);
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
  coach.tacticalIQ = clamp(tieredRandom([0.45, 0.75], [0.75, 1.28], [1.28, 1.48], { lowChance: 0.24, highChance: 0.2 }), 0.4, 1.5);
  let playBase = coach.tacticalIQ + rand(-0.2, 0.2);
  if (Math.random() < 0.18) {
    playBase = rand(0.38, 0.7);
  } else if (Math.random() > 0.85) {
    playBase = rand(1.25, 1.5);
  }
  coach.playcallingIQ = clamp(playBase, 0.38, 1.5);
  coach.clock = {
    hurry: clamp(Math.round(rand(118, 178)), 108, 190),
    defensive: clamp(Math.round(rand(100, 150)), 92, 170),
    must: clamp(Math.round(rand(24, 44)), 20, 48),
    margin: clamp(Math.round(rand(5, 12)), 3, 14),
  };
  coach.tendencies = {
    passBias: clamp(rand(-0.45, 0.5), -0.5, 0.5),
    runBias: clamp(rand(-0.4, 0.45), -0.45, 0.45),
    aggression: clamp(tieredRandom([-0.35, -0.05], [-0.05, 0.28], [0.28, 0.5], { lowChance: 0.28, highChance: 0.2 }), -0.4, 0.5),
  };
  const boostMagnitude = Math.random() < 0.2 ? [0.03, 0.09] : [0.015, 0.07];
  const offenseTeamBoost = { [randomBoostAttribute()]: rand(boostMagnitude[0], boostMagnitude[1]) };
  const defenseTeamBoost = { [randomBoostAttribute()]: rand(boostMagnitude[0], boostMagnitude[1]) };
  coach.playerBoosts = {
    offense: { team: offenseTeamBoost, positions: buildBoostMap(ROLES_OFF, 2, boostMagnitude) },
    defense: { team: defenseTeamBoost, positions: buildBoostMap(ROLES_DEF, 2, boostMagnitude) },
  };
  const offenseDev = tieredRandom([0.12, 0.22], [0.22, 0.36], [0.36, 0.48], { lowChance: 0.26, highChance: 0.22 });
  const defenseDev = tieredRandom([0.12, 0.22], [0.22, 0.36], [0.36, 0.48], { lowChance: 0.26, highChance: 0.22 });
  const qbDev = tieredRandom([0.14, 0.26], [0.26, 0.4], [0.4, 0.5], { lowChance: 0.2, highChance: 0.22 });
  const skillDev = tieredRandom([0.14, 0.24], [0.24, 0.36], [0.36, 0.46], { lowChance: 0.24, highChance: 0.2 });
  const runDev = tieredRandom([0.12, 0.24], [0.24, 0.34], [0.34, 0.44], { lowChance: 0.24, highChance: 0.18 });
  coach.development = {
    offense: clamp(offenseDev, 0.1, 0.5),
    defense: clamp(defenseDev, 0.1, 0.5),
    qb: clamp(qbDev, 0.12, 0.52),
    skill: clamp(skillDev, 0.12, 0.48),
    run: clamp(runDev, 0.1, 0.46),
  };
  const aggression = clamp(coach.tendencies.aggression ?? 0, -0.4, 0.45);
  const supportBase = ((coach.development.offense ?? 0.22) + (coach.development.defense ?? 0.22)) / 2;
  const support = clamp(supportBase - 0.25, -0.4, 0.45);
  const composure = clamp((coach.tacticalIQ ?? 1) - 1, -0.3, 0.4);
  coach.temperamentProfile = { aggression, support, composure };
  coach.capFocus = clamp(rand(0.25, 0.72), 0.15, 0.95);
  coach.origin = 'staff-free-agent';
  coach.resume ||= { experience: Math.round(tieredRandom([1, 4], [5, 13], [14, 20], { lowChance: 0.25, highChance: 0.2 })) };
  delete coach.teamId;
  delete coach.identity;
  return updateCoachOverall(coach);
}

function generateScoutCandidate() {
  const idSuffix = String(scoutFreeAgentCounter).padStart(3, '0');
  scoutFreeAgentCounter += 1;
  const evaluation = clamp(tieredRandom([0.2, 0.45], [0.45, 0.82], [0.82, 0.97], { lowChance: 0.22, highChance: 0.2 }), 0.15, 0.98);
  const development = clamp(tieredRandom([0.18, 0.4], [0.4, 0.75], [0.75, 0.95], { lowChance: 0.26, highChance: 0.2 }), 0.16, 0.98);
  const trade = clamp(tieredRandom([0.2, 0.45], [0.45, 0.8], [0.8, 0.96], { lowChance: 0.24, highChance: 0.18 }), 0.16, 0.98);
  const aggression = clamp(tieredRandom([0.15, 0.4], [0.4, 0.75], [0.75, 0.95], { lowChance: 0.28, highChance: 0.22 }), 0.1, 0.98);
  const temperamentSense = clamp(tieredRandom([0.18, 0.4], [0.4, 0.78], [0.78, 0.96], { lowChance: 0.24, highChance: 0.2 }), 0.16, 0.98);
  const scout = {
    id: `SCOUT-FA-${idSuffix}`,
    name: randomScoutName(),
    evaluation,
    development,
    trade,
    aggression,
    temperamentSense,
    origin: 'staff-free-agent',
  };
  scout.capFocus = clamp(tieredRandom([0.22, 0.45], [0.45, 0.78], [0.78, 0.96], { lowChance: 0.24, highChance: 0.18 }), 0.2, 0.95);
  return updateScoutOverall(scout);
}

function generateGmCandidate({ teamId = null } = {}) {
  const id = teamId ? `GM-${teamId}` : `GM-FA-${String(gmFreeAgentCounter).padStart(3, '0')}`;
  if (!teamId) gmFreeAgentCounter += 1;
  const patience = clamp(tieredRandom([0.18, 0.45], [0.45, 0.82], [0.82, 0.98], { lowChance: 0.25, highChance: 0.2 }), 0.12, 0.99);
  const discipline = clamp(tieredRandom([0.2, 0.48], [0.48, 0.85], [0.85, 0.98], { lowChance: 0.24, highChance: 0.2 }), 0.18, 0.99);
  const evaluation = clamp(tieredRandom([0.22, 0.48], [0.48, 0.86], [0.86, 0.99], { lowChance: 0.24, highChance: 0.2 }), 0.2, 0.99);
  const vision = clamp(tieredRandom([0.2, 0.46], [0.46, 0.84], [0.84, 0.98], { lowChance: 0.24, highChance: 0.2 }), 0.18, 0.99);
  const culture = clamp(tieredRandom([0.2, 0.45], [0.45, 0.82], [0.82, 0.97], { lowChance: 0.24, highChance: 0.2 }), 0.18, 0.98);
  const capTolerance = clamp(tieredRandom([0.08, 0.18], [0.18, 0.32], [0.32, 0.42], { lowChance: 0.24, highChance: 0.18 }), 0.06, 0.45);
  const capFocus = clamp(tieredRandom([0.28, 0.52], [0.52, 0.82], [0.82, 0.98], { lowChance: 0.24, highChance: 0.18 }), 0.3, 0.98);
  const capFlashpoint = clamp(tieredRandom([0.35, 0.55], [0.55, 0.78], [0.78, 0.9], { lowChance: 0.26, highChance: 0.18 }), 0.3, 0.95);
  const gm = {
    id,
    teamId,
    name: randomGmName(),
    evaluation,
    culture,
    discipline,
    patience,
    vision,
    charisma: clamp(tieredRandom([0.15, 0.4], [0.4, 0.75], [0.75, 0.95], { lowChance: 0.26, highChance: 0.18 }), 0.12, 0.96),
    tenure: 0,
    frustration: 0,
    capTolerance,
    capFocus,
    capFlashpoint,
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
      const capFocus = clamp(rand(0.25, 0.7), 0.15, 0.95);
      league.teamCoaches[teamId] = updateCoachOverall({ ...coach, teamId, capFocus });
    } else {
      const existing = league.teamCoaches[teamId];
      if (existing.capFocus == null) {
        existing.capFocus = clamp(rand(0.25, 0.7), 0.15, 0.95);
      }
      updateCoachOverall(existing);
    }
  });
}

function ensureTeamGms(league) {
  if (!league.teamGms) league.teamGms = {};
  TEAM_IDS.forEach((teamId) => {
    if (!league.teamGms[teamId]) {
      league.teamGms[teamId] = generateGmCandidate({ teamId });
    } else {
      const gmEntry = league.teamGms[teamId];
      if (gmEntry.capTolerance == null) {
        gmEntry.capTolerance = clamp(rand(0.1, 0.3), 0.06, 0.45);
      }
      if (gmEntry.capFocus == null) {
        gmEntry.capFocus = clamp(rand(0.35, 0.85), 0.3, 0.98);
      }
      if (gmEntry.capFlashpoint == null) {
        gmEntry.capFlashpoint = clamp(rand(0.45, 0.8), 0.3, 0.95);
      }
      updateGmOverall(gmEntry);
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
        capFocus: clamp(rand(0.28, 0.75), 0.2, 0.95),
      });
    } else {
      const scout = league.teamScouts[teamId];
      if (scout.capFocus == null) {
        scout.capFocus = clamp(rand(0.28, 0.75), 0.2, 0.95);
      }
      updateScoutOverall(scout);
    }
  });
}

function ensureNewsFeed(league) {
  if (!Array.isArray(league.newsFeed)) league.newsFeed = [];
}

function coachCandidateScore(candidate = {}, context = {}) {
  const growthNeed = clamp(Math.max(0, context.growthGap ?? 0) / 20, 0, 1);
  const resultNeed = clamp((0.55 - (context.winPct ?? 0.5)) * 1.4 + Math.max(0, -(context.trend ?? 0)) * 6, 0, 1.2);
  const resilience = clamp(-(context.pointDiff ?? 0) / 120, 0, 0.6);
  const experience = clamp((candidate.resume?.experience ?? 6) / 20, 0, 1);
  const development = clamp(
    ((candidate.development?.offense ?? 0.2) + (candidate.development?.defense ?? 0.2)) / 0.85,
    0,
    1,
  );
  const qbGrowth = clamp((candidate.development?.qb ?? 0.2) / 0.52, 0, 1);
  const capNeed = clamp(context.capFocusNeed ?? Math.max(0, (context.capRatio ?? 1) - 1) * 1.2, 0, 1);
  const capDiscipline = clamp(candidate.capFocus ?? 0.45, 0, 1);
  const randomSwing = Math.random() * 0.05;
  return (
    development * (0.45 + growthNeed * 0.45)
    + experience * (0.4 + resultNeed * 0.45 + resilience * 0.2)
    + qbGrowth * (0.08 + growthNeed * 0.12)
    + capDiscipline * capNeed * (context.capEmergency ? 0.18 : 0.12)
    + randomSwing
  );
}

function takeCoachCandidate(league, context = {}) {
  ensureStaffFreeAgents(league);
  const pool = league.staffFreeAgents.coaches;
  if (!pool.length) pool.push(generateCoachCandidate());
  let bestIndex = 0;
  let bestScore = -Infinity;
  pool.forEach((candidate, index) => {
    const score = coachCandidateScore(candidate, context);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  const [candidate] = pool.splice(bestIndex, 1);
  return updateCoachOverall(candidate || generateCoachCandidate());
}

function scoutCandidateScore(candidate = {}, context = {}) {
  const growthNeed = clamp(Math.max(0, context.growthGap ?? 0) / 16, 0, 1);
  const resultNeed = clamp((0.55 - (context.winPct ?? 0.5)) * 1.2 + Math.max(0, -(context.trend ?? 0)) * 5, 0, 1);
  const evaluation = clamp(candidate.evaluation ?? 0.5, 0, 1);
  const development = clamp(candidate.development ?? 0.5, 0, 1);
  const trade = clamp(candidate.trade ?? 0.5, 0, 1);
  const temperament = clamp(candidate.temperamentSense ?? 0.5, 0, 1);
  const capNeed = clamp(context.capFocusNeed ?? Math.max(0, (context.capRatio ?? 1) - 1) * 1.4, 0, 1);
  const capDiscipline = clamp(candidate.capFocus ?? 0.5, 0, 1);
  const randomSwing = Math.random() * 0.05;
  return (
    evaluation * (0.4 + resultNeed * 0.4)
    + development * (0.4 + growthNeed * 0.45)
    + trade * 0.08
    + temperament * 0.1
    + capDiscipline * capNeed * (context.capEmergency ? 0.24 : 0.15)
    + randomSwing
  );
}

function takeScoutCandidate(league, context = {}) {
  ensureStaffFreeAgents(league);
  const pool = league.staffFreeAgents.scouts;
  if (!pool.length) pool.push(generateScoutCandidate());
  let bestIndex = 0;
  let bestScore = -Infinity;
  pool.forEach((candidate, index) => {
    const score = scoutCandidateScore(candidate, context);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  const [candidate] = pool.splice(bestIndex, 1);
  return updateScoutOverall(candidate || generateScoutCandidate());
}

function replaceCoach(league, teamId, coach, seasonNumber, { reason, context } = {}) {
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
  const decisionContext = context || buildTeamDecisionContext(league, teamId, league?.season || league?.seasonSnapshot || null);
  const candidate = takeCoachCandidate(league, decisionContext);
  const assigned = updateCoachOverall({ ...candidate, teamId, identity });
  assigned.resume = { ...(candidate.resume || {}), lastTeam: teamId };
  assigned.tendencies ||= { aggression: 0, passBias: 0, runBias: 0 };
  const targetCapFocus = context?.capEmergency
    ? Math.max(assigned.capFocus ?? 0.62, 0.68)
    : clamp(assigned.capFocus ?? rand(0.25, 0.72), 0.15, 0.95);
  assigned.capFocus = clamp(targetCapFocus, 0.15, 0.98);
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

function replaceScout(league, teamId, scout, seasonNumber, { reason, context } = {}) {
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
  const decisionContext = context || buildTeamDecisionContext(league, teamId, league?.season || league?.seasonSnapshot || null);
  const candidate = takeScoutCandidate(league, decisionContext);
  const assigned = updateScoutOverall({ ...candidate, teamId });
  const targetCapFocus = context?.capEmergency
    ? Math.max(assigned.capFocus ?? 0.6, 0.72)
    : clamp(assigned.capFocus ?? rand(0.3, 0.75), 0.2, 0.95);
  assigned.capFocus = clamp(targetCapFocus, 0.2, 0.98);
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

function evaluateStaffChanges(league, season, { focusTeams, activityDial } = {}) {
  if (!league || !season) return;
  ensureTeamCoaches(league);
  ensureTeamGms(league);
  ensureScouts(league);
  ensureStaffFreeAgents(league);
  const targetTeams = Array.isArray(focusTeams) && focusTeams.length ? focusTeams : TEAM_IDS;
  const dial = Math.min(1, Math.max(0.2, activityDial ?? (targetTeams.length / Math.max(1, TEAM_IDS.length))));
  targetTeams.forEach((teamId) => {
    const gm = league.teamGms?.[teamId] || null;
    if (!gm) return;
    const decisionContext = buildTeamDecisionContext(league, teamId, season);
    const capProfile = computeTeamCapProfile(league, teamId, gm, decisionContext);
    const winPct = decisionContext.winPct ?? 0.5;
    const trend = decisionContext.trend ?? 0;
    const pointDiff = decisionContext.pointDiff ?? 0;
    const growthGap = Math.max(0, decisionContext.growthGap ?? 0);
    const resultPressure = clamp(
      (0.55 - winPct) * 1.8
        + Math.max(0, -trend) * 6
        + (pointDiff < -40 ? 0.2 : pointDiff < -20 ? 0.12 : 0),
      0,
      1.6,
    );
    let frustration = (gm.frustration || 0) * 0.35
      + resultPressure * 0.85
      + clamp(growthGap / 24, 0, 0.6)
      + capProfile.stressScore;
    frustration -= clamp((winPct - 0.55) * 1.2, 0, 0.6);
    frustration -= clamp(trend * 6, 0, 0.5);
    frustration -= capProfile.relief * 0.5;
    frustration = clamp(frustration, 0, 4);
    gm.frustration = frustration;
    gm.tenure = (gm.tenure || 0) + 1;
    gm.lastDecisionContext = decisionContext;
    gm.capSituation = { ratio: capProfile.capRatio, stress: capProfile.stress };

    let coach = league.teamCoaches?.[teamId] || null;
    let scout = league.teamScouts?.[teamId] || null;

    const seasonNumber = season.seasonNumber || league.seasonNumber || 1;
    const capEmergency = capProfile.stress > Math.max(0.08, (gm.capFlashpoint ?? 0.5) - 0.15)
      && capProfile.capRatio > 1.01;
    const staffContext = {
      ...decisionContext,
      capFocusNeed: Math.max(
        decisionContext.capFocusNeed ?? 0,
        capProfile.focusNeed * (0.8 + (gm.capFocus ?? 0.5) * 0.4),
      ),
      capEmergency,
    };
    let replacedCoachForCap = false;
    let replacedScoutForCap = false;
    if (capEmergency && gm.lastCapCrisisSeason !== seasonNumber) {
      const preferScout = !scout || (scout.capFocus ?? 0.35) < (coach?.capFocus ?? 0.35);
      if (preferScout) {
        replaceScout(league, teamId, scout, seasonNumber, {
          reason: 'Cap discipline crackdown',
          context: staffContext,
        });
        scout = league.teamScouts?.[teamId] || scout;
        replacedScoutForCap = true;
      } else if (coach) {
        replaceCoach(league, teamId, coach, seasonNumber, {
          reason: 'Cap discipline crackdown',
          context: staffContext,
        });
        coach = league.teamCoaches?.[teamId] || coach;
        replacedCoachForCap = true;
      }
      gm.lastCapCrisisSeason = seasonNumber;
      frustration = clamp((gm.frustration || 0) - 0.35, 0, 4);
      gm.frustration = frustration;
    }

    const coachStruggle = winPct < 0.45 || trend < -0.08;
    const capCoachPressure = capProfile.stress * (0.35 + (gm.capFocus ?? 0.5) * 0.25);
    const coachPressure = clamp(
      resultPressure * 0.6 + (growthGap / 18) * 0.4 + (frustration - 1) * 0.25 + capCoachPressure,
      0,
      1.2,
    );
    let fireCoachChance = replacedCoachForCap
      ? 0
      : (coachStruggle || capProfile.capRatio > 1.05)
        ? clamp(coachPressure, 0, 0.9)
        : clamp((coachPressure - 0.45) * 0.55, 0, 0.45);
    fireCoachChance = clamp(fireCoachChance * dial, 0, 0.9);
    if (coach && Math.random() < fireCoachChance) {
      const reason = coachStruggle
        ? 'Performance evaluation'
        : capProfile.capRatio > 1.05
          ? 'Cap discipline reset'
          : 'Strategic refresh';
      replaceCoach(league, teamId, coach, seasonNumber, { reason, context: staffContext });
      coach = league.teamCoaches?.[teamId] || coach;
    }

    const scoutStruggle = (growthGap > 8 && winPct < 0.55) || capProfile.capRatio > 1.02;
    const capScoutPressure = capProfile.stress * (0.5 + (gm.capFocus ?? 0.5) * 0.35);
    const scoutPressure = clamp(
      (growthGap / 16) * 0.7 + resultPressure * 0.35 + (frustration - 1.2) * 0.15 + capScoutPressure,
      0,
      1.2,
    );
    let fireScoutChance = replacedScoutForCap
      ? 0
      : scoutStruggle
        ? clamp(scoutPressure, 0, 0.65)
        : clamp((scoutPressure - 0.5) * 0.4, 0, 0.32);
    fireScoutChance = clamp(fireScoutChance * dial, 0, 0.65);
    if (Math.random() < fireScoutChance) {
      const reason = scoutStruggle && capProfile.capRatio > 1.02
        ? 'Cap discipline crackdown'
        : scoutStruggle
          ? 'Need sharper evaluations'
          : 'Shuffling scouting approach';
      replaceScout(league, teamId, scout, seasonNumber, { reason, context: staffContext });
      scout = league.teamScouts?.[teamId] || scout;
    }
  });
}

function computeTeamCapProfile(league, teamId, gm, decisionContext = null) {
  ensureSalaryStructures(league);
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const payroll = recalculateTeamPayroll(league, teamId);
  const capRatio = cap > 0 ? payroll / cap : 1;
  const capSpace = Math.max(0, cap - payroll);
  const tolerance = clamp(gm?.capTolerance ?? 0.2, 0.05, 0.6);
  const focus = clamp(gm?.capFocus ?? 0.5, 0, 1);
  const overage = Math.max(0, capRatio - 1);
  const stress = Math.max(0, overage - tolerance);
  const discipline = clamp(gm?.discipline ?? 0.5, 0, 1);
  const stressScore = stress * (1.1 + focus * 0.6 + discipline * 0.3);
  const relief = capRatio < 1 ? Math.min((1 - capRatio) * (0.4 + focus * 0.2), 0.6) : 0;
  const focusNeed = capRatio > 1 ? clamp(overage * (0.8 + focus * 0.6), 0, 1.2) : 0;
  if (decisionContext) {
    decisionContext.capRatio = capRatio;
    decisionContext.capSpace = capSpace;
    decisionContext.capFocusNeed = Math.max(decisionContext.capFocusNeed ?? 0, focusNeed);
  }
  return { cap, payroll, capRatio, capSpace, tolerance, focus, overage, stress, stressScore, relief, focusNeed };
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
  ensureSalaryStructures(league);
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
  let score;
  if (mode === 'win-now') {
    score = current * 0.7 + potential * 0.3;
  } else if (mode === 'future') {
    score = current * 0.4 + potential * 0.6;
  } else {
    score = current * 0.55 + potential * 0.45;
  }
  const loyalty = clamp(player.loyalty ?? 0.5, 0, 1);
  const contractBonus = computeContractValueBonus(player);
  const salaryWeight = 0.55 + Math.max(0, loyalty - 0.4) * 0.25;
  return score + contractBonus * salaryWeight;
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
  const options = (reason && typeof reason === 'object') ? { ...reason } : {};
  const reasonText = typeof reason === 'string'
    ? reason
    : options.reason || options.text || reason || 'released';
  const releaseTeamId = options.teamId || player.contract?.teamId || player.currentTeamId || player.originalTeamId || null;
  if (releaseTeamId) {
    applyReleaseContractOutcome(league, player, {
      teamId: releaseTeamId,
      reason: reasonText,
      careerEnding: !!options.careerEnding,
      skipCapPenalty: !!options.skipCapPenalty,
    });
  }
  league.freeAgents ||= [];
  const released = {
    ...player,
    role,
    releasedReason: reasonText || 'released',
    temperament: cloneTemperament(player.temperament),
  };
  decoratePlayerMetrics(released, role);
  ensurePlayerTemperament(released);
  ensurePlayerLoyalty(released);
  released.currentTeamId = null;
  clearPlayerContract(released);
  league.freeAgents.push(released);
}

function assignPlayerToRoster(league, teamId, role, player) {
  if (!league || !teamId || !player) return;
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  player.role = role;
  if (!player.originalTeamId) {
    player.originalTeamId = player.originalTeamId || teamId;
  }
  player.currentTeamId = teamId;
  ensurePlayerTemperament(player);
  ensurePlayerLoyalty(player);
  ensureSalaryStructures(league);
  league.playerAges ||= {};
  const resolvedAge = resolvePlayerAge(league, player);
  if (Number.isFinite(resolvedAge)) {
    league.playerAges[player.id] = resolvedAge;
    player.age = resolvedAge;
  }
  if (!rosters[teamId]) {
    rosters[teamId] = { offense: {}, defense: {}, special: {} };
  }
  const decorated = decoratePlayerMetrics(player, role);
  if (decorated.contract) {
    decorated.contract.teamId = teamId;
    if (!Number.isFinite(decorated.contract.yearsRemaining)) {
      decorated.contract.yearsRemaining = decorated.contract.years ?? 1;
    }
    applyContractToPlayer(decorated, decorated.contract);
  } else {
    clearPlayerContract(decorated);
  }
  if (side === 'offense') rosters[teamId].offense[role] = decorated;
  else if (side === 'defense') rosters[teamId].defense[role] = decorated;
  else rosters[teamId].special.K = decorated;
  ensurePlayerDirectoryEntry(league, teamId, role, decorated);
  recalculateTeamPayroll(league, teamId);
  bumpTeamRostersVersion(league);
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
  if (removed) {
    removed.currentTeamId = null;
    recalculateTeamPayroll(league, teamId);
    bumpTeamRostersVersion(league);
  }
  return removed;
}

function scoutEvaluationForPlayer(league, teamId, role, player, modeOverride) {
  ensureScouts(league);
  const scout = league.teamScouts?.[teamId] || { evaluation: 0.6 };
  const mode = modeOverride || 'balanced';
  const baseValue = evaluatePlayerTrueValue(player, mode);
  const capFocus = clamp(scout.capFocus ?? 0.4, 0, 1);
  const contractBonus = computeContractValueBonus(player, league);
  const capAwareValue = baseValue + contractBonus * capFocus * 0.35;
  const evaluation = applyScoutVariance(capAwareValue, scout.evaluation);
  return { scout, evaluation, trueValue: capAwareValue };
}

function countOpenRosterSpots(league, teamId) {
  const rosters = ensureTeamRosterShell(league);
  const roster = rosters?.[teamId];
  if (!roster) return 0;
  let count = 0;
  ROLES_OFF.forEach((role) => {
    if (!roster.offense?.[role]) count += 1;
  });
  ROLES_DEF.forEach((role) => {
    if (!roster.defense?.[role]) count += 1;
  });
  if (!roster.special?.K) count += 1;
  return count;
}

export function signBestFreeAgentForRole(league, teamId, role, {
  reason = 'depth move',
  mode,
  minImprovement = 0,
  context,
  temporaryContract = null,
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
  const scout = league.teamScouts?.[teamId] || null;
  const gm = league.teamGms?.[teamId] || null;
  const teamMood = league.teamMoods?.[teamId] || null;
  const roster = ensureTeamRosterShell(league)[teamId];
  if (!roster) return null;
  const groupRoles = roleGroupFor(role);
  const pickRoleOccupant = (roleKey) => {
    if (side === 'offense') return roster.offense?.[roleKey] || null;
    if (side === 'defense') return roster.defense?.[roleKey] || null;
    return roster.special?.K || null;
  };
  let targetRole = role;
  if (!temporaryContract && Array.isArray(groupRoles) && groupRoles.length > 1) {
    const vacancy = groupRoles.find((roleKey) => !pickRoleOccupant(roleKey));
    if (vacancy) {
      targetRole = vacancy;
    } else {
      let weakest = null;
      groupRoles.forEach((roleKey) => {
        const occupant = pickRoleOccupant(roleKey);
        if (!occupant) return;
        const value = evaluatePlayerTrueValue(occupant, strategy);
        if (!weakest || value < weakest.value - 0.0001) {
          weakest = { role: roleKey, player: occupant, value };
        }
      });
      if (weakest) {
        targetRole = weakest.role;
      }
    }
  }
  const current = pickRoleOccupant(targetRole);
  const incumbentValue = current ? evaluatePlayerTrueValue(current, strategy) : null;
  const openSlotsBefore = countOpenRosterSpots(league, teamId);
  const remainingAfter = temporaryContract ? openSlotsBefore : (current ? openSlotsBefore : Math.max(0, openSlotsBefore - 1));
  const capReservation = temporaryContract ? 0 : remainingAfter * MIN_CONTRACT_SALARY;
  const capSpace = getCapSpace(league, teamId) + (current?.contract?.salary ?? 0);
  const availableBudget = temporaryContract ? capSpace : Math.max(0, capSpace - capReservation);
  const capDiscipline = clamp(((coach?.capFocus ?? 0.4) * 0.6) + ((scout?.capFocus ?? 0.4) * 0.4), 0, 1);
  const capCeiling = Math.max(MIN_CONTRACT_SALARY, capSpace || 0);

  const candidateEvaluations = candidates.map(({ player, index }) => {
    const assessment = scoutEvaluationForPlayer(league, teamId, targetRole, player, strategy);
    const temperamentBonus = temperamentScoutAdjustment(player, { coach, teamMood });
    const bargainCandidate = isBargainPlayer(player);
    const minimum = minimumSalaryForPlayer(player);
    const expectedCost = bargainCandidate
      ? minimum
      : computeBaseSalary(player, league);
    const baseScore = assessment.evaluation + temperamentBonus;
    const budgetPressure = availableBudget > 0
      ? Math.max(0, expectedCost - availableBudget) / 1_000_000
      : expectedCost / 1_000_000;
    const proportionalPenalty = (expectedCost / capCeiling) * (0.4 + capDiscipline * 0.6);
    const score = baseScore - budgetPressure * (2.4 + capDiscipline * 4) - proportionalPenalty;
    return {
      ...assessment,
      index,
      player,
      score,
      expectedCost,
      temperamentBonus,
    };
  });
  if (!candidateEvaluations.length) return null;
  const cheapestOption = candidateEvaluations.reduce((best, entry) => {
    if (!best || entry.expectedCost < best.expectedCost) return entry;
    return best;
  }, null);
  const rankedCandidates = [...candidateEvaluations].sort((a, b) => b.score - a.score);

  const seasonNumber = league.seasonNumber || 1;
  let negotiation = null;
  let chosenEval = null;
  let moveConsumed = false;
  const ensureMoveAvailable = () => {
    if (!context || moveConsumed) return true;
    if (!consumeOffseasonMove(context, teamId)) return false;
    moveConsumed = true;
    return true;
  };

  for (const entry of rankedCandidates) {
    if (current && entry.trueValue < (incumbentValue ?? 0) + minImprovement) continue;
    const candidate = league.freeAgents[entry.index];
    if (!candidate) continue;
    const teamNeedScore = computeTeamNeedScore(incumbentValue, entry.trueValue);
    if (temporaryContract) {
      const games = Math.max(1, Math.round(temporaryContract.games || 1));
      const salary = Math.max(MIN_CONTRACT_SALARY, Math.round(temporaryContract.salary || MIN_CONTRACT_SALARY));
      const contract = finalizeContract({
        teamId,
        salary,
        years: 1,
        startSeason: seasonNumber,
        basis: temporaryContract.basis || 'injury-temporary',
      });
      contract.temporary = true;
      contract.temporaryGames = games;
      contract.temporaryForPlayerId = temporaryContract.forPlayerId || null;
      contract.capHit = 0;
      negotiation = { contract, preference: 1, capSpace: null };
    } else {
      negotiation = negotiateContractForTeam(league, teamId, candidate, {
        teamNeedScore: Math.max(teamNeedScore, current ? 0 : 1),
        seasonNumber,
        basis: reason || 'need-signing',
        replacingSalary: current?.contract?.salary ?? 0,
        capReservation,
      });
    }
    if (negotiation) {
      chosenEval = entry;
      break;
    }
  }

  if (!negotiation) {
    if (!temporaryContract && !current) {
      const capSpaceNow = getCapSpace(league, teamId);
      const openSlotsNow = countOpenRosterSpots(league, teamId);
      const cheapestMinimum = cheapestOption ? minimumSalaryForPlayer(cheapestOption.player) : MIN_CONTRACT_SALARY;
      if (openSlotsNow > 0 && capSpaceNow < cheapestMinimum && cheapestOption) {
        if (!ensureMoveAvailable()) {
          if (context && moveConsumed) refundOffseasonMove(context, teamId);
          return null;
        }
        const forcedIndex = league.freeAgents.findIndex((entry) => entry?.id === cheapestOption.player.id);
        const removalIndex = forcedIndex >= 0 ? forcedIndex : cheapestOption.index;
        const [chosen] = removalIndex >= 0 ? league.freeAgents.splice(removalIndex, 1) : [cheapestOption.player];
        const forcedMinimum = minimumSalaryForPlayer(chosen || cheapestOption.player);
        const forcedContract = finalizeContract({
          teamId,
          salary: forcedMinimum,
          years: 1,
          startSeason: seasonNumber,
          basis: 'cap-emergency',
          minimumSalary: forcedMinimum,
        });
        const assigned = { ...chosen, role: targetRole, origin: 'free-agent' };
        assigned.loyalty = clamp((assigned.loyalty ?? 0.5) * 0.5 + rand(0.18, 0.32), 0.08, 0.9);
        assigned.contract = forcedContract;
        applyContractToPlayer(assigned, assigned.contract);
        assignPlayerToRoster(league, teamId, targetRole, assigned);
        if (gm) {
          gm.frustration = clamp((gm.frustration || 0) + 0.55, 0, 4);
          gm.capSituation = { ...(gm.capSituation || {}), forcedOverage: true };
        }
        const newsContext = {};
        if (context?.dayNumber != null) newsContext.dayNumber = context.dayNumber;
        if (context?.totalDays != null) newsContext.totalDays = context.totalDays;
        if (context?.inaugural != null) newsContext.inaugural = context.inaugural;
        if (Object.keys(newsContext).length && newsContext.phase == null) {
          newsContext.phase = 'offseason';
        }
        const suppressAi = !!context?.suppressAiForAcquisitions;
        recordNewsInternal(league, {
          type: 'signing',
          teamId,
          text: `${getTeamIdentity(teamId)?.abbr || teamId} sign ${assigned.firstName} ${assigned.lastName} (${targetRole})`,
          detail: 'Emergency roster fill despite cap crunch',
          seasonNumber: league.seasonNumber || null,
          playerId: assigned.id,
          playerName: `${assigned.firstName} ${assigned.lastName}`.trim(),
          role: targetRole,
          contractSummary: summarizeContractForNews(assigned.contract),
          ...(Object.keys(newsContext).length ? { context: newsContext } : {}),
          ...(suppressAi ? {
            aiSuppressed: true,
            aiSuppressReason: context?.aiSuppressReason || 'inaugural-offseason',
          } : {}),
        });
        if (context?.events) {
          const identity = getTeamIdentity(teamId)?.abbr || teamId;
          context.events.push(`${identity} exceed the cap to add ${assigned.firstName} ${assigned.lastName} (${targetRole}). GM fumes.`);
        }
        ensureFreeAgentRoleCoverage(league, league.seasonNumber || 1, targetRole);
        refreshTeamMood(league, teamId);
        return assigned;
      }
    }
    if (context && moveConsumed) refundOffseasonMove(context, teamId);
    return null;
  }

  if (!ensureMoveAvailable()) {
    if (context && moveConsumed) refundOffseasonMove(context, teamId);
    return null;
  }

  const [chosen] = league.freeAgents.splice(chosenEval.index, 1);
  const assigned = { ...chosen, role: targetRole, origin: 'free-agent' };
  assigned.loyalty = clamp((assigned.loyalty ?? 0.5) * 0.6 + rand(0.22, 0.4), 0.12, 0.96);
  assigned.contract = negotiation.contract;
  applyContractToPlayer(assigned, assigned.contract);
  let removed = null;
  if (!temporaryContract && current) {
    removed = removePlayerFromRoster(league, teamId, targetRole);
    if (removed) {
      adjustPlayerMood(removed, -0.15);
      pushPlayerToFreeAgency(league, removed, targetRole, 'replaced by signing');
      const salary = Number.isFinite(removed.contract?.salary) ? removed.contract.salary : 0;
      const yearsRemaining = Number.isFinite(removed.contract?.yearsRemaining)
        ? removed.contract.yearsRemaining
        : Number.isFinite(removed.contract?.years)
          ? removed.contract.years
          : 0;
      const penaltyPerSeason = removed.contract?.temporary ? 0 : Math.round(salary * 0.1);
      const penaltyDetail = (penaltyPerSeason > 0 && yearsRemaining > 0)
        ? `Incurs ${formatCurrency(penaltyPerSeason)} cap penalty for ${yearsRemaining} season${yearsRemaining === 1 ? '' : 's'}.`
        : 'Cap impact minimal.';
      recordNewsInternal(league, {
        type: 'release',
        teamId,
        text: `${removed.firstName} ${removed.lastName} (${targetRole}) released`,
        detail: penaltyDetail,
        seasonNumber: league.seasonNumber || null,
        playerId: removed.id,
        playerName: `${removed.firstName} ${removed.lastName}`.trim(),
        role: targetRole,
      });
      if (context?.events) {
        const identity = getTeamIdentity(teamId)?.abbr || teamId;
        const awareness = (penaltyPerSeason > 0 && yearsRemaining > 0)
          ? `${formatCurrency(penaltyPerSeason)} cap hit for ${yearsRemaining} season${yearsRemaining === 1 ? '' : 's'}`
          : 'minimal cap impact';
        context.events.push(`${identity} cut ${removed.firstName} ${removed.lastName} (${targetRole}) to clear space, ${awareness}.`);
      }
    }
  }
  assignPlayerToRoster(league, teamId, targetRole, assigned);
  const newsContext = {};
  if (context?.dayNumber != null) newsContext.dayNumber = context.dayNumber;
  if (context?.totalDays != null) newsContext.totalDays = context.totalDays;
  if (context?.inaugural != null) newsContext.inaugural = context.inaugural;
  if (Object.keys(newsContext).length && newsContext.phase == null) {
    newsContext.phase = 'offseason';
  }
  const suppressAi = !!context?.suppressAiForAcquisitions;
  recordNewsInternal(league, {
    type: 'signing',
    teamId,
    text: `${getTeamIdentity(teamId)?.abbr || teamId} sign ${assigned.firstName} ${assigned.lastName} (${targetRole})`,
    detail: reason,
    seasonNumber: league.seasonNumber || null,
    playerId: assigned.id,
    playerName: `${assigned.firstName} ${assigned.lastName}`.trim(),
    role: targetRole,
    contractSummary: summarizeContractForNews(negotiation.contract),
    ...(Object.keys(newsContext).length ? { context: newsContext } : {}),
    ...(suppressAi ? {
      aiSuppressed: true,
      aiSuppressReason: context?.aiSuppressReason || 'inaugural-offseason',
    } : {}),
  });
  ensureFreeAgentRoleCoverage(league, league.seasonNumber || 1, targetRole);
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
  const games = Math.max(1, Math.round(irEntry?.gamesRemaining || irEntry?.gamesMissed || 1));
  const replacement = signBestFreeAgentForRole(league, irEntry.teamId, irEntry.role, {
    reason,
    mode,
    temporaryContract: {
      games,
      forPlayerId: irEntry.player.id,
      basis: reason || 'injury replacement',
    },
  });
  if (replacement && league.injuredReserve?.[irEntry.player.id]) {
    league.injuredReserve[irEntry.player.id].replacementId = replacement.id;
    league.injuredReserve[irEntry.player.id].replacementGames ||= 0;
    league.injuredReserve[irEntry.player.id].replacementLastGameId ||= null;
    league.injuredReserve[irEntry.player.id].temporaryContractGames = games;
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
    playerId: removed?.id || player.id,
    playerName: fullName,
    role,
    gamesMissed: Number.isFinite(gamesMissed) ? Math.max(0, Math.round(gamesMissed)) : null,
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

  const rosterAfter = ensureTeamRosterShell(league)[teamId];
  const settleTemporaryContract = (map = {}) => {
    Object.entries(map).forEach(([slot, player]) => {
      if (!player?.contract?.temporary) return;
      if (player.contract.temporaryForPlayerId && player.contract.temporaryForPlayerId !== returning.id) return;
      convertTemporaryContractToStandard(league, teamId, slot, player, { reason: 'injury replacement retained' });
    });
  };
  settleTemporaryContract(rosterAfter?.offense);
  settleTemporaryContract(rosterAfter?.defense);
  const kicker = rosterAfter?.special?.K;
  if (kicker?.contract?.temporary && (!kicker.contract.temporaryForPlayerId || kicker.contract.temporaryForPlayerId === returning.id)) {
    convertTemporaryContractToStandard(league, teamId, 'K', kicker, { reason: 'injury replacement retained' });
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

function performTrade(league, season, teamA, teamB, role, modeA, modeB, context) {
  const rosters = ensureTeamRosterShell(league);
  const side = roleSide(role);
  const playerA = side === 'offense' ? rosters[teamA]?.offense?.[role] : side === 'defense' ? rosters[teamA]?.defense?.[role] : rosters[teamA]?.special?.K;
  const playerB = side === 'offense' ? rosters[teamB]?.offense?.[role] : side === 'defense' ? rosters[teamB]?.defense?.[role] : rosters[teamB]?.special?.K;
  if (!playerA || !playerB) return false;
  if (context) {
    if (!canTeamMakeOffseasonMove(context, teamA) || !canTeamMakeOffseasonMove(context, teamB)) {
      return false;
    }
  }
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
  ensureSalaryStructures(league);
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const payrollA = recalculateTeamPayroll(league, teamA);
  const payrollB = recalculateTeamPayroll(league, teamB);
  const salaryA = playerA?.contract?.salary ?? 0;
  const salaryB = playerB?.contract?.salary ?? 0;
  if (payrollA - salaryA + salaryB > cap || payrollB - salaryB + salaryA > cap) {
    return false;
  }
  if (context) {
    if (!consumeOffseasonMove(context, teamA)) return false;
    if (!consumeOffseasonMove(context, teamB)) {
      refundOffseasonMove(context, teamA);
      return false;
    }
  }
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
    text: `${getTeamIdentity(teamB)?.abbr || teamB} trade ${playerB.firstName} ${playerB.lastName} (${role}) for ${playerA.firstName} ${playerA.lastName}`,
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

function runTradeMarket(league, season, { focusTeams, activityDial, context } = {}) {
  if (!league || !season) return;
  ensureScouts(league);
  const strategies = computeTeamStrategies(season);
  const activeTeams = Array.isArray(focusTeams) && focusTeams.length ? focusTeams : TEAM_IDS;
  const contenders = activeTeams.filter((teamId) => strategies[teamId] === 'win-now');
  const rebuilders = activeTeams.filter((teamId) => strategies[teamId] === 'future');
  if (!contenders.length || !rebuilders.length) return;
  const dial = Math.min(1, Math.max(0.2, activityDial ?? (activeTeams.length / Math.max(1, TEAM_IDS.length))));
  const baseAttempts = Math.min(3, Math.floor((contenders.length + rebuilders.length) / 4));
  const attempts = Math.max(0, Math.round(baseAttempts * dial * 0.6));
  for (let i = 0; i < attempts; i += 1) {
    const teamA = choice(contenders);
    const teamB = choice(rebuilders);
    if (!teamA || !teamB || teamA === teamB) continue;
    const role = pickTradeRole();
    performTrade(league, season, teamA, teamB, role, strategies[teamA], strategies[teamB], context);
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

function fillRosterNeeds(league, teamId, needs, { reason, mode, limitFraction, context } = {}) {
  if (!Array.isArray(needs) || !needs.length) return;
  const fraction = Number.isFinite(limitFraction)
    ? Math.min(1, Math.max(0.1, limitFraction))
    : 1;
  const limit = Math.max(1, Math.min(Math.round(needs.length * fraction), Math.ceil(2 + needs.length * 0.25)));
  needs.slice(0, limit).forEach((role) => {
    signBestFreeAgentForRole(league, teamId, role, { reason, mode, context });
  });
}

export function ensureTeamRosterComplete(league, teamId, {
  reason = 'pre-game roster fill',
  mode,
  context = null,
} = {}) {
  if (!league || !teamId) return false;
  ensureSeasonPersonnel(league, league.seasonNumber || 1);
  const rosters = ensureTeamRosterShell(league);
  const roster = rosters[teamId];
  if (!roster) return false;
  const missing = [];
  ROLES_OFF.forEach((role) => {
    if (!roster.offense?.[role]) missing.push(role);
  });
  ROLES_DEF.forEach((role) => {
    if (!roster.defense?.[role]) missing.push(role);
  });
  if (!roster.special?.K) missing.push('K');
  if (!missing.length) return false;
  const strategy = mode || teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  let filledAny = false;
  missing.forEach((role) => {
    const side = roleSide(role);
    const currentRoster = ensureTeamRosterShell(league)[teamId];
    const occupant = side === 'offense'
      ? currentRoster.offense?.[role]
      : side === 'defense'
        ? currentRoster.defense?.[role]
        : currentRoster.special?.K;
    if (occupant) return;
    const added = signBestFreeAgentForRole(league, teamId, role, {
      reason,
      mode: strategy,
      context,
    });
    if (added) filledAny = true;
  });
  return filledAny;
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
  ensureSalaryStructures(league);
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const payrollTeam = recalculateTeamPayroll(league, teamId);
  const payrollOther = recalculateTeamPayroll(league, best.otherId);
  const outgoingSalary = player?.contract?.salary ?? 0;
  const incomingSalary = best.otherPlayer?.contract?.salary ?? 0;
  if (payrollTeam - outgoingSalary + incomingSalary > cap || payrollOther - incomingSalary + outgoingSalary > cap) {
    return false;
  }
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
    text: `${getTeamIdentity(teamId)?.abbr || teamId} trade ${outgoing.firstName} ${outgoing.lastName} (${role}) for ${incoming.firstName} ${incoming.lastName} (${role}) from ${getTeamIdentity(best.otherId)?.abbr || best.otherId}`,
    seasonNumber: league.seasonNumber || null,
  });
  recordNewsInternal(league, {
    type: 'trade',
    teamId: best.otherId,
    partnerTeam: teamId,
    text: `${getTeamIdentity(best.otherId)?.abbr || best.otherId} trade ${incoming.firstName} ${incoming.lastName} (${role}) for ${outgoing.firstName} ${outgoing.lastName} (${role}) with ${getTeamIdentity(teamId)?.abbr || teamId}`,
    seasonNumber: league.seasonNumber || null,
  });
  refreshTeamMood(league, teamId);
  refreshTeamMood(league, best.otherId);
  return true;
}

function simulateRosterCuts(league, teamId, mode, context) {
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
    if (context && !canTeamMakeOffseasonMove(context, teamId, 2)) continue;
    let removed = null;
    if (context) {
      if (!consumeOffseasonMove(context, teamId)) continue;
      removed = removePlayerFromRoster(league, teamId, pick.role);
      if (!removed) {
        refundOffseasonMove(context, teamId);
        continue;
      }
    } else {
      removed = removePlayerFromRoster(league, teamId, pick.role);
    }
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
      signBestFreeAgentForRole(league, teamId, pick.role, { reason: 'replacing waived player', mode, context });
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

function computeTeamWinPct(record = {}) {
  const wins = record.wins ?? 0;
  const losses = record.losses ?? 0;
  const ties = record.ties ?? 0;
  const total = wins + losses + ties;
  if (total <= 0) return 0.5;
  return clamp((wins + ties * 0.5) / total, 0, 1);
}

function computeTeamPrestige(league, teamId) {
  if (!league || !teamId) return 0.5;
  const seasonEntry = league.seasonSnapshot?.teams?.[teamId]
    || league.season?.teams?.[teamId]
    || null;
  const record = seasonEntry?.record || {};
  const winPct = computeTeamWinPct(record);
  const mood = clamp(league.teamMoods?.[teamId]?.score ?? 0, -1, 1);
  const titles = Number.isFinite(league.teamChampionships?.[teamId]?.count)
    ? league.teamChampionships[teamId].count
    : Array.isArray(league.teamChampionships?.[teamId]?.seasons)
      ? league.teamChampionships[teamId].seasons.length
      : 0;
  const prestige = 0.45 + (winPct - 0.5) * 0.5 + mood * 0.25 + Math.min(0.08, titles * 0.02);
  return clamp(prestige, 0.2, 0.95);
}

function collectRosterEntries(roster) {
  const entries = [];
  if (!roster) return entries;
  Object.entries(roster.offense || {}).forEach(([role, player]) => { if (player) entries.push({ role, player }); });
  Object.entries(roster.defense || {}).forEach(([role, player]) => { if (player) entries.push({ role, player }); });
  if (roster.special?.K) entries.push({ role: 'K', player: roster.special.K });
  return entries;
}

function hasActiveStandardContract(player) {
  if (!player?.contract || player.contract.temporary) return false;
  const remaining = Number.isFinite(player.contract.yearsRemaining)
    ? player.contract.yearsRemaining
    : Number.isFinite(player.contract.years)
      ? player.contract.years
      : 0;
  return remaining > 0;
}

function handleFreeAgencyDepartures(league, season, context) {
  if (!league) return;
  const departures = [];
  const totalDays = context.totalDays || 5;
  const dayNumber = context.dayNumber || 1;
  const focusTeams = Array.isArray(context?.focusTeams) && context.focusTeams.length
    ? context.focusTeams
    : TEAM_IDS;
  const dial = Math.min(1, Math.max(0.2, context?.activityDial ?? (focusTeams.length / Math.max(1, TEAM_IDS.length))));
  focusTeams.forEach((teamId) => {
    const roster = ensureTeamRosterShell(league)[teamId];
    if (!roster) return;
    const record = season?.teams?.[teamId]?.record || {};
    const winPct = computeTeamWinPct(record);
    collectRosterEntries(roster).forEach(({ role, player }) => {
      if (!player) return;
      const temperament = ensurePlayerTemperament(player);
      const loyalty = ensurePlayerLoyalty(player);
      const mood = temperament?.mood ?? 0;
      const rating = player.overall ?? 60;
      let desire = 0.05 + (1 - loyalty) * 0.45;
      if (rating >= 84) desire += 0.08;
      else if (rating >= 78) desire += 0.05;
      else if (rating >= 72) desire += 0.03;
      if (mood < -0.15) desire += Math.min(0.25, (-0.15 - mood) * 0.3);
      if (winPct < 0.45) {
        desire += Math.min(0.28, (0.45 - winPct) * 0.5);
      } else if (winPct > 0.65) {
        desire -= 0.04;
      }
      if (player.currentTeamId && player.originalTeamId && player.currentTeamId !== player.originalTeamId) {
        desire -= 0.05;
      }
      if (dayNumber === totalDays) desire += 0.05;
      if (dayNumber === 1) {
        desire *= 0.7;
      }
      desire = clamp(desire * (0.3 + dial * 0.35), 0, 0.6);
      if (Math.random() < desire) {
        departures.push({ teamId, role, player });
      }
    });
  });

  if (!departures.length) return;

  context.events ||= [];
  departures.forEach(({ teamId, role, player }) => {
    if (!teamId || !player) return;
    if (hasActiveStandardContract(player)) {
      const teamIdentity = getTeamIdentity(teamId);
      const teamLabel = teamIdentity?.abbr || teamId;
      const firstName = player.firstName || player.profile?.firstName || 'Player';
      const lastName = player.lastName || player.profile?.lastName || '';
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
      const traded = attemptTradeForUnhappyPlayer(league, teamId, role, player);
      if (traded) {
        context.events.push(`${fullName} traded after requesting a move from ${teamLabel}.`);
        return;
      }
      adjustPlayerMood(player, -0.18);
      player.loyalty = clamp((player.loyalty ?? 0.5) * 0.92, 0, 1);
      recordNewsInternal(league, {
        type: 'rumor',
        teamId,
        text: `${fullName} (${role}) requests a trade but remains with the team`,
        detail: `${teamLabel} hold firm to the existing contract`,
        seasonNumber: league.seasonNumber || null,
      });
      context.events.push(`${fullName} requests a trade from ${teamLabel}, but remains under contract.`);
      refreshTeamMood(league, teamId);
      return;
    }
    if (context && !consumeOffseasonMove(context, teamId)) return;
    const removed = removePlayerFromRoster(league, teamId, role) || player;
    if (!removed && context) {
      refundOffseasonMove(context, teamId);
    }
    if (!removed) return;
    adjustPlayerMood(removed, -0.25);
    removed.loyalty = clamp((removed.loyalty ?? 0.5) * 0.88, 0, 1);
    pushPlayerToFreeAgency(league, removed, role, 'requested release');
    const teamIdentity = getTeamIdentity(teamId)?.abbr || teamId;
    recordNewsInternal(league, {
      type: 'free-agent',
      teamId,
      text: `${removed.firstName} ${removed.lastName} (${role}) enters free agency`,
      detail: `${teamIdentity} respect the player\'s request to test the market`,
      seasonNumber: league.seasonNumber || null,
    });
    context.events.push(`${removed.firstName} ${removed.lastName} is exploring the market after leaving ${teamIdentity}.`);
    refreshTeamMood(league, teamId);
  });
}

function evaluateTeamInterestForPlayer(league, season, teamId, role, player) {
  const roster = ensureTeamRosterShell(league)[teamId];
  const side = roleSide(role);
  const occupant = side === 'offense'
    ? roster?.offense?.[role] || null
    : side === 'defense'
      ? roster?.defense?.[role] || null
      : roster?.special?.K || null;
  const strategy = teamStrategyFromRecord(season?.teams?.[teamId]);
  const playerValue = evaluatePlayerTrueValue(player, strategy);
  const incumbentValue = occupant ? evaluatePlayerTrueValue(occupant, strategy) : 40;
  let interest = playerValue - incumbentValue;
  if (!occupant) interest += 8;
  else if (occupant.overall < 60) interest += 3.5;
  const mood = league.teamMoods?.[teamId]?.score ?? 0;
  interest += mood * 1.4;
  const winPct = computeTeamWinPct(season?.teams?.[teamId]?.record || {});
  interest += (winPct - 0.5) * 3.5;
  interest += rand(-1.5, 1.5);
  return interest;
}

function computePlayerContractPreference(player, contract, {
  prestige = 0.5,
  loyalty = 0.5,
  teamNeed = 0,
  returning = false,
  multiOfferBonus = 0,
} = {}) {
  const totalMillions = (contract.totalValue || 0) / 1_000_000;
  const stability = (contract.years ?? 1) * 0.6 + (contract.yearsRemaining ?? contract.years ?? 1) * 0.2;
  let score = totalMillions;
  score += stability * (0.4 + loyalty * 0.25);
  score += prestige * 2.4;
  if (returning) score += loyalty * 1.6;
  score += Math.max(0, teamNeed) * 1.2;
  score += multiOfferBonus;
  return score;
}

function computeContractDemand(league, teamId, player, { teamNeedScore = 0, prestige = 0.5, returning = false } = {}) {
  const baseSalary = computeBaseSalary(player, league);
  const loyalty = ensurePlayerLoyalty(player);
  const temperament = ensurePlayerTemperament(player);
  const mood = temperament?.mood ?? 0;
  const role = player.role || player.preferredRole || 'WR1';
  const bargain = isBargainPlayer(player);
  const minimum = minimumSalaryForPlayer(player);
  let overall = Number.isFinite(player.overall) ? player.overall : null;
  if (!Number.isFinite(overall)) {
    const ratingSource = player.ratings || player.attrs || null;
    if (ratingSource) overall = computeOverallFromRatings(ratingSource, role);
  }
  if (!Number.isFinite(overall)) overall = 65;
  let adjustedBase = baseSalary;
  if (player.punishmentReplacement) {
    return {
      baseSalary,
      ask: minimum,
      floor: minimum,
      preferredYears: 1,
      loyalty,
      mood,
    };
  }
  if (bargain) {
    adjustedBase = Math.max(minimum, baseSalary * 0.25);
  }
  let ask = adjustedBase;
  if (overall >= 88) ask *= 1.28;
  else if (overall >= 82) ask *= 1.18;
  else if (overall >= 76) ask *= 1.1;
  if (player.type === 'prospect' || (player.potential ?? 0) > (overall / 100 + 0.12)) {
    ask *= 1.08;
  }
  ask *= 1 + (1 - loyalty) * 0.28;
  if (returning) {
    ask *= 1 - loyalty * 0.08;
  }
  ask *= 1 + Math.max(0, -mood) * 0.12;
  const preferredYears = determinePreferredContractLength(resolvePlayerAge(league, player), player);
  let floor = adjustedBase * (0.74 + loyalty * 0.18);
  floor *= 1 - Math.min(0.12, prestige * 0.08);
  floor *= 1 - Math.min(0.08, teamNeedScore * 0.05);
  floor = Math.max(minimum, Math.min(floor, ask * 0.95));
  let normalizedYears = preferredYears;
  if (bargain) {
    ask = Math.max(minimum, Math.min(ask, adjustedBase * 0.8));
    floor = minimum;
    normalizedYears = Math.max(1, Math.min(2, preferredYears));
  }
  return { baseSalary, ask, floor, preferredYears: normalizedYears, loyalty, mood };
}

function negotiateContractForTeam(league, teamId, player, {
  teamNeedScore = 0,
  seasonNumber,
  basis = 'free-agent',
  multiOfferBonus = 0,
  replacingSalary = 0,
  capReservation = 0,
} = {}) {
  ensureSalaryStructures(league);
  if (!teamId || !player) return null;
  const cap = Number.isFinite(league.salaryCap) ? league.salaryCap : DEFAULT_SALARY_CAP;
  const outgoingRelief = Math.max(0, replacingSalary);
  const payroll = Math.max(0, recalculateTeamPayroll(league, teamId) - outgoingRelief);
  const capSpace = Math.max(0, cap - payroll);
  const reserved = Math.max(0, capReservation);
  const effectiveCapSpace = Math.max(0, capSpace - reserved);
  const minimum = minimumSalaryForPlayer(player);
  if (effectiveCapSpace < minimum) return null;
  const prestige = computeTeamPrestige(league, teamId);
  const returning = player.currentTeamId === teamId || player.originalTeamId === teamId;
  const demand = computeContractDemand(league, teamId, player, { teamNeedScore, prestige, returning });
  const maxAnnual = Math.min(effectiveCapSpace, cap * Math.min(0.35, 0.18 + Math.min(teamNeedScore, 1) * 0.22));
  if (maxAnnual < demand.floor - 1) return null;
  let target = demand.ask;
  const negotiationTilt = 0.35 + prestige * 0.18 + demand.loyalty * 0.22 + Math.min(teamNeedScore, 1) * 0.15;
  target -= (demand.ask - demand.floor) * negotiationTilt;
  target += demand.ask * Math.min(0.12, teamNeedScore * 0.18);
  target = clamp(target, demand.floor, demand.ask);
  target = Math.min(target, maxAnnual);
  if (target < demand.floor - 1) return null;
  let years = demand.preferredYears;
  if (teamNeedScore > 0.65 && years < MAX_CONTRACT_LENGTH) {
    years += 1;
  } else if (teamNeedScore < 0.2 && years > 1 && resolvePlayerAge(league, player) >= 31) {
    years -= 1;
  }
  years = Math.max(1, Math.min(MAX_CONTRACT_LENGTH, Math.round(years)));
  let salary = adjustSalaryForTerm(target, demand.preferredYears, years);
  salary = clamp(salary, demand.floor, demand.ask);
  salary = Math.min(salary, maxAnnual);
  if (salary < demand.floor - 1 && years > 1) {
    years = Math.max(1, years - 1);
    salary = adjustSalaryForTerm(target, demand.preferredYears, years);
    salary = clamp(salary, demand.floor, demand.ask);
    salary = Math.min(salary, maxAnnual);
  }
  if (salary < demand.floor - 1) return null;
  const contract = finalizeContract({
    teamId,
    salary,
    years,
    startSeason: seasonNumber,
    basis,
    loyaltyAdjustment: demand.loyalty,
    demandSnapshot: {
      ask: Math.round(demand.ask),
      floor: Math.round(demand.floor),
      preferredYears: demand.preferredYears,
    },
    minimumSalary: minimum,
  });
  const preference = computePlayerContractPreference(player, contract, {
    prestige,
    loyalty: demand.loyalty,
    teamNeed: teamNeedScore,
    returning,
    multiOfferBonus,
  });
  return {
    contract,
    preference,
    capSpace: Math.max(0, capSpace - contract.salary),
    demand,
  };
}

function generateInitialContract(league, teamId, player) {
  ensureSalaryStructures(league);
  const baseSalary = computeBaseSalary(player, league);
  const loyalty = ensurePlayerLoyalty(player);
  const preferredYears = determinePreferredContractLength(resolvePlayerAge(league, player), player);
  let years = Math.round(preferredYears + rand(-0.5, 1.2));
  years = Math.max(1, Math.min(MAX_CONTRACT_LENGTH, years));
  let salary = baseSalary * (0.9 + rand(-0.08, 0.08));
  salary *= 1 - loyalty * 0.05;
  const minimum = minimumSalaryForPlayer(player);
  return finalizeContract({
    teamId,
    salary,
    years,
    startSeason: league.seasonNumber || 1,
    basis: 'franchise',
    loyaltyAdjustment: loyalty,
    demandSnapshot: {
      ask: Math.round(baseSalary),
      floor: Math.round(baseSalary * 0.85),
      preferredYears,
    },
    minimumSalary: minimum,
  });
}

function signFreeAgentToTeam(league, player, teamId, role, context, reason, negotiationOverride = null) {
  if (!league || !player || !teamId || !role) return;
  const strategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
  const roster = ensureTeamRosterShell(league)[teamId];
  const side = roleSide(role);
  const incumbent = side === 'offense' ? roster.offense[role] : side === 'defense' ? roster.defense[role] : roster.special.K;
  const incumbentValue = incumbent ? evaluatePlayerTrueValue(incumbent, strategy) : null;
  const candidateValue = evaluatePlayerTrueValue(player, strategy);
  const teamNeedScore = computeTeamNeedScore(incumbentValue, candidateValue);
  const negotiation = negotiationOverride || negotiateContractForTeam(league, teamId, player, {
    teamNeedScore: Math.max(teamNeedScore, incumbent ? 0 : 1),
    seasonNumber: league.seasonNumber || 1,
    basis: reason || 'free-agent',
    replacingSalary: incumbent?.contract?.salary ?? 0,
  });
  if (!negotiation) {
    return;
  }
  if (context && !canTeamMakeOffseasonMove(context, teamId)) return;
  const index = league.freeAgents.findIndex((entry) => entry?.id === player.id);
  const [chosen] = index >= 0 ? league.freeAgents.splice(index, 1) : [player];
  if (context && !consumeOffseasonMove(context, teamId)) {
    if (index >= 0) {
      league.freeAgents.splice(index, 0, chosen);
    }
    return;
  }
  const assigned = { ...chosen, role, origin: 'free-agent' };
  assigned.loyalty = clamp((assigned.loyalty ?? 0.5) * 0.6 + rand(0.22, 0.4), 0.12, 0.96);
  assigned.contract = negotiation.contract;
  applyContractToPlayer(assigned, assigned.contract);
  assignPlayerToRoster(league, teamId, role, assigned);
  const identity = getTeamIdentity(teamId)?.abbr || teamId;
  const newsContext = {};
  if (context?.dayNumber != null) newsContext.dayNumber = context.dayNumber;
  if (context?.totalDays != null) newsContext.totalDays = context.totalDays;
  if (context?.inaugural != null) newsContext.inaugural = context.inaugural;
  if (Object.keys(newsContext).length && newsContext.phase == null) {
    newsContext.phase = 'offseason';
  }
  const suppressAi = !!context?.suppressAiForAcquisitions;
  recordNewsInternal(league, {
    type: 'signing',
    teamId,
    text: `${identity} sign ${assigned.firstName} ${assigned.lastName} (${role})`,
    detail: reason || 'Offseason acquisition',
    seasonNumber: league.seasonNumber || null,
    playerId: assigned.id,
    playerName: `${assigned.firstName} ${assigned.lastName}`.trim(),
    role,
    contractSummary: summarizeContractForNews(negotiation.contract),
    ...(Object.keys(newsContext).length ? { context: newsContext } : {}),
    ...(suppressAi ? {
      aiSuppressed: true,
      aiSuppressReason: context?.aiSuppressReason || 'inaugural-offseason',
    } : {}),
  });
  context.events ||= [];
  context.events.push(`${assigned.firstName} ${assigned.lastName} chooses ${identity}, stirring hot-stove debate.`);
  refreshTeamMood(league, teamId);
}

function attemptFreeAgentSignings(league, season, context) {
  if (!league?.freeAgents?.length) return;
  const focusTeams = Array.isArray(context?.focusTeams) && context.focusTeams.length
    ? context.focusTeams
    : TEAM_IDS;
  if (!focusTeams.length) return;
  const dial = Math.min(1, Math.max(0.2, context?.activityDial ?? (focusTeams.length / Math.max(1, TEAM_IDS.length))));
  const candidates = league.freeAgents
    .map((player) => ({
      player,
      rating: player.overall ?? evaluatePlayerTrueValue(player, 'balanced'),
      role: player.role || 'WR1',
    }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  const limitFraction = 0.05 + dial * 0.15;
  const maxCandidates = Math.max(1, Math.round(candidates.length * limitFraction));

  candidates.slice(0, maxCandidates).forEach(({ player, rating, role }) => {
    const interestBoard = focusTeams.map((teamId) => ({
      teamId,
      interest: evaluateTeamInterestForPlayer(league, season, teamId, role, player),
    })).sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0));
    const best = interestBoard[0];
    if (!best) return;
    const threshold = rating >= 85 ? -0.5 : rating >= 80 ? 0 : rating >= 75 ? 0.35 : rating >= 70 ? 0.6 : 1.05;
    const patiencePenalty = (1 - dial) * 0.45;
    if (best.interest <= threshold + patiencePenalty) return;
    const contenders = interestBoard
      .filter((entry, index) => {
        if (index === 0) return true;
        return (entry.interest ?? -Infinity) >= (best.interest ?? 0) - 0.6;
      })
      .slice(0, 4);
    const offers = contenders
      .map(({ teamId, interest }, index) => {
        if (context && !canTeamMakeOffseasonMove(context, teamId)) return null;
        const strategy = teamStrategyFromRecord(league?.seasonSnapshot?.teams?.[teamId]);
        const roster = ensureTeamRosterShell(league)[teamId];
        const side = roleSide(role);
        const incumbent = side === 'offense'
          ? roster.offense[role]
          : side === 'defense'
            ? roster.defense[role]
            : roster.special.K;
        const incumbentValue = incumbent ? evaluatePlayerTrueValue(incumbent, strategy) : null;
        const candidateValue = evaluatePlayerTrueValue(player, strategy);
        const needScore = computeTeamNeedScore(incumbentValue, candidateValue);
        const negotiation = negotiateContractForTeam(league, teamId, player, {
          teamNeedScore: Math.max(needScore, incumbent ? 0 : 1),
          seasonNumber: league.seasonNumber || 1,
          basis: 'free-agent',
          multiOfferBonus: index === 0 ? 0.6 : 0,
          replacingSalary: incumbent?.contract?.salary ?? 0,
        });
        if (!negotiation) return null;
        return { teamId, negotiation, interest };
      })
      .filter(Boolean)
      .sort((a, b) => (b.negotiation.preference ?? 0) - (a.negotiation.preference ?? 0));
    const chosen = offers[0];
    if (!chosen) return;
    signFreeAgentToTeam(league, player, chosen.teamId, role, context, 'Free agent market splash', chosen.negotiation);
  });
}

export function advanceContractsForNewSeason(league) {
  if (!league) return;
  ensureSalaryStructures(league);
  const expirations = [];
  Object.entries(league.teamRosters || {}).forEach(([teamId, roster]) => {
    const handle = (role, player) => {
      if (!player?.contract) return;
      const contract = player.contract;
      if (!Number.isFinite(contract.yearsRemaining)) {
        contract.yearsRemaining = contract.years ?? 1;
      }
      if (contract.yearsRemaining <= 0) return;
      contract.yearsRemaining -= 1;
      if (contract.yearsRemaining <= 0) {
        expirations.push({ teamId, role, player });
      } else {
        applyContractToPlayer(player, contract);
      }
    };
    Object.entries(roster?.offense || {}).forEach(([role, player]) => handle(role, player));
    Object.entries(roster?.defense || {}).forEach(([role, player]) => handle(role, player));
    if (roster?.special?.K) handle('K', roster.special.K);
  });

  const irExpirations = [];
  Object.entries(league.injuredReserve || {}).forEach(([playerId, entry]) => {
    if (!entry?.player?.contract) return;
    const contract = entry.player.contract;
    if (!Number.isFinite(contract.yearsRemaining)) {
      contract.yearsRemaining = contract.years ?? 1;
    }
    if (contract.yearsRemaining <= 0) return;
    contract.yearsRemaining -= 1;
    if (contract.yearsRemaining <= 0) {
      irExpirations.push({ playerId, entry });
    } else {
      applyContractToPlayer(entry.player, contract);
    }
  });

  expirations.forEach(({ teamId, role, player }) => {
    const removed = removePlayerFromRoster(league, teamId, role) || player;
    if (!removed) return;
    clearPlayerContract(removed);
    pushPlayerToFreeAgency(league, removed, role, 'contract expired');
    recordNewsInternal(league, {
      type: 'free-agent',
      teamId,
      text: `${getTeamIdentity(teamId)?.abbr || teamId} let ${removed.firstName} ${removed.lastName} (${role}) hit the market`,
      detail: 'Contract expired without a new agreement',
      seasonNumber: league.seasonNumber || null,
    });
  });

  irExpirations.forEach(({ playerId, entry }) => {
    const role = entry.role || findPlayerRole(ensureTeamRosterShell(league)[entry.teamId], playerId) || entry.player?.role || 'WR1';
    const injuredPlayer = entry.player;
    clearPlayerContract(injuredPlayer);
    delete league.injuredReserve[playerId];
    pushPlayerToFreeAgency(league, injuredPlayer, role, 'contract expired');
  });

  let capPenaltiesChanged = false;
  Object.entries(league.capPenalties || {}).forEach(([teamId, entries]) => {
    if (!Array.isArray(entries)) return;
    const nextEntries = entries
      .map((entry) => {
        if (!entry) return null;
        const remaining = Number.isFinite(entry.seasonsRemaining) ? entry.seasonsRemaining - 1 : 0;
        if (remaining <= 0) return null;
        return { ...entry, seasonsRemaining: remaining };
      })
      .filter(Boolean);
    if (entries.length) capPenaltiesChanged = true;
    if (nextEntries.length !== entries.length) capPenaltiesChanged = true;
    league.capPenalties[teamId] = nextEntries;
  });
  if (capPenaltiesChanged) {
    bumpCapPenaltiesVersion(league);
  }

  Object.keys(league.teamRosters || {}).forEach((teamId) => {
    recalculateTeamPayroll(league, teamId);
  });
}

function recordOffseasonPress(league, season, context, newEntries = []) {
  if (!league) return;
  const dayNumber = context.dayNumber || 1;
  const totalDays = context.totalDays || 5;
  const completedSeason = season?.seasonNumber || league.offseason?.completedSeasonNumber || league.seasonNumber || 1;
  const upcomingSeason = league.offseason?.upcomingSeasonNumber || league.seasonNumber || (completedSeason + 1);
  const championTeamId = context.championTeamId || league.offseason?.championTeamId || season?.championTeamId || null;
  const championName = championTeamId ? (getTeamIdentity(championTeamId)?.displayName || championTeamId) : 'the league';
  const highlightMoves = newEntries.filter((entry) => ['trade', 'signing', 'free-agent', 'release'].includes(entry?.type));
  const moveSummary = highlightMoves.slice(0, 3).map((entry) => entry.text).join('; ');

  const story = [];
  story.push(`Day ${dayNumber} of the ${completedSeason} offseason is underway as front offices work the phones.`);
  if (dayNumber === 1) {
    story.push(`${championName} just hoisted the BluperBowl trophy, and columnists are filing season recaps while breaking down what comes next.`);
  } else {
    story.push(`Predictions for Season ${upcomingSeason} are already flying, with analysts debating who can unseat ${championName}.`);
  }
  if (context.events?.length) {
    story.push(context.events.slice(0, 3).join(' '));
  } else if (moveSummary) {
    story.push(moveSummary);
  } else {
    story.push('The rumor mill is quiet, but scouts insist roster boards are shifting beneath the surface.');
  }
  story.push('Press row will publish fresh opinions every day of the offseason, grading trades, signings, and locker-room gambles.');

  recordNewsInternal(league, {
    type: 'press',
    text: `Press Desk: Offseason Day ${dayNumber} notebook`,
    detail: story.join(' '),
    seasonNumber: league.seasonNumber || null,
    context: { dayNumber, totalDays },
  });
}

function determineOffseasonFocusTeams(dayNumber = 1, totalDays = 5) {
  const teamCount = TEAM_IDS.length;
  if (!teamCount) return [];
  const normalizedDay = Math.max(1, Math.floor(dayNumber));
  const normalizedTotal = Math.max(1, Math.floor(totalDays));
  const baseChunk = Math.ceil(teamCount / normalizedTotal);
  const scaledChunk = Math.max(1, Math.round(baseChunk * 0.6));
  const chunkSize = Math.max(1, Math.min(teamCount, Math.max(2, scaledChunk)));
  const focus = [];
  const startIndex = ((normalizedDay - 1) * chunkSize) % teamCount;
  for (let i = 0; i < chunkSize; i += 1) {
    focus.push(TEAM_IDS[(startIndex + i) % teamCount]);
  }
  return [...new Set(focus)];
}

export const DEFAULT_OFFSEASON_DAY_DURATION_MS = 60000;
const DEFAULT_OFFSEASON_MOVE_LIMIT = 3;

function ensureOffseasonMoveLedger(context) {
  if (!context) return null;
  if (!context.teamMoves) context.teamMoves = {};
  return context.teamMoves;
}

function getOffseasonMoveLimit(context) {
  if (!context) return DEFAULT_OFFSEASON_MOVE_LIMIT;
  const limit = Number.isFinite(context.moveLimit) ? context.moveLimit : DEFAULT_OFFSEASON_MOVE_LIMIT;
  return Math.max(1, limit);
}

function canTeamMakeOffseasonMove(context, teamId, count = 1) {
  if (!context || !teamId) return true;
  const ledger = ensureOffseasonMoveLedger(context);
  if (!ledger) return true;
  const limit = getOffseasonMoveLimit(context);
  const used = ledger[teamId] || 0;
  return used + count <= limit;
}

function consumeOffseasonMove(context, teamId, count = 1) {
  if (!context || !teamId) return true;
  const ledger = ensureOffseasonMoveLedger(context);
  if (!ledger) return true;
  const limit = getOffseasonMoveLimit(context);
  const used = ledger[teamId] || 0;
  if (used + count > limit) return false;
  ledger[teamId] = used + count;
  return true;
}

function refundOffseasonMove(context, teamId, count = 1) {
  if (!context || !teamId || !context.teamMoves) return;
  const current = context.teamMoves[teamId] || 0;
  context.teamMoves[teamId] = Math.max(0, current - count);
}

function ensureOffseasonState(league, totalDays = 5) {
  if (!league) return null;
  league.offseason ||= {};
  const state = league.offseason;
  state.totalDays = totalDays;
  state.dayDurationMs = state.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS;
  return state;
}

export function advanceLeagueOffseason(league, season, context = {}) {
  if (!league) return;
  const totalDays = context.totalDays || league.offseason?.totalDays || 5;
  const dayNumber = context.dayNumber || 1;
  const focusTeams = Array.isArray(context.focusTeams) && context.focusTeams.length
    ? context.focusTeams
    : determineOffseasonFocusTeams(dayNumber, totalDays);
  const rawDial = focusTeams.length / Math.max(1, TEAM_IDS.length);
  const activityDial = Math.min(0.85, Math.max(0.15, rawDial * 0.75));
  context.focusTeams = focusTeams;
  context.activityDial = activityDial;
  context.moveLimit = getOffseasonMoveLimit(context);
  ensureOffseasonMoveLedger(context);
  processOffseasonInjuries(league);
  focusTeams.forEach((teamId) => {
    const strategy = teamStrategyFromRecord(season?.teams?.[teamId]);
    simulateRosterCuts(league, teamId, strategy, context);
  });
  handleFreeAgencyDepartures(league, season, context);
  attemptFreeAgentSignings(league, season, context);
  focusTeams.forEach((teamId) => {
    const strategy = teamStrategyFromRecord(season?.teams?.[teamId]);
    const needs = evaluateRosterNeeds(league, teamId);
    if (needs.length) {
      fillRosterNeeds(league, teamId, needs, {
        reason: 'offseason adjustments',
        mode: strategy,
        limitFraction: activityDial * 0.6,
        context,
      });
    }
  });
  runTradeMarket(league, season, { focusTeams, activityDial, context });
  evaluateStaffChanges(league, season, { focusTeams, activityDial });
  TEAM_IDS.forEach((teamId) => refreshTeamMood(league, teamId));
}

function completeLeagueOffseason(league, context = null) {
  const state = ensureOffseasonState(league);
  if (!state) return;
  state.active = false;
  state.nextDayAt = null;
  state.completedAt = Date.now();
  state.nextSeasonReady = true;
  const rosterContext = context?.suppressAiForAcquisitions
    ? {
      suppressAiForAcquisitions: true,
      aiSuppressReason: context.aiSuppressReason || 'inaugural-offseason',
      dayNumber: context.dayNumber || state.currentDay || state.totalDays || 5,
      totalDays: context.totalDays || state.totalDays || 5,
      inaugural: context.inaugural ?? state.inaugural ?? false,
    }
    : null;
  TEAM_IDS.forEach((teamId) => {
    ensureTeamRosterComplete(league, teamId, {
      reason: 'camp roster fill',
      mode: 'balanced',
      context: rosterContext,
    });
  });
  recordNewsInternal(league, {
    type: 'league',
    text: 'Offseason complete — training camp opens',
    detail: 'Teams report for camp after five days of moves, trades, and press speculation.',
    seasonNumber: league.seasonNumber || null,
  });
}

function advanceLeagueOffseasonDay(league, season) {
  const state = ensureOffseasonState(league);
  if (!state?.active) return;
  const dayNumber = (state.currentDay || 0) + 1;
  const context = {
    dayNumber,
    totalDays: state.totalDays || 5,
    championTeamId: state.championTeamId || season?.championTeamId || null,
    events: [],
    inaugural: !!state.inaugural,
  };
  if (context.inaugural && dayNumber <= (state.totalDays || 5)) {
    context.suppressAiForAcquisitions = true;
    context.aiSuppressReason = 'inaugural-offseason';
  }
  const beforeCount = Array.isArray(league.newsFeed) ? league.newsFeed.length : 0;
  advanceLeagueOffseason(league, season, context);
  const afterCount = Array.isArray(league.newsFeed) ? league.newsFeed.length : 0;
  const newEntries = Array.isArray(league.newsFeed) && afterCount > beforeCount
    ? league.newsFeed.slice(0, afterCount - beforeCount)
    : [];
  recordOffseasonPress(league, season, context, newEntries);
  state.currentDay = dayNumber;
  state.lastAdvancedAt = Date.now();
  state.log = Array.isArray(state.log) ? state.log : [];
  state.log.unshift({
    dayNumber,
    timestamp: new Date().toISOString(),
    headlines: newEntries.map((entry) => entry.text),
  });
  if (state.currentDay >= (state.totalDays || 5)) {
    completeLeagueOffseason(league, context);
  } else {
    state.nextDayAt = Date.now() + (state.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS);
  }
}

export function beginLeagueOffseason(league, season, summary = {}) {
  if (!league) return null;
  const totalDays = 5;
  const state = ensureOffseasonState(league, totalDays);
  const now = Date.now();
  const inferredCompleted = summary.completedSeasonNumber ?? season?.seasonNumber ?? league.seasonNumber ?? 1;
  const completedSeasonNumber = Number.isFinite(inferredCompleted) ? inferredCompleted : 0;
  const currentSeasonNumber = Number.isFinite(league.seasonNumber) ? league.seasonNumber : completedSeasonNumber;
  const upcomingSeasonNumber = Math.max(currentSeasonNumber, completedSeasonNumber) + 1;
  const inaugural = !!summary.inaugural || completedSeasonNumber <= 0;
  state.active = true;
  state.currentDay = 0;
  state.startedAt = now;
  state.lastAdvancedAt = now;
  state.nextDayAt = now + (state.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS);
  state.totalDays = totalDays;
  state.completedSeasonNumber = completedSeasonNumber;
  state.upcomingSeasonNumber = upcomingSeasonNumber;
  state.championTeamId = summary.championTeamId || season?.championTeamId || null;
  state.championResult = summary.championResult || season?.championResult || null;
  state.inaugural = inaugural;
  state.nextSeasonReady = false;
  state.nextSeasonStarted = false;
  state.log = [];
  league.seasonNumber = upcomingSeasonNumber;
  ensureSeasonPersonnel(league, upcomingSeasonNumber);
  recordNewsInternal(league, {
    type: 'league',
    text: 'Offseason begins',
    detail: inaugural
      ? `Teams embark on a ${totalDays}-day offseason before the inaugural season kicks off.`
      : `Teams embark on a ${totalDays}-day offseason following Season ${completedSeasonNumber}.`,
    seasonNumber: inaugural ? null : completedSeasonNumber,
  });
  return state;
}

export function progressLeagueOffseason(league, season, now = Date.now()) {
  if (!league?.offseason) {
    return { progressed: false, readyForNextSeason: false };
  }
  const state = league.offseason;
  if (!state.active) {
    const ready = !!state.nextSeasonReady && !state.nextSeasonStarted;
    return { progressed: false, readyForNextSeason: ready };
  }
  const duration = state.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS;
  if (!state.nextDayAt) {
    state.nextDayAt = (state.lastAdvancedAt || now) + duration;
  }
  let progressed = false;
  while (state.active && now >= state.nextDayAt) {
    advanceLeagueOffseasonDay(league, season);
    progressed = true;
  }
  const ready = !state.active && state.nextSeasonReady && !state.nextSeasonStarted;
  return { progressed, readyForNextSeason: ready };
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
