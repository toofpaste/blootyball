import React, { useMemo, useState } from 'react';
import Modal from './Modal';
import { usePlayerCard } from './PlayerCardProvider';
import { formatBoostValue } from './PlayerCardModal';

const TABS = [
  { id: 'players', label: 'Players' },
  { id: 'coaches', label: 'Coaches' },
  { id: 'scouts', label: 'Scouts' },
  { id: 'gms', label: 'GMs' },
];

function formatRole(player) {
  return player.role || player.preferredRole || player.position || '—';
}

function formatPlayerType(player) {
  if (player.type) return player.type.charAt(0).toUpperCase() + player.type.slice(1);
  if (player.archetype) return player.archetype;
  return 'Free Agent';
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

function StaffCard({ title, name, rows, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid rgba(26,92,26,0.35)',
        background: 'rgba(5,32,5,0.92)',
        color: '#f2fff2',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: '#a5e0a5', textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{name}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
        {rows.map(({ label, value }, index) => (
          <span key={`${label}-${index}`} style={{ background: 'rgba(7,45,7,0.75)', padding: '4px 8px', borderRadius: 8 }}>
            <span style={{ color: '#9bd79b' }}>{label}:</span> {value}
          </span>
        ))}
      </div>
    </button>
  );
}

export default function FreeAgentModal({ open, onClose, league = null }) {
  const [tab, setTab] = useState('players');
  const { openPlayerCard } = usePlayerCard();

  const players = useMemo(() => {
    if (!Array.isArray(league?.freeAgents)) return [];
    return league.freeAgents
      .map((player) => ({
        ...player,
        role: player.role || player.preferredRole || null,
      }))
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  }, [league?.freeAgents]);

  const staff = useMemo(() => ({
    coaches: Array.isArray(league?.staffFreeAgents?.coaches) ? league.staffFreeAgents.coaches : [],
    scouts: Array.isArray(league?.staffFreeAgents?.scouts) ? league.staffFreeAgents.scouts : [],
    gms: Array.isArray(league?.staffFreeAgents?.gms) ? league.staffFreeAgents.gms : [],
  }), [league?.staffFreeAgents]);

  const handlePlayerClick = (player) => {
    if (!player) return;
    openPlayerCard({ entry: player, teamId: null });
  };

  const renderPlayers = () => (
    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(6,44,6,0.95)', textAlign: 'left' }}>
            <th style={{ padding: '8px 10px' }}>Pos</th>
            <th style={{ padding: '8px 10px' }}>Name</th>
            <th style={{ padding: '8px 10px' }}>Overall</th>
            <th style={{ padding: '8px 10px' }}>Age</th>
            <th style={{ padding: '8px 10px' }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {players.length ? (
            players.map((player, index) => {
              const striped = index % 2 === 0;
              const fullName = `${player.firstName || 'Player'}${player.lastName ? ` ${player.lastName}` : ''}`;
              return (
                <tr
                  key={player.id}
                  onClick={() => handlePlayerClick(player)}
                  style={{
                    background: striped ? 'rgba(7,45,7,0.78)' : 'rgba(5,32,5,0.92)',
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{formatRole(player)}</td>
                  <td style={{ padding: '8px 10px' }}>{fullName}</td>
                  <td style={{ padding: '8px 10px' }}>{player.overall ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{player.age ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{formatPlayerType(player)}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={5} style={{ padding: '12px 10px', textAlign: 'center', color: '#cde8cd' }}>
                No free agent players currently available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderCoaches = () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', maxHeight: '60vh', overflowY: 'auto' }}>
      {staff.coaches.length ? staff.coaches.map((coach) => (
        <StaffCard
          key={coach.id}
          title={coach.philosophy ? `${coach.philosophy.charAt(0).toUpperCase() + coach.philosophy.slice(1)} Coach` : 'Coach'}
          name={coach.name}
          rows={[
            { label: 'Overall', value: coach.overall != null ? Math.round(coach.overall) : '—' },
            { label: 'Tactical IQ', value: formatNumber(coach.tacticalIQ) },
            { label: 'Playcalling IQ', value: formatNumber(coach.playcallingIQ) },
            { label: 'Aggression', value: formatBoostValue(coach.tendencies?.aggression ?? 0) },
          ]}
        />
      )) : (
        <div style={{ padding: '12px 10px', color: '#cde8cd' }}>No free agent coaches at this time.</div>
      )}
    </div>
  );

  const renderScouts = () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', maxHeight: '60vh', overflowY: 'auto' }}>
      {staff.scouts.length ? staff.scouts.map((scout) => (
        <StaffCard
          key={scout.id}
          title="Scout"
          name={scout.name}
          rows={[
            { label: 'Overall', value: scout.overall != null ? Math.round(scout.overall) : '—' },
            { label: 'Evaluation', value: formatNumber(scout.evaluation) },
            { label: 'Development', value: formatNumber(scout.development) },
            { label: 'Trade', value: formatNumber(scout.trade) },
            { label: 'Aggression', value: formatBoostValue(scout.aggression ?? 0) },
          ]}
        />
      )) : (
        <div style={{ padding: '12px 10px', color: '#cde8cd' }}>No free agent scouts at this time.</div>
      )}
    </div>
  );

  const renderGms = () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', maxHeight: '60vh', overflowY: 'auto' }}>
      {staff.gms.length ? staff.gms.map((gm) => (
        <StaffCard
          key={gm.id}
          title="General Manager"
          name={gm.name}
          rows={[
            { label: 'Overall', value: gm.overall != null ? Math.round(gm.overall) : '—' },
            { label: 'Evaluation', value: formatNumber(gm.evaluation) },
            { label: 'Vision', value: formatNumber(gm.vision) },
            { label: 'Culture', value: formatNumber(gm.culture) },
            { label: 'Patience', value: formatNumber(gm.patience) },
          ]}
        />
      )) : (
        <div style={{ padding: '12px 10px', color: '#cde8cd' }}>No free agent GMs at this time.</div>
      )}
    </div>
  );

  const renderContent = () => {
    if (tab === 'players') return renderPlayers();
    if (tab === 'coaches') return renderCoaches();
    if (tab === 'scouts') return renderScouts();
    return renderGms();
  };

  return (
    <Modal open={open} onClose={onClose} title="Free Agent Directory" width="min(96vw, 820px)">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: active ? '1px solid rgba(198,255,198,0.8)' : '1px solid rgba(26,92,26,0.4)',
                background: active ? 'rgba(18,94,18,0.9)' : 'rgba(5,32,5,0.75)',
                color: '#f2fff2',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {renderContent()}
    </Modal>
  );
}
