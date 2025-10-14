import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { formatRecord } from '../engine/league';
import { TEAM_RED, TEAM_BLK, ROLES_OFF, ROLES_DEF } from '../engine/constants';
import { getTeamIdentity, TEAM_IDS } from '../engine/data/teamLibrary';
import { createTeams } from '../engine/rosters';
import { applyLongTermAdjustments, prepareCoachesForMatchup } from '../engine/progression';
import { describeTemperament, describeMood } from '../engine/temperament';
import HoverTooltip from './HoverTooltip';

const ATTRIBUTE_ORDER = [
  { key: 'speed', label: 'Speed' },
  { key: 'accel', label: 'Acceleration' },
  { key: 'agility', label: 'Agility' },
  { key: 'strength', label: 'Strength' },
  { key: 'awareness', label: 'Awareness' },
  { key: 'catch', label: 'Catching' },
  { key: 'throwPow', label: 'Throw Power' },
  { key: 'throwAcc', label: 'Throw Accuracy' },
  { key: 'tackle', label: 'Tackle' },
];

const ATTRIBUTE_DESCRIPTIONS = {
  speed: 'Speed determines how quickly a player moves across the field, improving pursuit angles and breakaway potential.',
  accel: 'Acceleration controls how fast a player reaches top speed after starting or changing direction.',
  acceleration: 'Acceleration controls how fast a player reaches top speed after starting or changing direction.',
  agility: 'Agility improves a player\'s ability to change direction, dodge tacklers, and stay balanced.',
  strength: 'Strength helps players fight through contact, shed blocks, and finish tackles.',
  awareness: 'Awareness drives decision making, reaction time, and positioning during plays.',
  catch: 'Catching raises how reliably a player secures the ball on targets in traffic.',
  catching: 'Catching raises how reliably a player secures the ball on targets in traffic.',
  throwpow: 'Throw power increases maximum pass distance and zip on throws.',
  throwpower: 'Throw power increases maximum pass distance and zip on throws.',
  throwacc: 'Throw accuracy tightens ball placement and reduces misfires on passes.',
  throwaccuracy: 'Throw accuracy tightens ball placement and reduces misfires on passes.',
  tackle: 'Tackle rating influences how consistently a defender can bring ball carriers to the ground.',
  maxdistance: 'Max distance sets how far a kicker can confidently attempt field goals.',
  accuracy: 'Accuracy determines how consistently a kicker can convert attempts inside their range.',
};

const PLAYER_STAT_DESCRIPTIONS = {
  'Completions / Attempts': 'Shows passing volume and efficiency for quarterbacks.',
  Yards: 'Total yardage gained in the given category.',
  Touchdowns: 'Counts scoring plays produced in the category.',
  Interceptions: 'Turnovers thrown or made against the offense.',
  Sacks: 'Number of times the quarterback was brought down behind the line of scrimmage.',
  Tackles: 'Number of ball carriers the defender successfully brought down.',
  Attempts: 'How many tries the player had in the situation, such as rushes or field goals.',
  Fumbles: 'Ball security mistakes that put the offense at risk.',
  'Forced Fumbles': 'Instances where the defender jarred the ball loose from an opponent.',
  Targets: 'Passes thrown toward the receiver.',
  Receptions: 'Catches successfully secured by the receiver.',
  Drops: 'Catchable passes that were not secured.',
  'Field Goals': 'Attempts and makes on field goals, highlighting kicking reliability.',
  Long: 'Longest successful field goal of the season.',
  PAT: 'Point-after-touchdown conversion attempts and successes.',
};

const COACH_BADGE_DESCRIPTIONS = {
  'Tactical IQ': 'Measures how well the coach adjusts formations and matchups mid-game.',
  'Playcalling IQ': 'Influences the quality and timing of offensive and defensive play calls.',
  'Pass Bias': 'Positive values favor passing plays while negative values lean toward the run.',
  'Run Bias': 'Positive values lean on the ground game while negative values open the playbook to passes.',
  Aggression: 'Controls fourth-down risk taking and overall boldness in critical moments.',
};

