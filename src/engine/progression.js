import { TEAM_RED, TEAM_BLK } from './constants';
import { clamp } from './helpers';
import { buildCoachesForMatchup, blendCoachValues, coachClockSettings, buildCoachForTeam } from './coaches';

const ATTR_LIMITS = {
  speed: [4.0, 7.5],
  accel: [9, 24],
  agility: [0.4, 1.4],
  strength: [0.4, 1.6],
  awareness: [0.3, 1.5],
  catch: [0.3, 1.4],
  throwPow: [0.3, 1.5],
  throwAcc: [0.3, 1.5],
  tackle: [0.3, 1.5],
};

function clampAttr(attr, value) {
  const bounds = ATTR_LIMITS[attr];
  if (!bounds) return value;
  return clamp(value, bounds[0], bounds[1]);
}

function cloneRelationMap(rel) {
  if (!rel) return { passing: {}, rushing: {} };
  const passing = {};
  Object.entries(rel.passing || {}).forEach(([qbId, targets]) => {
    passing[qbId] = { ...targets };
  });
  const rushing = { ...rel.rushing };
  return { passing, rushing };
}

export function ensureSeasonProgression(season) {
  if (!season) return;
  if (!season.playerDevelopment) season.playerDevelopment = {};
  if (!season.relationships) season.relationships = {};
  if (!season.coachStates) season.coachStates = {};
}

function accumulateDeltas(base = {}, deltas = []) {
  const result = { ...base };
  deltas.forEach((delta) => {
    Object.entries(delta || {}).forEach(([attr, amount]) => {
      if (typeof amount !== 'number' || Number.isNaN(amount) || amount === 0) return;
      result[attr] = (result[attr] || 0) + amount;
    });
  });
  return result;
}

function applyDeltasToPlayer(player, deltas = []) {
  if (!player) return;
  const baseAttrs = player.baseAttrs ? { ...player.baseAttrs } : { ...player.attrs };
  const combined = accumulateDeltas({}, deltas);
  const next = { ...player.attrs };
  Object.entries(baseAttrs).forEach(([attr, baseVal]) => {
    const delta = combined[attr] || 0;
    next[attr] = clampAttr(attr, baseVal + delta);
  });
  player.attrs = next;
}

function applyToGroup(group, deltas, development) {
  Object.entries(group || {}).forEach(([role, player]) => {
    if (!player) return;
    const key = player.id;
    const devDelta = development?.[key] || null;
    const roleDelta = deltas.positions?.[role] || {};
    const teamDelta = deltas.team || {};
    applyDeltasToPlayer(player, [teamDelta, roleDelta, devDelta]);
  });
}

export function applyLongTermAdjustments(teams, coaches, development = {}) {
  Object.entries(teams || {}).forEach(([slot, side]) => {
    const coach = coaches?.[slot] || null;
    const offBoosts = coach?.playerBoosts?.offense || { team: {}, positions: {} };
    const defBoosts = coach?.playerBoosts?.defense || { team: {}, positions: {} };
    applyToGroup(side?.off || {}, offBoosts, development);
    applyToGroup(side?.def || {}, defBoosts, development);
  });
}

export function initializeGameDynamics(state, matchup) {
  if (!state) return;
  const slotToTeam = matchup?.slotToTeam || {};
  const teams = {};
  [TEAM_RED, TEAM_BLK].forEach((slot) => {
    const teamId = slotToTeam[slot] || slot;
    const seasonRel = state.season?.relationships?.[teamId] || { passing: {}, rushing: {} };
    teams[slot] = {
      teamId,
      relationshipValues: cloneRelationMap(seasonRel),
      passTracker: {},
      runTracker: {},
    };
  });
  state.gameDynamics = { teams };
}

function ensurePassTracker(info, qbId, targetId) {
  if (!info.passTracker[qbId]) info.passTracker[qbId] = {};
  if (!info.passTracker[qbId][targetId]) info.passTracker[qbId][targetId] = { targets: 0, completions: 0, yards: 0 };
  return info.passTracker[qbId][targetId];
}

