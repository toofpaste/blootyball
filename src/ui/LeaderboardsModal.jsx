import React, { useMemo, useState } from 'react';
import Modal from './Modal';

const STAT_COLUMNS = [
  { key: 'player', label: 'Player' },
  { key: 'team', label: 'Team' },
  { key: 'passingYards', label: 'Pass Yds' },
  { key: 'passingTD', label: 'Pass TD' },
  { key: 'rushingYards', label: 'Rush Yds' },
  { key: 'rushingTD', label: 'Rush TD' },
  { key: 'receivingYards', label: 'Rec Yds' },
  { key: 'receivingTD', label: 'Rec TD' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'sacks', label: 'Sacks' },
  { key: 'interceptions', label: 'INT' },
];

function buildRows(stats = {}, league = null, teams = {}) {
  const directory = league?.playerDirectory || {};
  const injuredReserve = league?.injuredReserve || {};
  return Object.entries(stats).map(([playerId, entry]) => {
    const playerMeta = directory[playerId] || {};
    const passing = entry.passing || {};
    const rushing = entry.rushing || {};
    const receiving = entry.receiving || {};
    const defense = entry.defense || {};
    const teamInfo = teams[playerMeta.team] || teams[playerMeta.teamId] || null;
    const irEntry = injuredReserve[playerId] || null;
    const irPlayer = irEntry?.player || null;
    const fallbackName = irPlayer
      ? `${irPlayer.firstName || ''}${irPlayer.lastName ? ` ${irPlayer.lastName}` : ''}`.trim() || irPlayer.fullName || playerId
      : playerId;
    return {
      playerId,
      playerName: playerMeta.fullName || playerMeta.name || fallbackName,
      teamName: teamInfo?.identity?.displayName || teamInfo?.info?.displayName || playerMeta.teamName || playerMeta.team || '—',
      passingYards: Math.round(passing.yards || 0),
      passingTD: passing.touchdowns || 0,
      rushingYards: Math.round(rushing.yards || 0),
      rushingTD: rushing.touchdowns || 0,
      receivingYards: Math.round(receiving.yards || 0),
      receivingTD: receiving.touchdowns || 0,
      tackles: defense.tackles || 0,
      sacks: defense.sacks || 0,
      interceptions: defense.interceptions || 0,
      onInjuredReserve: Boolean(irEntry),
      injury: irEntry
        ? {
            description: irEntry.description || '',
            gamesRemaining: irEntry.gamesRemaining ?? null,
          }
        : null,
    };
  });
}

function sortRows(rows, sort) {
  const { column, direction } = sort;
  const factor = direction === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const aVal = a[column] ?? 0;
    const bVal = b[column] ?? 0;
    if (aVal === bVal) return (a.playerName || '').localeCompare(b.playerName || '');
    return (aVal - bVal) * factor;
  });
}

function LeaderboardTable({ title, rows, sort, onSort }) {
  return (
    <div style={{ border: '1px solid rgba(26,92,26,0.35)', borderRadius: 12, overflow: 'hidden', background: 'rgba(4,28,4,0.92)' }}>
      <div style={{ padding: '10px 14px', background: 'rgba(10,70,10,0.85)', fontWeight: 700, fontSize: 14, letterSpacing: 0.4 }}>
        {title}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(6,44,6,0.9)', textAlign: 'left' }}>
              {STAT_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  style={{ padding: '8px 10px', cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => onSort(col.key)}
                >
                  {col.label}
                  {sort.column === col.key ? (
                    <span style={{ marginLeft: 6 }}>{sort.direction === 'asc' ? '▲' : '▼'}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => {
              const striped = index % 2 === 0;
              return (
                <tr key={row.playerId} style={{ background: striped ? 'rgba(7,45,7,0.75)' : 'rgba(5,32,5,0.9)', color: '#f2fff2' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{row.playerName}</span>
                        {row.onInjuredReserve ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'rgba(124,22,22,0.25)',
                              color: '#ff8282',
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: 0.8,
                              textTransform: 'uppercase',
                            }}
                          >
                            IR
                          </span>
                        ) : null}
                      </span>
                      {row.onInjuredReserve && (row.injury?.description || row.injury?.gamesRemaining != null) ? (
                        <span style={{ fontSize: 11, fontWeight: 400, color: '#ff9f9f' }}>
                          {row.injury?.description || 'Injured'}
                          {row.injury?.gamesRemaining != null
                            ? ` • ${row.injury.gamesRemaining} game${row.injury.gamesRemaining === 1 ? '' : 's'} remaining`
                            : ''}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>{row.teamName}</td>
                  <td style={{ padding: '8px 10px' }}>{row.passingYards}</td>
                  <td style={{ padding: '8px 10px' }}>{row.passingTD}</td>
                  <td style={{ padding: '8px 10px' }}>{row.rushingYards}</td>
                  <td style={{ padding: '8px 10px' }}>{row.rushingTD}</td>
                  <td style={{ padding: '8px 10px' }}>{row.receivingYards}</td>
                  <td style={{ padding: '8px 10px' }}>{row.receivingTD}</td>
                  <td style={{ padding: '8px 10px' }}>{row.tackles}</td>
                  <td style={{ padding: '8px 10px' }}>{row.sacks}</td>
                  <td style={{ padding: '8px 10px' }}>{row.interceptions}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={STAT_COLUMNS.length} style={{ padding: '12px 10px', textAlign: 'center', color: '#cde8cd' }}>
                  No statistics available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LeaderboardsModal({ open, onClose, season, league }) {
  const [seasonSort, setSeasonSort] = useState({ column: 'passingYards', direction: 'desc' });
  const [careerSort, setCareerSort] = useState({ column: 'passingYards', direction: 'desc' });

  const seasonRows = useMemo(
    () => sortRows(buildRows(season?.playerStats || {}, league, season?.teams || {}), seasonSort),
    [season, league, seasonSort],
  );
  const careerRows = useMemo(
    () => sortRows(buildRows(league?.careerStats || {}, league, season?.teams || {}), careerSort),
    [league, season, careerSort],
  );

  const handleSeasonSort = (column) => {
    setSeasonSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: 'desc' };
    });
  };

  const handleCareerSort = (column) => {
    setCareerSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: 'desc' };
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Leaderboards" width="min(98vw, 1180px)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LeaderboardTable title="Season Leaders" rows={seasonRows} sort={seasonSort} onSort={handleSeasonSort} />
        <LeaderboardTable title="Career Leaders" rows={careerRows} sort={careerSort} onSort={handleCareerSort} />
      </div>
    </Modal>
  );
}