const SCOUT_BADGE_DESCRIPTIONS = {
  Evaluation: 'Shows how accurately the scout grades player talent and potential.',
  Development: 'Indicates how well the scout projects growth for young players.',
  Trade: 'Affects the scout\'s ability to spot favorable trade opportunities.',
  Aggression: 'Determines how assertively the scout pushes for acquisitions or roster moves.',
  'Temperament Eye': 'Represents how effectively the scout reads locker room fit and personality.',
};

function resolveAttributeDescription(label) {
  const normalized = (label || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return ATTRIBUTE_DESCRIPTIONS[normalized] || null;
}

function pickFallbackTeamId(teamId, availableIds = []) {
  if (!availableIds.length) return teamId;
  const idx = availableIds.indexOf(teamId);
  if (idx >= 0 && availableIds.length > 1) {
    return availableIds[(idx + 1) % availableIds.length] || teamId;
  }
  return availableIds[0] || teamId;
}

function roundNumber(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value);
}

function formatAttrValue(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function formatBoostValue(value) {
  if (value == null || Number.isNaN(value)) return '0.00';
  const fixed = value.toFixed(2);
  return value > 0 ? `+${fixed}` : fixed;
}

function formatNewsTimestamp(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    return '';
  }
}

function headlineType(type) {
  if (!type) return 'Update';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

function createPlayerEntry(player, role, sideLabel, statsMap = {}, league = null) {
  if (!player) return null;
  const stats = statsMap[player.id] || {};
  const attrs = player.attrs ? { ...player.attrs } : null;
  const baseAttrs = player.baseAttrs ? { ...player.baseAttrs } : null;
  const profile = player.profile || {};
  const firstName = profile.firstName || player.firstName || role;
  const lastName = profile.lastName || player.lastName || '';
  const nameFromParts = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();
  const fullName = profile.fullName || player.fullName || nameFromParts || role;
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
  };
  const irEntry = league?.injuredReserve?.[player.id] || null;
  entry.onInjuredReserve = Boolean(irEntry);
  if (irEntry) {
    entry.injury = {
      description: irEntry.description || '',
      severity: irEntry.severity || null,
      gamesRemaining: irEntry.gamesRemaining ?? null,
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
        };
        list.push(injuredPlayer);
      }
    });
  return list;
}

function buildTeamDirectoryData(season, league) {
  if (!season) return [];
  const teams = Object.values(season.teams || {});
  if (!teams.length) return [];
  const availableIds = teams.map((team) => team.id).filter(Boolean);
  const statsMap = season.playerStats || {};
  const development = season.playerDevelopment || {};
  const teamTitles = league?.teamChampionships || {};

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
    const coaches = prepareCoachesForMatchup(matchup);
    applyLongTermAdjustments(rosters, coaches, development);
    const identity = getTeamIdentity(teamId) || team.info || { id: teamId, displayName: teamId };
    const record = team.record || { wins: 0, losses: 0, ties: 0 };
    const titles = teamTitles[teamId]?.seasons || [];

    const group = rosters[TEAM_RED] || { off: {}, def: {}, special: {} };
    const offense = buildRosterGroup(group.off, ROLES_OFF, 'Offense', statsMap, league, teamId, 'offense');
    const defense = buildRosterGroup(group.def, ROLES_DEF, 'Defense', statsMap, league, teamId, 'defense');
    const special = buildSpecialGroup(group.special, statsMap, league, teamId);

    return {
      id: teamId,
      identity,
      record,
      recordText: formatRecord(record),
      pointsFor: team.pointsFor ?? 0,
      pointsAgainst: team.pointsAgainst ?? 0,
      mood: league?.teamMoods?.[teamId] || { score: 0, label: 'Neutral' },
      scout: league?.teamScouts?.[teamId] || null,
      coach: coaches?.[TEAM_RED] || null,
      titles: titles.length,
      titleSeasons: titles.slice(),
      roster: {
        offense,
        defense,
        special,
      },
    };
  });
}

