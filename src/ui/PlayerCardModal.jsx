import React from 'react';
import Modal from './Modal';
import HoverTooltip from './HoverTooltip';
import { describeTemperament, describeMood } from '../engine/temperament';

export const ATTRIBUTE_ORDER = [
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

export const ATTRIBUTE_DESCRIPTIONS = {
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

export const PLAYER_STAT_DESCRIPTIONS = {
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

export function resolveAttributeDescription(label) {
  const normalized = (label || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return ATTRIBUTE_DESCRIPTIONS[normalized] || null;
}

export function coerceNumber(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.value != null) return coerceNumber(value.value);
    if (value.rating != null) return coerceNumber(value.rating);
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return null;
  return numeric;
}

export function formatAttrValue(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

export function formatBoostValue(value) {
  if (value == null || Number.isNaN(value)) return '0.00';
  const fixed = value.toFixed(2);
  return value > 0 ? `+${fixed}` : fixed;
}

export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    const fixed = (absolute / 1_000_000).toFixed(1);
    return `${sign}$${fixed}M`;
  }
  if (absolute >= 1_000) {
    const fixed = Math.round(absolute / 1_000);
    return `${sign}$${fixed}K`;
  }
  return `${sign}$${Math.round(absolute)}`;
}

export function formatHeight(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const inches = Math.max(0, Math.round(value));
  const feet = Math.floor(inches / 12);
  const remainder = inches % 12;
  return `${feet}'${remainder}"`;
}

export function formatWeight(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value)} lbs`;
}

function hasStatCategory(category = {}) {
  return Object.values(category).some((value) => Number.isFinite(value) && Math.abs(value) > 1e-6);
}

function roundNumber(value) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.round(value);
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

export default function PlayerCardModal({ open, onClose, entry, team }) {
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
  const metaParts = [
    teamName,
    entry.role,
    entry.side,
    entry.number != null ? `#${entry.number}` : null,
    entry.age != null ? `Age ${entry.age}` : null,
  ].filter(Boolean);
  const overallRating = (() => {
    const candidates = [
      entry.overall,
      entry.overallRating,
      entry.rating,
      entry.rating?.overall,
      entry.playerMeta?.overall,
      entry.meta?.overall,
    ];
    for (const candidate of candidates) {
      const numeric = coerceNumber(candidate);
      if (numeric != null) {
        const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
        if (!Number.isNaN(normalized)) return normalized;
      }
    }
    return null;
  })();
  const secondaryMeta = [
    overallRating != null ? `${Math.round(overallRating)} OVR` : null,
    entry.height != null ? formatHeight(entry.height) : null,
    entry.weight != null ? formatWeight(entry.weight) : null,
  ].filter(Boolean);
  const ratingBadges = [];
  if (overallRating != null) {
    ratingBadges.push({
      label: 'Overall',
      value: Math.round(overallRating),
      description: 'Current overall rating on a 0-99 scale.',
    });
  }
  if (entry.potentialRating != null) {
    ratingBadges.push({
      label: 'Potential',
      value: Math.round(entry.potentialRating),
      description: 'Projected development headroom on a 0-99 scale.',
    });
  }
  if (entry.ceilingRating != null) {
    ratingBadges.push({
      label: 'Ceiling',
      value: Math.round(entry.ceilingRating),
      description: 'Estimated maximum peak rating on a 0-99 scale.',
    });
  }
  if (entry.growthGap != null) {
    const deltaValue = entry.growthGap > 0 ? `+${entry.growthGap}` : `${entry.growthGap}`;
    ratingBadges.push({
      label: 'Growth Delta',
      value: deltaValue,
      description: 'Difference between potential and current overall rating.',
    });
  }

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
  const contract = entry.contract || null;
  const contractLines = contract
    ? [
        `${formatCurrency(contract.salary)} per year`,
        contract.years != null ? `${contract.years} yr${contract.years === 1 ? '' : 's'}` : null,
        contract.yearsRemaining != null ? `${contract.yearsRemaining} remaining` : null,
        contract.totalValue != null ? `Total ${formatCurrency(contract.totalValue)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Modal open={open} onClose={onClose} title={`Player Card • ${entry.name}`} width="min(90vw, 640px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{entry.name}</div>
          <div style={{ color: '#a5e0a5', fontSize: 14 }}>
            {metaParts.join(' • ')}
          </div>
          {secondaryMeta.length ? (
            <div style={{ color: '#cde8cd', fontSize: 12, marginTop: 2 }}>
              {secondaryMeta.join(' • ')}
            </div>
          ) : null}
          {contractLines.length ? (
            <div style={{ color: '#9bd79b', fontSize: 12, marginTop: 6 }}>
              Contract: {contractLines.join(' • ')}
            </div>
          ) : null}
          {ratingBadges.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {ratingBadges.map(({ label, value, description }) => (
                <HoverTooltip key={label} content={description}>
                  <div
                    style={{
                      background: 'rgba(7,45,7,0.7)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      minWidth: 90,
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#8fce8f', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#f2fff2' }}>{value}</div>
                  </div>
                </HoverTooltip>
              ))}
            </div>
          ) : null}
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