function ensureRunTracker(info, runnerId) {
  if (!info.runTracker[runnerId]) info.runTracker[runnerId] = { attempts: 0, success: 0, yards: 0 };
  return info.runTracker[runnerId];
}

function decayTowardsZero(value, rate = 0.1) {
  if (Math.abs(value) < 1e-3) return 0;
  return value * (1 - rate);
}

export function recordPlayDynamics(state, summary, ctx) {
  if (!state?.gameDynamics) return;
  const offense = summary?.offense;
  if (!offense) return;
  const teamInfo = state.gameDynamics.teams?.[offense];
  if (!teamInfo) return;

  const qbId = ctx?.pass?.passerId || state.play?.formation?.off?.QB?.id || null;
  const targetId = ctx?.pass?.targetId || null;
  const complete = ctx?.pass?.complete || false;
  const attempt = ctx?.pass?.attempt || false;
  const gained = summary?.gained ?? 0;

  if (attempt && qbId && targetId) {
    const tracker = ensurePassTracker(teamInfo, qbId, targetId);
    tracker.targets += 1;
    if (complete) tracker.completions += 1;
    tracker.yards += gained;
    const successRate = tracker.targets > 0 ? tracker.completions / tracker.targets : 0;
    const chemistry = (teamInfo.relationshipValues.passing[qbId]?.[targetId] || 0);
    const blended = chemistry * 0.75 + (successRate - 0.5) * 0.45;
    if (!teamInfo.relationshipValues.passing[qbId]) teamInfo.relationshipValues.passing[qbId] = {};
    teamInfo.relationshipValues.passing[qbId][targetId] = clamp(blended, -0.7, 0.8);
  }

  const carrierId = summary?.carrierId || null;
  const isRun = summary?.callType === 'RUN' || (!attempt && carrierId);
  if (isRun && carrierId) {
    const tracker = ensureRunTracker(teamInfo, carrierId);
    tracker.attempts += 1;
    tracker.yards += gained;
    const achievedSticks = summary?.startToGo != null && gained >= summary.startToGo;
    const explosive = gained >= 12;
    if (achievedSticks || gained >= 4 || explosive) tracker.success += 1;
    const avg = tracker.attempts > 0 ? tracker.yards / tracker.attempts : 0;
    const momentum = clamp((avg - 4) / 6, -0.6, 0.7);
    teamInfo.relationshipValues.rushing[carrierId] = teamInfo.relationshipValues.rushing[carrierId] != null
      ? teamInfo.relationshipValues.rushing[carrierId] * 0.75 + momentum * 0.25
      : momentum;
  }
}

function updateDevelopmentEntry(map, playerId, deltaMap = {}) {
  if (!playerId) return;
  if (!map[playerId]) map[playerId] = {};
  Object.entries(deltaMap).forEach(([attr, delta]) => {
    if (typeof delta !== 'number' || Number.isNaN(delta) || delta === 0) return;
    const current = map[playerId][attr] || 0;
    const next = clamp(current + delta, -0.5, 0.65);
    if (Math.abs(next) < 1e-3) delete map[playerId][attr];
    else map[playerId][attr] = next;
  });
  if (!Object.keys(map[playerId]).length) delete map[playerId];
}

function blendSeasonRelationships(target, source, weight = 0.35) {
  Object.entries(source.passing || {}).forEach(([qbId, map]) => {
    if (!target.passing[qbId]) target.passing[qbId] = {};
    Object.entries(map).forEach(([targetId, value]) => {
      const existing = target.passing[qbId][targetId] || 0;
      target.passing[qbId][targetId] = decayTowardsZero(existing, 0.1) * (1 - weight) + value * weight;
    });
  });
  Object.entries(source.rushing || {}).forEach(([runnerId, value]) => {
    const existing = target.rushing[runnerId] || 0;
    target.rushing[runnerId] = decayTowardsZero(existing, 0.1) * (1 - weight) + value * weight;
  });
}

