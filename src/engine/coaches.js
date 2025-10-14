import { TEAM_RED, TEAM_BLK } from './constants';
import { clamp } from './helpers';
import { getCoachDefinition } from './data/coachLibrary';

const DEFAULT_CLOCK = { hurry: 150, defensive: 120, must: 35, margin: 8 };

const DEFAULT_COACH = {
  id: 'GEN-HC',
  name: 'Interim Coach',
  philosophy: 'balanced',
  tacticalIQ: 1.0,
  playcallingIQ: 1.0,
  clock: { ...DEFAULT_CLOCK },
  playerBoosts: {
    offense: { team: {}, positions: {} },
    defense: { team: {}, positions: {} },
  },
  development: { offense: 0.2, defense: 0.2, qb: 0.2, skill: 0.2, run: 0.2 },
  tendencies: { passBias: 0, runBias: 0, aggression: 0 },
};

function cloneDeep(value) {
  if (Array.isArray(value)) return value.map(cloneDeep);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      out[k] = cloneDeep(v);
    });
    return out;
  }
  return value;
}

export function buildCoachForTeam(teamId, { slot = TEAM_RED, identity = null } = {}) {
  const base = getCoachDefinition(teamId) || DEFAULT_COACH;
  const coach = cloneDeep(base);
  coach.teamId = teamId;
  coach.teamSlot = slot;
  coach.identity = identity || null;
  coach.id ||= `${teamId}-HC`;
  coach.playcallingIQ = coach.playcallingIQ ?? coach.tacticalIQ ?? 1.0;
  coach.tendencies ||= { passBias: 0, runBias: 0, aggression: 0 };
  coach.development ||= { offense: 0.2, defense: 0.2, qb: 0.2, skill: 0.2, run: 0.2 };
  if (!coach.playerBoosts) coach.playerBoosts = { offense: { team: {}, positions: {} }, defense: { team: {}, positions: {} } };
  if (!coach.playerBoosts.offense) coach.playerBoosts.offense = { team: {}, positions: {} };
  if (!coach.playerBoosts.offense.team) coach.playerBoosts.offense.team = {};
  if (!coach.playerBoosts.offense.positions) coach.playerBoosts.offense.positions = {};
  if (!coach.playerBoosts.defense) coach.playerBoosts.defense = { team: {}, positions: {} };
  if (!coach.playerBoosts.defense.team) coach.playerBoosts.defense.team = {};
  if (!coach.playerBoosts.defense.positions) coach.playerBoosts.defense.positions = {};
  coach.clock = { ...DEFAULT_CLOCK, ...(coach.clock || {}) };
  return coach;
}

export function buildCoachesForMatchup(matchup = null) {
  const slotToTeam = matchup?.slotToTeam || {};
  const identities = matchup?.identities || {};
  return {
    [TEAM_RED]: buildCoachForTeam(slotToTeam[TEAM_RED] || TEAM_RED, { slot: TEAM_RED, identity: identities[TEAM_RED] || null }),
    [TEAM_BLK]: buildCoachForTeam(slotToTeam[TEAM_BLK] || TEAM_BLK, { slot: TEAM_BLK, identity: identities[TEAM_BLK] || null }),
  };
}

export function coachClockSettings(coach) {
  if (!coach) return { ...DEFAULT_CLOCK };
  const plan = coach.clock || {};
  return {
    hurryThreshold: plan.hurry ?? DEFAULT_CLOCK.hurry,
    defensiveThreshold: plan.defensive ?? DEFAULT_CLOCK.defensive,
    mustTimeoutThreshold: plan.must ?? DEFAULT_CLOCK.must,
    trailingMargin: plan.margin ?? DEFAULT_CLOCK.margin,
  };
}

export function blendCoachValues(coach, key, fallback = 0.2) {
  if (!coach) return fallback;
  const pool = coach.development || {};
  const raw = pool[key];
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  return fallback;
}

export function combineClockPlans(coaches = {}) {
  return {
    [TEAM_RED]: coachClockSettings(coaches[TEAM_RED]),
    [TEAM_BLK]: coachClockSettings(coaches[TEAM_BLK]),
  };
}

export function clampChemistry(value) {
  return clamp(value, -0.75, 0.85);
}
