import { formatRecord } from '../engine/league';
import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from '../engine/constants';
import { getTeamIdentity, TEAM_IDS } from '../engine/data/teamLibrary';
import { createTeams } from '../engine/rosters';
import { computeOverallFromRatings } from '../engine/personnel';
import { applyLongTermAdjustments, prepareCoachesForMatchup } from '../engine/progression';
import { describeTemperament, describeMood } from '../engine/temperament';
import { clamp } from '../engine/helpers';

function roundNumber(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value);
}

function buildStatLines(stat = {}) {
  const passing = stat.passing || {};
  const rushing = stat.rushing || {};
  const receiving = stat.receiving || {};
  const defense = stat.defense || {};
  const kicking = stat.kicking || {};

  const passTotal = (passing.attempts || passing.completions || passing.yards || passing.touchdowns || passing.interceptions || passing.sacks);
  const rushTotal = (rushing.attempts || rushing.yards || rushing.touchdowns);
  const recTotal = (receiving.targets || receiving.receptions || receiving.yards || receiving.touchdowns || receiving.drops);
  const defTotal = (defense.tackles || defense.sacks || defense.interceptions || defense.forcedFumbles);
  const kickTotal = (kicking.attempts || kicking.made || kicking.patAttempts || kicking.patMade);

  const passLine = passTotal
    ? `${passing.completions ?? 0}/${passing.attempts ?? 0} • ${roundNumber(passing.yards)} yds • ${passing.touchdowns ?? 0} TD / ${passing.interceptions ?? 0} INT${passing.sacks ? ` • ${passing.sacks} SK` : ''}`
    : '—';
  const rushLine = rushTotal
    ? `${rushing.attempts ?? 0} att • ${roundNumber(rushing.yards)} yds • ${rushing.touchdowns ?? 0} TD${rushing.fumbles ? ` • ${rushing.fumbles} FUM` : ''}`
    : '—';
  const recLine = recTotal
    ? `${receiving.targets ?? 0} tgt • ${receiving.receptions ?? 0} rec • ${roundNumber(receiving.yards)} yds • ${receiving.touchdowns ?? 0} TD${receiving.drops ? ` • ${receiving.drops} drop${receiving.drops === 1 ? '' : 's'}` : ''}`
    : '—';
  const defLine = defTotal
    ? `${defense.tackles ?? 0} TKL • ${defense.sacks ?? 0} SK • ${defense.interceptions ?? 0} INT${defense.forcedFumbles ? ` • ${defense.forcedFumbles} FF` : ''}`
    : '—';
  const kickLine = kickTotal
    ? `FG ${kicking.made ?? 0}/${kicking.attempts ?? 0}${kicking.long ? ` (Long ${roundNumber(kicking.long)})` : ''} • PAT ${kicking.patMade ?? 0}/${kicking.patAttempts ?? 0}`
    : '—';

  return { passing: passLine, rushing: rushLine, receiving: recLine, defense: defLine, kicking: kickLine };
}

export function createPlayerEntry(player, role, sideLabel, statsMap = {}, league = null) {
  if (!player) return null;
  const stats = statsMap[player.id] || {};
  const attrs = player.attrs ? { ...player.attrs } : null;
  const baseAttrs = player.baseAttrs ? { ...player.baseAttrs } : null;
  const profile = player.profile || {};
  const firstName = profile.firstName || player.firstName || role;
  const lastName = profile.lastName || player.lastName || '';
  const nameFromParts = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
  const fullName = profile.fullName || player.fullName || nameFromParts || role;
  const height = player.height ?? player.body?.height ?? player.phys?.height ?? null;
  const weight = player.weight ?? player.body?.weight ?? player.phys?.weight ?? null;
  const resolvedOverall = (() => {
    const rawOverall = player.overall ?? player.rating ?? null;
    const numericOverall = typeof rawOverall === 'string' ? Number.parseFloat(rawOverall) : rawOverall;
    if (numericOverall != null && !Number.isNaN(numericOverall)) {
      return Math.round(numericOverall);
    }
    const ratingSource = attrs || player.ratings || player.attrs || null;
    if (!ratingSource) return null;
    const computed = computeOverallFromRatings(ratingSource, role);
    if (computed == null || Number.isNaN(computed)) return null;
    return Math.round(computed);
  })();
  const potentialRating = player.potential != null
    ? clamp(Math.round((player.potential || 0) * 100), 0, 130)
    : null;
  const ceilingRating = player.ceiling != null
    ? clamp(Math.round((player.ceiling || player.potential || 0) * 100), 0, 135)
    : potentialRating;
  const growthGap = resolvedOverall != null && potentialRating != null ? potentialRating - resolvedOverall : null;
  const entry = {
    id: player.id,
    role,
    side: sideLabel,
    number: player.number ?? profile.number ?? null,
    name: fullName,
    firstName,
    lastName,
    stats,
    lines: buildStatLines(stats),
    attrs,
    baseAttrs,
    kicker: role === 'K',
    age: league?.playerAges?.[player.id] ?? null,
    awards: Array.isArray(league?.playerAwards?.[player.id]) ? [...league.playerAwards[player.id]] : [],
    overall: resolvedOverall,
    potentialRating,
    ceilingRating,
    growthGap,
    height: height != null ? Math.round(height) : null,
    weight: weight != null ? Math.round(weight) : null,
  };
  const irEntry = league?.injuredReserve?.[player.id] || null;
  entry.onInjuredReserve = Boolean(irEntry);
  if (irEntry) {
    entry.injury = {
      description: irEntry.description || '',
      severity: irEntry.severity || null,
      gamesRemaining: irEntry.gamesRemaining ?? null,
      status: irEntry.status || 'injury',
    };
  }
  if (player.temperament) {
    entry.temperament = { ...player.temperament };
    entry.temperamentLabel = describeTemperament(player.temperament);
    entry.moodLabel = describeMood(player.temperament.mood || 0);
    entry.moodScore = player.temperament.mood ?? 0;
  }
  if (entry.kicker) {
    entry.attrs = { maxDistance: player.maxDistance ?? null, accuracy: player.accuracy ?? null };
    entry.baseAttrs = { maxDistance: player.maxDistance ?? null, accuracy: player.accuracy ?? null };
  }
  return entry;
}

