import { clamp, rand, choice } from './helpers';
import { TEAM_RED, TEAM_BLK } from './constants';
import { buildCoachForTeam } from './coaches';

const TEMPERAMENT_DEFS = [
  { type: 'steady', label: 'Steady', aggressionAffinity: -0.05, supportAffinity: 0.45, volatility: 0.32, influence: 0.45 },
  { type: 'fiery', label: 'Fiery', aggressionAffinity: 0.52, supportAffinity: 0.1, volatility: 0.68, influence: 0.6 },
  { type: 'calm', label: 'Calm', aggressionAffinity: -0.42, supportAffinity: 0.5, volatility: 0.35, influence: 0.38 },
  { type: 'leader', label: 'Vocal Leader', aggressionAffinity: 0.22, supportAffinity: 0.38, volatility: 0.4, influence: 0.78 },
  { type: 'sensitive', label: 'Sensitive', aggressionAffinity: -0.2, supportAffinity: 0.25, volatility: 0.72, influence: 0.52 },
  { type: 'aggressive', label: 'Aggressive', aggressionAffinity: 0.58, supportAffinity: 0.05, volatility: 0.62, influence: 0.5 },
];

const TEMPERAMENT_MAP = new Map(TEMPERAMENT_DEFS.map((entry) => [entry.type, entry]));

const ROLE_USAGE_EXPECTATION = {
  QB: 30,
  RB: 14,
  WR1: 10,
  WR2: 8,
  WR3: 6,
  TE: 6,
  LT: 2,
  LG: 2,
  C: 2,
  RG: 2,
  RT: 2,
  LE: 4,
  DT: 4,
  RTk: 4,
  RE: 4,
  LB1: 8,
  LB2: 7,
  CB1: 5,
  CB2: 5,
  S1: 5,
  S2: 5,
  NB: 4,
  K: 3,
};

const ROLE_GROUPS = {
  QB: ['QB'],
  RB: ['RB'],
  WR1: ['WR1', 'WR2', 'WR3'],
  WR2: ['WR1', 'WR2', 'WR3'],
  WR3: ['WR1', 'WR2', 'WR3'],
  TE: ['TE'],
  LT: ['LT', 'LG', 'RG', 'RT', 'C'],
  LG: ['LT', 'LG', 'RG', 'RT', 'C'],
  C: ['LT', 'LG', 'RG', 'RT', 'C'],
  RG: ['LT', 'LG', 'RG', 'RT', 'C'],
  RT: ['LT', 'LG', 'RG', 'RT', 'C'],
  LE: ['LE', 'RE', 'RTk', 'DT'],
  RE: ['LE', 'RE', 'RTk', 'DT'],
  DT: ['LE', 'RE', 'RTk', 'DT'],
  RTk: ['LE', 'RE', 'RTk', 'DT'],
  LB1: ['LB1', 'LB2', 'NB'],
  LB2: ['LB1', 'LB2', 'NB'],
  NB: ['LB1', 'LB2', 'NB', 'CB1', 'CB2'],
  CB1: ['CB1', 'CB2', 'NB'],
  CB2: ['CB1', 'CB2', 'NB'],
  S1: ['S1', 'S2'],
  S2: ['S1', 'S2'],
  K: ['K'],
};

function randomTemperamentDefinition() {
  return choice(TEMPERAMENT_DEFS);
}

function ensureTemperamentShape(temperament, fallback) {
  const base = fallback || randomTemperamentDefinition();
  const vol = clamp(temperament?.volatility ?? base.volatility + rand(-0.08, 0.08), 0.2, 1.1);
  const influence = clamp(temperament?.influence ?? base.influence + rand(-0.08, 0.08), 0.25, 1.05);
  const mood = clamp(temperament?.mood ?? rand(-0.12, 0.18), -1, 1);
  const baseline = clamp(temperament?.baseline ?? rand(-0.05, 0.05), -0.4, 0.4);
  return {
    type: temperament?.type || base.type,
    label: temperament?.label || base.label,
    mood,
    baseline,
    volatility: vol,
    influence,
  };
}

export function ensurePlayerTemperament(player) {
  if (!player) return null;
  const definition = player.temperament?.type ? TEMPERAMENT_MAP.get(player.temperament.type) : null;
  const safe = ensureTemperamentShape(player.temperament, definition || randomTemperamentDefinition());
  player.temperament = safe;
  return safe;
}

export function cloneTemperament(temperament) {
  if (!temperament) return null;
  return { ...temperament };
}

export function describeMood(score) {
  if (score <= -0.65) return 'Toxic';
  if (score <= -0.28) return 'Frustrated';
  if (score < 0.22) return 'Neutral';
  if (score < 0.55) return 'Upbeat';
  return 'Energized';
}