function RosterSection({ title, players, onPlayerSelect }) {
  return (
    <div
      style={{
        border: '1px solid rgba(26,92,26,0.35)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(4,28,4,0.92)',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: 'rgba(10,70,10,0.85)',
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          fontSize: 14,
        }}
      >
        {title}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(6,44,6,0.95)', textAlign: 'left' }}>
              <th style={{ padding: '8px 10px' }}>Pos</th>
              <th style={{ padding: '8px 10px' }}>Player</th>
              <th style={{ padding: '8px 10px' }}>Passing</th>
              <th style={{ padding: '8px 10px' }}>Rushing</th>
              <th style={{ padding: '8px 10px' }}>Receiving</th>
              <th style={{ padding: '8px 10px' }}>Defense</th>
              <th style={{ padding: '8px 10px' }}>Kicking</th>
            </tr>
          </thead>
          <tbody>
            {players.length ? (
              players.map((player, index) => {
                const striped = index % 2 === 0;
                return (
                  <tr
                    key={player.id}
                    onClick={() => onPlayerSelect?.(player)}
                    style={{
                      background: striped ? 'rgba(7,45,7,0.78)' : 'rgba(5,32,5,0.92)',
                      cursor: 'pointer',
                      transition: 'background 160ms ease',
                    }}
                  >
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{player.role}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{player.name}</span>
                          {player.onInjuredReserve ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '2px 6px',
                                borderRadius: 999,
                                background: 'rgba(124,22,22,0.25)',
                                color: '#ff8282',
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: 0.8,
                                textTransform: 'uppercase',
                              }}
                            >
                              IR
                            </span>
                          ) : null}
                        </span>
                        <span style={{ fontSize: 11, color: '#9bd79b' }}>
                          {player.number != null ? `#${player.number}` : '—'}
                        </span>
                        {player.onInjuredReserve && (player.injury?.description || player.injury?.gamesRemaining != null) ? (
                          <span style={{ fontSize: 11, color: '#ff9f9f' }}>
                            {player.injury?.description || 'Injured'}
                            {player.injury?.gamesRemaining != null
                              ? ` • ${player.injury.gamesRemaining} game${player.injury.gamesRemaining === 1 ? '' : 's'} remaining`
                              : ''}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>{player.lines.passing}</td>
                    <td style={{ padding: '8px 10px' }}>{player.lines.rushing}</td>
                    <td style={{ padding: '8px 10px' }}>{player.lines.receiving}</td>
                    <td style={{ padding: '8px 10px' }}>{player.lines.defense}</td>
                    <td style={{ padding: '8px 10px' }}>{player.lines.kicking}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} style={{ padding: '12px 10px', textAlign: 'center', color: '#cde8cd' }}>
                  No players listed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hasStatCategory(category = {}) {
  return Object.values(category).some((value) => Number.isFinite(value) && Math.abs(value) > 1e-6);
}

function PlayerCardModal({ open, onClose, entry, team }) {
  if (!open || !entry) return null;
  const stats = entry.stats || {};
  const passing = stats.passing || {};
  const rushing = stats.rushing || {};
  const receiving = stats.receiving || {};
  const defense = stats.defense || {};
  const kicking = stats.kicking || {};
  const misc = stats.misc || {};
  const hasPassing = hasStatCategory(passing);
  const hasRushing = hasStatCategory(rushing);
  const hasReceiving = hasStatCategory(receiving);
  const hasDefense = hasStatCategory(defense);
  const hasKicking = hasStatCategory(kicking);
  const hasMisc = hasStatCategory(misc);
  const teamName = team?.identity?.displayName || team?.identity?.name || team?.identity?.id || 'Team';
  const awards = Array.isArray(entry.awards) ? entry.awards : [];
  const temperament = entry.temperament || null;
  const temperamentLabel = entry.temperamentLabel || (temperament ? describeTemperament(temperament) : null);
  const moodLabel = entry.moodLabel || (temperament ? describeMood(temperament.mood || 0) : null);

  const attrRows = entry.kicker
    ? [
        { label: 'Max Distance', base: entry.baseAttrs?.maxDistance, current: entry.attrs?.maxDistance },
        { label: 'Accuracy', base: entry.baseAttrs?.accuracy, current: entry.attrs?.accuracy },
      ]
    : ATTRIBUTE_ORDER.map(({ key, label }) => ({
        label,
        base: entry.baseAttrs?.[key],
        current: entry.attrs?.[key],
      })).filter(({ base, current }) => base != null || current != null);

  return (
    <Modal open={open} onClose={onClose} title={`Player Card • ${entry.name}`} width="min(90vw, 640px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{entry.name}</div>
          <div style={{ color: '#a5e0a5', fontSize: 14 }}>
            {teamName} • {entry.role} • {entry.side}{entry.number != null ? ` • #${entry.number}` : ''}{entry.age != null ? ` • Age ${entry.age}` : ''}
          </div>
        </div>

        {temperament ? (
          <div style={{ background: 'rgba(7,45,7,0.65)', borderRadius: 10, padding: '8px 12px', color: '#f2fff2' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Temperament</div>
            <div style={{ fontSize: 13 }}>
              {temperamentLabel || 'Unknown'} • {moodLabel || 'Neutral'} ({formatBoostValue(temperament.mood ?? 0)})
            </div>
            <div style={{ fontSize: 12, color: '#9bd79b', marginTop: 4 }}>
              Influence: {temperament.influence != null ? temperament.influence.toFixed(2) : '—'} • Volatility:{' '}
              {temperament.volatility != null ? temperament.volatility.toFixed(2) : '—'}
            </div>
          </div>
        ) : null}

        {awards.length ? (
          <div style={{ background: 'rgba(7,45,7,0.65)', borderRadius: 10, padding: '8px 12px', color: '#f2fff2' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Career Awards</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {awards.map((award) => (
                <li key={`${award.award}-${award.season}`}>
                  Season {award.season}: {award.award}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Attributes</div>
          {attrRows.length ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(6,44,6,0.9)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Attribute</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Base</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Current</th>
                </tr>
              </thead>
              <tbody>
                {attrRows.map((row) => (
                  <tr key={row.label} style={{ background: 'rgba(4,28,4,0.85)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <HoverTooltip content={resolveAttributeDescription(row.label)}>
                        <span>{row.label}</span>
                      </HoverTooltip>
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatAttrValue(row.base)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatAttrValue(row.current)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#cde8cd', fontSize: 13 }}>No attribute data available.</div>
          )}
        </div>

        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Season Totals</div>
          {hasPassing || hasRushing || hasReceiving || hasDefense || hasKicking || hasMisc ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {hasPassing ? (
                <StatBlock
                  title="Passing"
                  rows={[
                    { label: 'Completions / Attempts', value: `${passing.completions ?? 0} / ${passing.attempts ?? 0}` },
                    { label: 'Yards', value: roundNumber(passing.yards) },
                    { label: 'Touchdowns', value: passing.touchdowns ?? 0 },
                    { label: 'Interceptions', value: passing.interceptions ?? 0 },
                    { label: 'Sacks', value: passing.sacks ?? 0 },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
              {hasRushing ? (
                <StatBlock
                  title="Rushing"
                  rows={[
                    { label: 'Attempts', value: rushing.attempts ?? 0 },
                    { label: 'Yards', value: roundNumber(rushing.yards) },
                    { label: 'Touchdowns', value: rushing.touchdowns ?? 0 },
                    { label: 'Fumbles', value: rushing.fumbles ?? 0 },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
              {hasReceiving ? (
                <StatBlock
                  title="Receiving"
                  rows={[
                    { label: 'Targets', value: receiving.targets ?? 0 },
                    { label: 'Receptions', value: receiving.receptions ?? 0 },
                    { label: 'Yards', value: roundNumber(receiving.yards) },
                    { label: 'Touchdowns', value: receiving.touchdowns ?? 0 },
                    { label: 'Drops', value: receiving.drops ?? 0 },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
              {hasDefense ? (
                <StatBlock
                  title="Defense"
                  rows={[
                    { label: 'Tackles', value: defense.tackles ?? 0 },
                    { label: 'Sacks', value: defense.sacks ?? 0 },
                    { label: 'Interceptions', value: defense.interceptions ?? 0 },
                    { label: 'Forced Fumbles', value: defense.forcedFumbles ?? 0 },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
              {hasKicking ? (
                <StatBlock
                  title="Kicking"
                  rows={[
                    { label: 'Field Goals', value: `${kicking.made ?? 0} / ${kicking.attempts ?? 0}` },
                    { label: 'Long', value: roundNumber(kicking.long) },
                    { label: 'PAT', value: `${kicking.patMade ?? 0} / ${kicking.patAttempts ?? 0}` },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
              {hasMisc ? (
                <StatBlock
                  title="Miscellaneous"
                  rows={[
                    { label: 'Fumbles', value: misc.fumbles ?? 0 },
                  ]}
                  descriptions={PLAYER_STAT_DESCRIPTIONS}
                />
              ) : null}
            </div>
          ) : (
            <div style={{ color: '#cde8cd', fontSize: 13 }}>No season statistics recorded yet.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StatBlock({ title, rows, descriptions = {} }) {
  return (
    <div
      style={{
        border: '1px solid rgba(26,92,26,0.35)',
        borderRadius: 10,
        padding: '8px 12px',
        background: 'rgba(5,32,5,0.9)',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
        {rows.map(({ label, value }) => (
          <HoverTooltip
            key={label}
            content={descriptions[label]}
            wrapperStyle={{ display: 'block', width: '100%' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#9bd79b' }}>{label}</span>
              <span>{value}</span>
            </div>
          </HoverTooltip>
        ))}
      </div>
    </div>
  );
}

function BoostList({ boosts }) {
  const entries = Object.entries(boosts || {}).filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 1e-6);
  if (!entries.length) {
    return <div style={{ color: '#cde8cd', fontSize: 13 }}>None</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {entries.map(([attr, value]) => (
        <li key={attr} style={{ fontSize: 13 }}>
          <HoverTooltip content={resolveAttributeDescription(attr)}>
            <span style={{ color: '#9bd79b' }}>{attr}</span>
          </HoverTooltip>{' '}
          {formatBoostValue(value)}
        </li>
      ))}
    </ul>
  );
}

function PositionBoosts({ positions }) {
  const entries = Object.entries(positions || {});
  if (!entries.length) {
    return <div style={{ color: '#cde8cd', fontSize: 13 }}>No position-specific boosts.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([position, attrs]) => (
        <div key={position}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#a5e0a5' }}>{position}</div>
          <BoostList boosts={attrs} />
        </div>
      ))}
    </div>
  );
}

function CoachCardModal({ open, onClose, coach, team }) {
  if (!open || !coach) return null;
  const teamName = team?.displayName || team?.name || team?.id || 'Team';
  const offenseBoosts = coach.playerBoosts?.offense || { team: {}, positions: {} };
  const defenseBoosts = coach.playerBoosts?.defense || { team: {}, positions: {} };
  const tendencies = coach.tendencies || {};
  const development = coach.development || {};

  return (
    <Modal open={open} onClose={onClose} title={`Coach Card • ${coach.name}`} width="min(90vw, 640px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{coach.name}</div>
          <div style={{ color: '#a5e0a5', fontSize: 14 }}>
            {teamName} • {coach.philosophy ? coach.philosophy.charAt(0).toUpperCase() + coach.philosophy.slice(1) : 'Coach'}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
          <InfoBadge
            label="Tactical IQ"
            value={coach.tacticalIQ}
            description={COACH_BADGE_DESCRIPTIONS['Tactical IQ']}
          />
          <InfoBadge
            label="Playcalling IQ"
            value={coach.playcallingIQ}
            description={COACH_BADGE_DESCRIPTIONS['Playcalling IQ']}
          />
          <InfoBadge
            label="Pass Bias"
            value={tendencies.passBias}
            signed
            description={COACH_BADGE_DESCRIPTIONS['Pass Bias']}
          />
          <InfoBadge
            label="Run Bias"
            value={tendencies.runBias}
            signed
            description={COACH_BADGE_DESCRIPTIONS['Run Bias']}
          />
          <InfoBadge
            label="Aggression"
            value={tendencies.aggression}
            signed
            description={COACH_BADGE_DESCRIPTIONS.Aggression}
          />
        </div>

        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Development Focus</div>
          {Object.keys(development).length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
              {Object.entries(development).map(([key, value]) => {
                const content = (
                  <span style={{ background: 'rgba(7,45,7,0.75)', padding: '4px 8px', borderRadius: 8 }}>
                    <span style={{ color: '#9bd79b' }}>{key}</span>: {formatAttrValue(value)}
                  </span>
                );
                const description = resolveAttributeDescription(key);
                return (
                  <HoverTooltip key={key} content={description}>
                    {content}
                  </HoverTooltip>
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#cde8cd', fontSize: 13 }}>No development modifiers listed.</div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Offense • Team Boosts</div>
            <BoostList boosts={offenseBoosts.team} />
          </div>
          <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Offense • Position Boosts</div>
            <PositionBoosts positions={offenseBoosts.positions} />
          </div>
          <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Defense • Team Boosts</div>
            <BoostList boosts={defenseBoosts.team} />
          </div>
          <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Defense • Position Boosts</div>
            <PositionBoosts positions={defenseBoosts.positions} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function InfoBadge({ label, value, signed = false, description }) {
  if (value == null || Number.isNaN(value)) return null;
  const formatted = signed ? formatBoostValue(value) : value.toFixed(2);
  const badge = (
    <span style={{ background: 'rgba(7,45,7,0.75)', padding: '4px 8px', borderRadius: 8 }}>
      <span style={{ color: '#9bd79b' }}>{label}:</span> {formatted}
    </span>
  );
  return description ? <HoverTooltip content={description}>{badge}</HoverTooltip> : badge;
}

function ScoutCardModal({ open, onClose, scout, team }) {
  if (!open || !scout) return null;
  const teamName = team?.displayName || team?.name || team?.id || 'Team';
  const temperamentAwareness = Math.max(
    0,
    Math.min(
      1,
      ((scout.evaluation ?? 0.5) * 0.5)
        + ((scout.trade ?? 0.5) * 0.3)
        + ((1 - Math.abs((scout.aggression ?? 0.5) - 0.5)) * 0.2),
    ),
  );

  return (
    <Modal open={open} onClose={onClose} title={`Scout Card • ${scout.name}`} width="min(90vw, 520px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{scout.name}</div>
          <div style={{ color: '#a5e0a5', fontSize: 14 }}>
            {teamName} • Lead Scout
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
          <InfoBadge
            label="Evaluation"
            value={scout.evaluation}
            description={SCOUT_BADGE_DESCRIPTIONS.Evaluation}
          />
          <InfoBadge
            label="Development"
            value={scout.development}
            description={SCOUT_BADGE_DESCRIPTIONS.Development}
          />
          <InfoBadge
            label="Trade"
            value={scout.trade}
            description={SCOUT_BADGE_DESCRIPTIONS.Trade}
          />
          <InfoBadge
            label="Aggression"
            value={scout.aggression}
            signed
            description={SCOUT_BADGE_DESCRIPTIONS.Aggression}
          />
          <InfoBadge
            label="Temperament Eye"
            value={temperamentAwareness}
            description={SCOUT_BADGE_DESCRIPTIONS['Temperament Eye']}
          />
        </div>

        <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Scouting Notes</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#cde8cd' }}>
            This scout grades talent and temperament together. High temperament awareness helps identify players that fit the locker
            room and coaching style, while balanced aggression determines how assertively free agents and trade opportunities are
            pursued.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default function TeamDirectoryModal({ open, onClose, season, league = null }) {
  const teams = useMemo(() => buildTeamDirectoryData(season, league), [season, league]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [playerFocus, setPlayerFocus] = useState(null);
  const [coachFocus, setCoachFocus] = useState(null);
  const [scoutFocus, setScoutFocus] = useState(null);
  const [teamNewsOpen, setTeamNewsOpen] = useState(false);

  const teamNewsItems = useMemo(() => {
    if (!league?.newsFeed || !selectedTeamId) return [];
    return league.newsFeed
      .filter((entry) => entry.teamId === selectedTeamId || entry.partnerTeam === selectedTeamId)
      .map((entry) => {
        const ts = entry.createdAt ? new Date(entry.createdAt).getTime() : 0;
        const sortKey = Number.isNaN(ts) ? 0 : ts;
        return {
          id: entry.id || `${entry.type}-${entry.text}-${sortKey}`,
          type: headlineType(entry.type),
          text: entry.text,
          detail: entry.detail || '',
          createdAt: formatNewsTimestamp(entry.createdAt),
          sortKey,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [league, selectedTeamId]);

  useEffect(() => {
    if (!open) {
      setPlayerFocus(null);
      setCoachFocus(null);
      setScoutFocus(null);
      setTeamNewsOpen(false);
      return;
    }
    if (!teams.length) {
      setSelectedTeamId(null);
      return;
    }
    setSelectedTeamId((prev) => {
      if (prev && teams.some((team) => team.id === prev)) return prev;
      return teams[0]?.id || null;
    });
  }, [open, teams]);

  useEffect(() => {
    setTeamNewsOpen(false);
  }, [selectedTeamId]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;

  const handlePlayerSelect = (player) => {
    if (!player || !selectedTeam) return;
    setPlayerFocus({ player, team: selectedTeam });
  };

  const handleCoachOpen = () => {
    if (!selectedTeam?.coach) return;
    setCoachFocus({ coach: selectedTeam.coach, team: selectedTeam.identity });
  };

  const handleScoutOpen = () => {
    if (!selectedTeam?.scout) return;
    setScoutFocus({ scout: selectedTeam.scout, team: selectedTeam.identity });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Team Directory" width="min(98vw, 1180px)">
        {teams.length && selectedTeam ? (
          <div style={{ display: 'flex', gap: 18, alignItems: 'stretch', minHeight: 420 }}>
            <div
              style={{
                flex: '0 0 220px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: 'rgba(4,28,4,0.92)',
                border: '1px solid rgba(26,92,26,0.35)',
                borderRadius: 12,
                padding: 12,
                maxHeight: '70vh',
                overflowY: 'auto',
                minHeight: 0,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.4, marginBottom: 4 }}>Teams</div>
              {teams.map((team) => {
                const isActive = team.id === selectedTeamId;
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(26,122,26,0.6)',
                      background: isActive ? 'rgba(18,94,18,0.95)' : 'transparent',
                      color: '#f2fff2',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {team.identity?.displayName || team.identity?.name || team.id}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                overflowY: 'auto',
                maxHeight: '70vh',
                minHeight: 0,
                paddingRight: 4,
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {selectedTeam.identity?.displayName || selectedTeam.identity?.name || selectedTeam.id}
                </div>
                <div style={{ fontSize: 13, color: '#cde8cd' }}>
                  Record {selectedTeam.recordText} • PF {selectedTeam.pointsFor} • PA {selectedTeam.pointsAgainst}
                </div>
                <div style={{ fontSize: 12, color: '#b6f0b6', marginTop: 4 }}>
                  Team Mood: {selectedTeam.mood?.label || 'Neutral'} • {formatBoostValue(selectedTeam.mood?.score ?? 0)}
                </div>
                <div style={{ fontSize: 12, color: '#9bd79b', marginTop: 4 }}>
                  BluperBowl Titles: {selectedTeam.titles || 0}
                  {selectedTeam.titleSeasons?.length ? ` • Seasons ${selectedTeam.titleSeasons.join(', ')}` : ''}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setTeamNewsOpen(true)}
                    disabled={!teamNewsItems.length}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(198,255,198,0.4)',
                      background: teamNewsItems.length ? 'rgba(12,64,12,0.65)' : 'rgba(12,64,12,0.25)',
                      color: '#f2fff2',
                      fontWeight: 600,
                      cursor: teamNewsItems.length ? 'pointer' : 'not-allowed',
                      opacity: teamNewsItems.length ? 1 : 0.65,
                    }}
                  >
                    {teamNewsItems.length ? 'Show Team News' : 'No Team News'}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(8,59,8,0.8)',
                  border: '1px solid rgba(26,92,26,0.35)',
                  borderRadius: 12,
                  padding: '10px 14px',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, color: '#a5e0a5', textTransform: 'uppercase', letterSpacing: 0.4 }}>Head Coach</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {selectedTeam.coach?.name || 'Unknown Coach'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCoachOpen}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(198,255,198,0.4)',
                    background: 'transparent',
                    color: '#f2fff2',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  View Coach Card
                </button>
              </div>

              {selectedTeam.scout ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(8,59,8,0.8)',
                    border: '1px solid rgba(26,92,26,0.35)',
                    borderRadius: 12,
                    padding: '10px 14px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: '#a5e0a5', textTransform: 'uppercase', letterSpacing: 0.4 }}>Lead Scout</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {selectedTeam.scout?.name || 'Unknown Scout'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleScoutOpen}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(198,255,198,0.4)',
                      background: 'transparent',
                      color: '#f2fff2',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    View Scout Card
                  </button>
                </div>
              ) : null}

              <RosterSection title="Offense" players={selectedTeam.roster.offense} onPlayerSelect={handlePlayerSelect} />
              <RosterSection title="Defense" players={selectedTeam.roster.defense} onPlayerSelect={handlePlayerSelect} />
              <RosterSection title="Special Teams" players={selectedTeam.roster.special} onPlayerSelect={handlePlayerSelect} />
            </div>
          </div>
        ) : (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>Season data is not available yet.</div>
        )}
      </Modal>
      <PlayerCardModal
        open={!!playerFocus}
        onClose={() => setPlayerFocus(null)}
        entry={playerFocus?.player || null}
        team={playerFocus?.team || null}
        league={league}
      />
      <CoachCardModal
        open={!!coachFocus}
        onClose={() => setCoachFocus(null)}
        coach={coachFocus?.coach || null}
        team={coachFocus?.team || null}
      />
      <ScoutCardModal
        open={!!scoutFocus}
        onClose={() => setScoutFocus(null)}
        scout={scoutFocus?.scout || null}
        team={scoutFocus?.team || null}
      />
      <Modal
        open={teamNewsOpen}
        onClose={() => setTeamNewsOpen(false)}
        title={`${selectedTeam?.identity?.displayName || selectedTeam?.identity?.name || selectedTeam?.id || 'Team'} News`}
        width="min(92vw, 640px)"
      >
        {teamNewsItems.length ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              maxHeight: '60vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {teamNewsItems.map((item) => (
              <article
                key={item.id}
                style={{
                  border: '1px solid rgba(26,92,26,0.4)',
                  borderRadius: 12,
                  background: 'rgba(4,28,4,0.92)',
                  padding: '12px 16px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 700, color: '#e0ffd7', fontSize: 15, letterSpacing: 0.4 }}>
                    {item.type}
                  </div>
                  {item.createdAt ? (
                    <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.7)' }}>{item.createdAt}</div>
                  ) : null}
                </header>
                <p style={{ margin: '8px 0 4px', fontSize: 14, color: '#f0fff0', lineHeight: 1.4 }}>
                  {item.text}
                </p>
                {item.detail ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'rgba(205,232,205,0.8)' }}>{item.detail}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            No transactions or injuries have been reported for this team yet.
          </div>
        )}
      </Modal>
    </>
  );
}