function buildRosterGroup(collection = {}, order = [], sideLabel, statsMap, league, teamId, sideKey) {
  const list = [];
  const seen = new Set();
  order.forEach((role) => {
    const player = collection[role];
    if (!player) return;
    const entry = createPlayerEntry(player, role, sideLabel, statsMap, league);
    if (entry) list.push(entry);
    seen.add(role);
  });
  Object.entries(collection).forEach(([role, player]) => {
    if (seen.has(role)) return;
    const entry = createPlayerEntry(player, role, sideLabel, statsMap, league);
    if (entry) list.push(entry);
  });
  const injuredReserve = league?.injuredReserve || {};
  Object.values(injuredReserve)
    .filter((irEntry) => {
      if (!irEntry?.player || irEntry.teamId !== teamId) return false;
      if (sideKey === 'offense') return ROLES_OFF.includes(irEntry.role);
      if (sideKey === 'defense') return ROLES_DEF.includes(irEntry.role);
      return irEntry.role === 'K';
    })
    .forEach((irEntry) => {
      if (list.some((existing) => existing.id === irEntry.player.id)) {
        return;
      }
      const injuredPlayer = createPlayerEntry(irEntry.player, irEntry.role, sideLabel, statsMap, league);
      if (injuredPlayer) {
        injuredPlayer.onInjuredReserve = true;
        injuredPlayer.injury = {
          description: irEntry.description || injuredPlayer.injury?.description || '',
          severity: irEntry.severity || injuredPlayer.injury?.severity || null,
          gamesRemaining: irEntry.gamesRemaining ?? injuredPlayer.injury?.gamesRemaining ?? null,
          status: irEntry.status || injuredPlayer.injury?.status || 'injury',
        };
        list.push(injuredPlayer);
      }
    });
  return list;
}

function buildSpecialGroup(special = {}, statsMap, league, teamId) {
  const list = [];
  if (special.K) {
    const entry = createPlayerEntry(special.K, 'K', 'Special Teams', statsMap, league);
    if (entry) list.push(entry);
  }
  const injuredReserve = league?.injuredReserve || {};
  Object.values(injuredReserve)
    .filter((irEntry) => irEntry?.player && irEntry.teamId === teamId && irEntry.role === 'K')
    .forEach((irEntry) => {
      if (list.some((existing) => existing.id === irEntry.player.id)) {
        return;
      }
      const injuredPlayer = createPlayerEntry(irEntry.player, 'K', 'Special Teams', statsMap, league);
      if (injuredPlayer) {
        injuredPlayer.onInjuredReserve = true;
        injuredPlayer.injury = {
          description: irEntry.description || injuredPlayer.injury?.description || '',
          severity: irEntry.severity || injuredPlayer.injury?.severity || null,
          gamesRemaining: irEntry.gamesRemaining ?? injuredPlayer.injury?.gamesRemaining ?? null,
          status: irEntry.status || injuredPlayer.injury?.status || 'injury',
        };
        list.push(injuredPlayer);
      }
    });
  return list;
}

