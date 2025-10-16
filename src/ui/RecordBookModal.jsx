import React, { useMemo } from 'react';
import Modal from './Modal';
import { formatRecord } from '../engine/league';

const GROUP_LABELS = {
  player: 'Player Records',
  team: 'Team Records',
  coach: 'Coaching Records',
};

function formatRecordValue(entry) {
  if (!entry) return '—';
  if (entry.key === 'bestTeamRecordSeason') {
    const wins = entry.extra?.wins ?? entry.value ?? 0;
    const losses = entry.extra?.losses ?? 0;
    const ties = entry.extra?.ties ?? 0;
    return formatRecord({ wins, losses, ties });
  }
  if (entry.key === 'bestPointDifferentialSeason') {
    const diff = Math.round(entry.value ?? 0);
    return `${diff} pts`;
  }
  const value = Math.round(entry.value ?? 0);
  const unit = entry.unit || entry.extra?.unit || null;
  return unit ? `${value} ${unit}` : String(value);
}

function renderHolder(entry) {
  if (!entry) return '—';
  if (entry.type === 'team') {
    return entry.teamName || entry.holderName || entry.teamId || '—';
  }
  return entry.holderName || entry.teamName || entry.holderId || '—';
}

function renderDetails(entry) {
  if (!entry) return '—';
  if (entry.key === 'bestTeamRecordSeason') {
    const wins = entry.extra?.wins ?? entry.value ?? 0;
    const losses = entry.extra?.losses ?? 0;
    const ties = entry.extra?.ties ?? 0;
    const diff = entry.extra?.pointDiff ?? (entry.value ?? 0);
    return `W${wins}-L${losses}${ties ? `-T${ties}` : ''} • Diff ${Math.round(diff || 0)}`;
  }
  if (entry.key === 'bestPointDifferentialSeason') {
    const wins = entry.extra?.wins ?? 0;
    const losses = entry.extra?.losses ?? 0;
    const ties = entry.extra?.ties ?? 0;
    return `Record ${formatRecord({ wins, losses, ties })}`;
  }
  if (entry.type === 'coach') {
    const losses = entry.extra?.losses ?? 0;
    const ties = entry.extra?.ties ?? 0;
    return `Record ${formatRecord({ wins: entry.value ?? 0, losses, ties })}`;
  }
  return entry.teamName || '—';
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
};

const thStyle = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  background: 'rgba(10,70,10,0.8)',
};

const tdStyle = {
  padding: '10px 12px',
  fontSize: 13,
  verticalAlign: 'top',
};

export default function RecordBookModal({ open, onClose, recordBook, league }) {
  const grouped = useMemo(() => {
    const categories = recordBook?.categories || {};
    const groups = {};
    Object.values(categories).forEach((entry) => {
      if (!entry) return;
      const type = entry.type || 'player';
      if (!groups[type]) groups[type] = [];
      groups[type].push(entry);
    });
    Object.values(groups).forEach((entries) => {
      entries.sort((a, b) => {
        if ((b.value ?? 0) !== (a.value ?? 0)) return (b.value ?? 0) - (a.value ?? 0);
        return (a.label || '').localeCompare(b.label || '');
      });
    });
    return groups;
  }, [recordBook?.categories]);

  const groups = Object.entries(grouped);
  const updatedSeason = recordBook?.lastUpdatedSeason ?? league?.finalizedSeasonNumber ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="League Record Book"
      width="min(96vw, 880px)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 13, color: '#cde8cd' }}>
          {updatedSeason ? `Updated through Season ${updatedSeason}` : 'Records will populate once a full season is complete.'}
        </div>

        {groups.length ? groups.map(([type, entries]) => (
          <section key={type} style={{ background: 'rgba(6,44,6,0.78)', borderRadius: 12, overflow: 'hidden' }}>
            <header style={{ padding: '12px 16px', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 14 }}>
              {GROUP_LABELS[type] || type}
            </header>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Category</th>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Holder</th>
                    <th style={thStyle}>Details</th>
                    <th style={thStyle}>Season</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length ? entries.map((entry, index) => {
                    const striped = index % 2 === 0;
                    const background = striped ? 'rgba(7,45,7,0.7)' : 'rgba(5,32,5,0.88)';
                    return (
                      <tr key={entry.key} style={{ background }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{entry.label}</td>
                        <td style={tdStyle}>{formatRecordValue(entry)}</td>
                        <td style={tdStyle}>{renderHolder(entry)}</td>
                        <td style={tdStyle}>{renderDetails(entry)}</td>
                        <td style={tdStyle}>{entry.seasonNumber != null ? `Season ${entry.seasonNumber}` : '—'}</td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#cde8cd' }}>
                        No records have been established yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )) : (
          <div style={{ fontSize: 14, color: '#cde8cd', textAlign: 'center', padding: '18px 0' }}>
            No league records have been set yet. Complete a season to populate this book.
          </div>
        )}
      </div>
    </Modal>
  );
}