export function describeTemperament(temperament) {
  if (!temperament) return 'Unknown';
  return temperament.label || (TEMPERAMENT_MAP.get(temperament.type)?.label ?? 'Unknown');
}

function temperamentDefinition(temperament) {
  if (!temperament) return randomTemperamentDefinition();
  return TEMPERAMENT_MAP.get(temperament.type) || randomTemperamentDefinition();
}

function coachTemperamentProfile(coach) {
  if (!coach) return { aggression: 0, support: 0, composure: 0 };
  const profile = coach.temperamentProfile || {};
  return {
    aggression: profile.aggression ?? (coach.tendencies?.aggression ?? 0),
    support: profile.support ?? ((coach.development?.offense ?? 0.2) + (coach.development?.defense ?? 0.2) - 0.4),
    composure: profile.composure ?? ((coach.tacticalIQ ?? 1) - 1),
  };
}

function computeCoachImpact(def, profile) {
  const agg = profile.aggression || 0;
  const support = profile.support || 0;
  const composure = profile.composure || 0;
  return clamp((def.aggressionAffinity * agg * 0.6) + (def.supportAffinity * support * 0.45) + (composure * 0.12), -0.35, 0.35);
}

export function adjustPlayerMood(player, delta) {
  if (!player) return null;
  const temperament = ensurePlayerTemperament(player);
  const next = clamp((temperament.mood || 0) + delta, -1, 1);
  temperament.mood = next;
  return next;
}

export function decayPlayerMood(player, rate = 0.15) {
  if (!player) return null;
  const temperament = ensurePlayerTemperament(player);
  const mood = temperament.mood || 0;
  const baseline = temperament.baseline || 0;
  const next = clamp(mood * (1 - rate) + baseline * rate, -1, 1);
  temperament.mood = next;
  return next;
}

export function roleGroupFor(role) {
  return ROLE_GROUPS[role] || [role];
}

function collectRosterPlayers(roster) {
  const list = [];
  if (!roster) return list;
  Object.values(roster.offense || {}).forEach((player) => { if (player) list.push(player); });
  Object.values(roster.defense || {}).forEach((player) => { if (player) list.push(player); });
  if (roster.special?.K) list.push(roster.special.K);
  return list;
}

export function computeTeamMood(roster, coach, extras = {}) {
  const players = collectRosterPlayers(roster);
  if (!players.length) {
    return { score: 0, label: 'Neutral', spread: 0 };
  }
  const profile = coachTemperamentProfile(coach);
  const recordMood = clamp(extras.recordMood ?? 0, -0.4, 0.4);
  let total = 0;
  let weightTotal = 0;
  let spread = 0;
  players.forEach((player) => {
    const temperament = ensurePlayerTemperament(player);
    const def = temperamentDefinition(temperament);
    const coachImpact = computeCoachImpact(def, profile);
    const composite = clamp((temperament.mood || 0) + coachImpact + recordMood * 0.18, -1, 1);
    const weight = 1 + (temperament.influence || def.influence || 0.5) * 0.6;
    total += composite * weight;
    weightTotal += weight;
    spread += Math.abs(temperament.mood || 0) * weight;
  });
  const average = weightTotal > 0 ? total / weightTotal : 0;
  const label = describeMood(average);
  const variability = weightTotal > 0 ? spread / weightTotal : 0;
  return { score: clamp(average, -1, 1), label, spread: clamp(variability, 0, 1) };
}

function touchesFromStat(stat = {}) {
  const passing = stat.passing || {};
  const rushing = stat.rushing || {};
  const receiving = stat.receiving || {};
  const defense = stat.defense || {};
  const misc = stat.misc || {};
  let touches = 0;
  if (passing.attempts) touches += passing.attempts;
  if (rushing.attempts) touches += rushing.attempts;
  if (receiving.targets) touches += receiving.targets * 0.9 + (receiving.receptions || 0) * 0.1;
  if (defense.tackles) touches += defense.tackles * 0.7;
  if (defense.sacks) touches += defense.sacks * 1.4;
  if (defense.interceptions) touches += defense.interceptions * 2.5;
  if (misc.fumbles) touches += misc.fumbles * 0.5;
  return touches;
}