function computeGroupRating(players = []) {
  if (!Array.isArray(players) || !players.length) return null;
  const totals = players.reduce(
    (acc, player) => {
      if (player?.overall == null || Number.isNaN(player.overall)) {
        return acc;
      }
      acc.count += 1;
      acc.sum += player.overall;
      return acc;
    },
    { sum: 0, count: 0 },
  );
  if (!totals.count) return null;
  return Math.round(totals.sum / totals.count);
}

function pickFallbackTeamId(teamId, availableIds = []) {
  if (!availableIds.length) return teamId;
  const idx = availableIds.indexOf(teamId);
  if (idx >= 0 && availableIds.length > 1) {
    return availableIds[(idx + 1) % availableIds.length] || teamId;
  }
  return availableIds[0] || teamId;
}

export function buildTeamDirectoryData(season, league) {
  if (!season) return [];
  const teams = Object.values(season.teams || {});
  if (!teams.length) return [];
  const availableIds = teams.map((team) => team.id).filter(Boolean);
  const statsMap = season.playerStats || {};
  const development = season.playerDevelopment || {};
  const teamTitles = league?.teamChampionships || {};
  const teamSeasonHistory = league?.teamSeasonHistory || {};

  return teams.map((team) => {
    const teamId = team.id;
    const fallbackId = pickFallbackTeamId(teamId, availableIds.length ? availableIds : TEAM_IDS);
    const matchup = {
      slotToTeam: { [TEAM_RED]: teamId, [TEAM_BLK]: fallbackId },
      identities: {
        [TEAM_RED]: getTeamIdentity(teamId) || team.info || null,
        [TEAM_BLK]: getTeamIdentity(fallbackId) || null,
      },
    };
    const rosters = createTeams(matchup, league);
    const coaches = prepareCoachesForMatchup(matchup, league);
    applyLongTermAdjustments(rosters, coaches, development);
    const identity = getTeamIdentity(teamId) || team.info || { id: teamId, displayName: teamId };
    const record = team.record || { wins: 0, losses: 0, ties: 0 };
    const titles = teamTitles[teamId]?.seasons || [];
    const historyEntries = Array.isArray(teamSeasonHistory[teamId])
      ? teamSeasonHistory[teamId]
          .map((entry) => ({
            seasonNumber: entry.seasonNumber ?? null,
            record: entry.record || { wins: 0, losses: 0, ties: 0 },
            recordText: formatRecord(entry.record),
            pointsFor: entry.pointsFor ?? 0,
            pointsAgainst: entry.pointsAgainst ?? 0,
            pointDifferential:
              entry.pointDifferential != null
                ? entry.pointDifferential
                : (entry.pointsFor ?? 0) - (entry.pointsAgainst ?? 0),
            playoffResult: entry.playoffResult || 'Regular Season',
          }))
          .sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0))
      : [];

    const group = rosters[TEAM_RED] || { off: {}, def: {}, special: {} };
    const offense = buildRosterGroup(group.off, ROLES_OFF, 'Offense', statsMap, league, teamId, 'offense');
    const defense = buildRosterGroup(group.def, ROLES_DEF, 'Defense', statsMap, league, teamId, 'defense');
    const special = buildSpecialGroup(group.special, statsMap, league, teamId);
    const offenseRating = computeGroupRating(offense);
    const defenseRating = computeGroupRating(defense);

    return {
      id: teamId,
      identity,
      record,
      recordText: formatRecord(record),
      pointsFor: team.pointsFor ?? 0,
      pointsAgainst: team.pointsAgainst ?? 0,
      mood: league?.teamMoods?.[teamId] || { score: 0, label: 'Neutral' },
      scout: league?.teamScouts?.[teamId] || null,
      coach: league?.teamCoaches?.[teamId] || coaches?.[TEAM_RED] || null,
      gm: league?.teamGms?.[teamId] || null,
      titles: titles.length,
      titleSeasons: titles.slice(),
      history: historyEntries,
      roster: {
        offense,
        defense,
        special,
      },
      offenseRating,
      defenseRating,
    };
  });
}

export function buildPlayerLookup(season, league) {
  const directory = {};
  const teams = buildTeamDirectoryData(season, league);
  teams.forEach((team) => {
    const register = (player) => {
      if (!player?.id) return;
      directory[player.id] = { player, team };
    };
    team.roster.offense.forEach(register);
    team.roster.defense.forEach(register);
    team.roster.special.forEach(register);
  });
  return { teams, directory };
}

export function buildTeamRatingMap(season, league) {
  if (!season) return {};
  const teams = buildTeamDirectoryData(season, league);
  return teams.reduce((acc, team) => {
    if (!team?.id) return acc;
    acc[team.id] = {
      offense: team.offenseRating ?? null,
      defense: team.defenseRating ?? null,
      name: team.identity?.displayName || team.identity?.name || team.id,
    };
    return acc;
  }, {});
}