export function finalizeGameDynamics(state) {
  if (!state?.season || !state?.gameDynamics) return;
  ensureSeasonProgression(state.season);
  const slotToTeam = state.matchup?.slotToTeam || {};
  const devMap = state.season.playerDevelopment;

  Object.entries(state.gameDynamics.teams || {}).forEach(([slot, info]) => {
    const teamId = info.teamId || slotToTeam[slot] || null;
    if (!teamId) return;
    if (!state.season.relationships[teamId]) {
      state.season.relationships[teamId] = { passing: {}, rushing: {} };
    }
    const coach = state.coaches?.[slot] || null;
    const offenseDev = blendCoachValues(coach, 'offense', 0.22);
    const runDev = blendCoachValues(coach, 'run', 0.2);
    const qbDev = blendCoachValues(coach, 'qb', offenseDev);
    const skillDev = blendCoachValues(coach, 'skill', offenseDev);

    Object.entries(info.passTracker || {}).forEach(([qbId, targets]) => {
      Object.entries(targets || {}).forEach(([targetId, stats]) => {
        if (!targetId) return;
        const attempts = stats.targets || 0;
        if (!attempts) return;
        const completions = stats.completions || 0;
        const yards = stats.yards || 0;
        const success = completions / attempts;
        const volume = clamp(attempts / 10, 0, 1);
        const chemistryBoost = clamp((success - 0.5) * volume, -0.35, 0.4);
        if (!state.season.relationships[teamId].passing[qbId]) state.season.relationships[teamId].passing[qbId] = {};
        const existing = state.season.relationships[teamId].passing[qbId][targetId] || 0;
        const blended = existing * (1 - volume * 0.4) + chemistryBoost;
        state.season.relationships[teamId].passing[qbId][targetId] = clamp(blended, -0.6, 0.65);

        const receiverGain = clamp((success - 0.5) * volume * skillDev * 0.18 + (yards / 400) * skillDev * 0.12, -0.08, 0.12);
        if (Math.abs(receiverGain) > 1e-3) {
          updateDevelopmentEntry(devMap, targetId, {
            catch: receiverGain,
            awareness: receiverGain * 0.6,
          });
        }
        const qbGain = clamp((success - 0.5) * volume * qbDev * 0.15, -0.06, 0.1);
        if (Math.abs(qbGain) > 1e-3) {
          updateDevelopmentEntry(devMap, qbId, {
            throwAcc: qbGain,
            awareness: qbGain * 0.5,
          });
        }
      });
    });

    Object.entries(info.runTracker || {}).forEach(([runnerId, stats]) => {
      const attempts = stats.attempts || 0;
      if (!attempts) return;
      const avg = stats.yards / attempts;
      const successRate = stats.success / Math.max(1, attempts);
      const momentum = clamp(((avg - 4) * 0.12) + (successRate - 0.5) * 0.4, -0.3, 0.35);
      const existing = state.season.relationships[teamId].rushing[runnerId] || 0;
      state.season.relationships[teamId].rushing[runnerId] = clamp(existing * 0.65 + momentum, -0.55, 0.6);

      const runGain = clamp(momentum * runDev * 0.25, -0.06, 0.1);
      if (Math.abs(runGain) > 1e-3) {
        updateDevelopmentEntry(devMap, runnerId, {
          speed: runGain,
          agility: runGain * 0.8,
          strength: runGain * 0.5,
        });
      }
    });

    blendSeasonRelationships(state.season.relationships[teamId], info.relationshipValues, 0.25);
  });
}

export function prepareCoachesForMatchup(matchup, league = null) {
  if (!league?.teamCoaches) {
    return buildCoachesForMatchup(matchup);
  }
  const slotToTeam = matchup?.slotToTeam || {};
  const identities = matchup?.identities || {};
  const coaches = {};
  [TEAM_RED, TEAM_BLK].forEach((slot) => {
    const teamId = slotToTeam[slot] || slot;
    const stored = league.teamCoaches?.[teamId] || null;
    const identity = identities[slot] || stored?.identity || null;
    const base = stored ? { ...stored } : buildCoachForTeam(teamId, { slot, identity });
    coaches[slot] = { ...base, identity, teamSlot: slot };
  });
  return coaches;
}

export function coachClockPlan(coaches) {
  return {
    [TEAM_RED]: coachClockSettings(coaches?.[TEAM_RED]),
    [TEAM_BLK]: coachClockSettings(coaches?.[TEAM_BLK]),
  };
}
