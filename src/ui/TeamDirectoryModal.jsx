import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import HoverTooltip from './HoverTooltip';
import {
  formatAttrValue,
  formatBoostValue,
  resolveAttributeDescription,
} from './PlayerCardModal';
import { usePlayerCard } from './PlayerCardProvider';
import { buildTeamDirectoryData } from './teamDirectoryData';

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

const GM_BADGE_DESCRIPTIONS = {
  Evaluation: 'Measures how sharply the GM identifies core roster strengths and weaknesses.',
  Vision: 'Influences long-term planning, roster balance, and contract strategy.',
  Culture: 'Captures how well the GM maintains a healthy locker room and organizational identity.',
  Discipline: 'Reflects willingness to enforce standards and make tough decisions.',
  Patience: 'Indicates how much time the GM affords coaches and scouts before making changes.',
  Charisma: 'Represents relationship building with players, staff, and the media.',
  Frustration: 'Tracks the current pressure level the GM is feeling internally.',
};

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

function RosterSection({ title, players, onPlayerSelect }) {
  return (
    <div
      style={{
        border: '1px solid rgba(26,92,26,0.35)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(4,28,4,0.92)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
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
          flex: '0 0 auto',
        }}
      >
        {title}
      </div>
      <div
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: '35vh',
          flex: 1,
          minHeight: 0,
        }}
      >
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
                              {player.injury?.status === 'suspension' ? 'SUS' : 'IR'}
                            </span>
                          ) : null}
                        </span>
                        <span style={{ fontSize: 11, color: '#9bd79b' }}>
                          {player.number != null ? `#${player.number}` : '—'}
                        </span>
                        {player.onInjuredReserve && (player.injury?.description || player.injury?.gamesRemaining != null) ? (
                          <span style={{ fontSize: 11, color: '#ff9f9f' }}>
                            {player.injury?.status === 'suspension' ? 'Suspended' : player.injury?.description || 'Injured'}
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
          <InfoBadge label="Overall" value={coach.overall != null ? Math.round(coach.overall) : null} precision={0} />
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

function InfoBadge({ label, value, signed = false, description, precision = 2 }) {
  if (value == null || (typeof value === 'number' && Number.isNaN(value))) return null;
  let formatted;
  if (typeof value === 'number') {
    formatted = signed ? formatBoostValue(value) : value.toFixed(precision);
  } else {
    formatted = value;
  }
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
          <InfoBadge label="Overall" value={scout.overall != null ? Math.round(scout.overall) : null} precision={0} />
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

function GMCardModal({ open, onClose, gm, team }) {
  if (!open || !gm) return null;
  const teamName = team?.displayName || team?.name || team?.id || 'Team';
  const tenureText = gm.tenure ? `${gm.tenure} season${gm.tenure === 1 ? '' : 's'} on the job` : 'New hire';
  const frustration = gm.frustration != null ? Math.max(0, Math.min(4, gm.frustration)) : null;

  return (
    <Modal open={open} onClose={onClose} title={`GM Card • ${gm.name}`} width="min(90vw, 560px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{gm.name}</div>
          <div style={{ color: '#a5e0a5', fontSize: 14 }}>
            {teamName} • General Manager
          </div>
          <div style={{ color: '#cde8cd', fontSize: 12, marginTop: 4 }}>{tenureText}</div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
          <InfoBadge label="Overall" value={gm.overall != null ? Math.round(gm.overall) : null} precision={0} />
          <InfoBadge label="Evaluation" value={gm.evaluation ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Evaluation} />
          <InfoBadge label="Vision" value={gm.vision ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Vision} />
          <InfoBadge label="Culture" value={gm.culture ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Culture} />
          <InfoBadge label="Discipline" value={gm.discipline ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Discipline} />
          <InfoBadge label="Patience" value={gm.patience ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Patience} />
          <InfoBadge label="Charisma" value={gm.charisma ?? 0.5} description={GM_BADGE_DESCRIPTIONS.Charisma} />
          {frustration != null ? (
            <InfoBadge label="Frustration" value={frustration / 4} description={GM_BADGE_DESCRIPTIONS.Frustration} />
          ) : null}
        </div>

        <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 10, padding: '10px 12px', background: 'rgba(5,32,5,0.92)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Front Office Notes</div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#cde8cd' }}>
            This GM oversees both the coaching staff and scouting department. Higher discipline scores make abrupt changes more
            likely when the team struggles, while patience grants coaches extra breathing room to execute a long-term plan.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default function TeamDirectoryModal({ open, onClose, season, league = null }) {
  const teams = useMemo(() => buildTeamDirectoryData(season, league), [season, league]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [coachFocus, setCoachFocus] = useState(null);
  const [scoutFocus, setScoutFocus] = useState(null);
  const [gmFocus, setGmFocus] = useState(null);
  const [teamNewsOpen, setTeamNewsOpen] = useState(false);
  const { openPlayerCard } = usePlayerCard();

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
      setCoachFocus(null);
      setScoutFocus(null);
      setGmFocus(null);
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
    setGmFocus(null);
  }, [selectedTeamId]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;

  const handlePlayerSelect = (player) => {
    if (!player || !selectedTeam) return;
    openPlayerCard({ entry: player, teamId: selectedTeam.id });
  };

  const handleCoachOpen = () => {
    if (!selectedTeam?.coach) return;
    setCoachFocus({ coach: selectedTeam.coach, team: selectedTeam.identity });
  };

  const handleScoutOpen = () => {
    if (!selectedTeam?.scout) return;
    setScoutFocus({ scout: selectedTeam.scout, team: selectedTeam.identity });
  };

  const handleGmOpen = () => {
    if (!selectedTeam?.gm) return;
    setGmFocus({ gm: selectedTeam.gm, team: selectedTeam.identity });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Team Directory" width="min(96vw, 1100px)">
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
                maxHeight: '75vh',
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
                maxHeight: '75vh',
                minHeight: 0,
                paddingRight: 8,
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

                <div
                  style={{
                    marginTop: 12,
                    border: '1px solid rgba(26,92,26,0.35)',
                    borderRadius: 12,
                    background: 'rgba(5,32,5,0.92)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(10,70,10,0.85)',
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      fontSize: 13,
                    }}
                  >
                    Season History
                  </div>
                  <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                    {selectedTeam.history?.length ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'rgba(6,44,6,0.95)', textAlign: 'left' }}>
                            <th style={{ padding: '6px 10px' }}>Season</th>
                            <th style={{ padding: '6px 10px' }}>Record</th>
                            <th style={{ padding: '6px 10px' }}>PF / PA</th>
                            <th style={{ padding: '6px 10px' }}>Diff</th>
                            <th style={{ padding: '6px 10px' }}>Postseason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTeam.history.map((entry, index) => {
                            const striped = index % 2 === 0;
                            const isChampion = entry.playoffResult === 'Champion';
                            return (
                              <tr
                                key={`history-${entry.seasonNumber ?? index}`}
                                style={{
                                  background: striped ? 'rgba(7,45,7,0.78)' : 'rgba(5,32,5,0.92)',
                                  color: isChampion ? '#fff2a8' : '#f2fff2',
                                  fontWeight: isChampion ? 700 : 500,
                                }}
                              >
                                <td style={{ padding: '6px 10px' }}>{entry.seasonNumber != null ? entry.seasonNumber : '—'}</td>
                                <td style={{ padding: '6px 10px' }}>{entry.recordText || '0-0'}</td>
                                <td style={{ padding: '6px 10px' }}>
                                  {entry.pointsFor} / {entry.pointsAgainst}
                                </td>
                                <td style={{ padding: '6px 10px' }}>{entry.pointDifferential}</td>
                                <td style={{ padding: '6px 10px' }}>{entry.playoffResult}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: '10px 12px', color: '#cde8cd' }}>
                        Historical results will appear once the season completes.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedTeam.gm ? (
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
                    <div style={{ fontSize: 13, color: '#a5e0a5', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      General Manager
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>
                      {selectedTeam.gm?.name || 'Unknown GM'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleGmOpen}
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
                    View GM Card
                  </button>
                </div>
              ) : null}

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
      <GMCardModal
        open={!!gmFocus}
        onClose={() => setGmFocus(null)}
        gm={gmFocus?.gm || null}
        team={gmFocus?.team || null}
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