export function updateTeamTemperament(roster, statsMap = {}, context = {}) {
  const players = collectRosterPlayers(roster);
  if (!players.length) return { tradeCandidates: [] };
  const won = Boolean(context.won);
  const profile = coachTemperamentProfile(context.coach || null);
  const baseDelta = won ? 0.12 : context.tie ? 0.02 : -0.12;
  const tradeCandidates = [];
  const rippleSources = [];
  players.forEach((player) => {
    const temperament = ensurePlayerTemperament(player);
    const def = temperamentDefinition(temperament);
    const usageExpectation = ROLE_USAGE_EXPECTATION[player.role] || 3;
    const stat = statsMap[player.id] || {};
    const touches = touchesFromStat(stat);
    const usageRatio = touches / Math.max(1, usageExpectation);
    const usageDelta = usageRatio < 0.55 ? -(0.12 * (0.55 - usageRatio)) : usageRatio > 1.2 ? (0.08 * Math.min(usageRatio - 1.2, 0.6)) : 0;
    const coachImpact = computeCoachImpact(def, profile) * 0.6;
    const noise = rand(-0.03, 0.03);
    const volatility = clamp(temperament.volatility || def.volatility || 0.4, 0.2, 1.1);
    const drift = (temperament.baseline || 0) * 0.1;
    const delta = (baseDelta + usageDelta + coachImpact + noise + drift) * volatility;
    temperament.mood = clamp((temperament.mood || 0) * 0.78 + delta, -1, 1);
    if (temperament.mood <= -0.5) {
      rippleSources.push({ player, temperament, strength: Math.abs(temperament.mood) * (temperament.influence || def.influence || 0.5) });
    }
    if (temperament.mood <= -0.82 && Math.random() < 0.12 * (temperament.influence || def.influence || 0.5)) {
      tradeCandidates.push(player);
    }
  });
  if (rippleSources.length) {
    const totalStrength = rippleSources.reduce((acc, entry) => acc + entry.strength, 0);
    if (totalStrength > 0.2) {
      const ripple = clamp(totalStrength / (players.length * 1.2), 0, 0.18);
      players.forEach((player) => {
        const temperament = ensurePlayerTemperament(player);
        if (temperament.mood > -0.4) {
          temperament.mood = clamp(temperament.mood - ripple * 0.6, -1, 1);
        }
      });
    }
  }
  return { tradeCandidates };
}

export function temperamentScoutAdjustment(player, { coach = null, teamMood = null } = {}) {
  const temperament = ensurePlayerTemperament(player);
  const def = temperamentDefinition(temperament);
  const profile = coachTemperamentProfile(coach || null);
  const coachBonus = computeCoachImpact(def, profile) * 12;
  const moodBonus = (temperament.mood || 0) * 8;
  const teamBonus = (teamMood?.score || 0) * (temperament.influence || def.influence || 0.5) * 4;
  return coachBonus + moodBonus + teamBonus;
}

export function applyTeamMoodToMatchup(teams, matchup, league) {
  if (!teams || !league) return;
  const slotToTeam = matchup?.slotToTeam || {};
  [TEAM_RED, TEAM_BLK].forEach((slot) => {
    const side = teams[slot];
    if (!side) return;
    const teamId = slotToTeam[slot] || slot;
    const teamMood = league.teamMoods?.[teamId]?.score || 0;
    const boost = clamp(teamMood, -0.75, 0.75) * 0.05;
    const adjustPlayer = (player) => {
      if (!player) return;
      ensurePlayerTemperament(player);
      if (player.attrs) {
        Object.keys(player.attrs).forEach((attr) => {
          const val = player.attrs[attr];
          if (typeof val === 'number') {
            player.attrs[attr] = clamp(val * (1 + boost), 0, val > 10 ? val * 1.1 : val * 1.5);
          }
        });
      }
      player.modifiers ||= {};
      player.modifiers.morale = clamp(0.5 + teamMood * 0.4, 0.05, 0.95);
    };
    Object.values(side.off || {}).forEach(adjustPlayer);
    Object.values(side.def || {}).forEach(adjustPlayer);
    if (side.special?.K) adjustPlayer(side.special.K);
  });
}

export function resetTemperamentToNeutral(player) {
  if (!player) return;
  const temperament = ensurePlayerTemperament(player);
  temperament.mood = 0;
  temperament.baseline = clamp(temperament.baseline * 0.5, -0.25, 0.25);
}

export function gatherRoleUsageExpectations() {
  return { ...ROLE_USAGE_EXPECTATION };
}

export function getTeamCoach(league, teamId) {
  if (!teamId) return null;
  if (league?.teamCoaches?.[teamId]) return league.teamCoaches[teamId];
  try {
    return buildCoachForTeam(teamId);
  } catch (err) {
    return buildCoachForTeam(teamId);
  }
}

export default {
  ensurePlayerTemperament,
  cloneTemperament,
  describeMood,
  describeTemperament,
  computeTeamMood,
  updateTeamTemperament,
  temperamentScoutAdjustment,
  applyTeamMoodToMatchup,
  adjustPlayerMood,
  decayPlayerMood,
  resetTemperamentToNeutral,
  roleGroupFor,
  gatherRoleUsageExpectations,
  getTeamCoach,
};
