import React, { useMemo } from 'react';
import Modal from './Modal';
import { getTeamIdentity } from '../engine/data/teamLibrary';

function formatTimestamp(value) {
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

function resolveTeamName(teamId) {
  if (!teamId) return null;
  const identity = getTeamIdentity(teamId);
  if (!identity) return teamId;
  return identity.displayName || identity.name || teamId;
}

export default function NewsModal({ open, onClose, league, season }) {
  const items = useMemo(() => {
    if (!league?.newsFeed) return [];
    return league.newsFeed.map((entry) => {
      const seasonNumber = entry.seasonNumber ?? season?.seasonNumber ?? league?.seasonNumber ?? null;
      const type = headlineType(entry.type);
      const teamName = resolveTeamName(entry.teamId);
      const partnerName = resolveTeamName(entry.partnerTeam);
      const context = [
        seasonNumber ? `Season ${seasonNumber}` : null,
        teamName,
        partnerName ? `↔ ${partnerName}` : null,
      ].filter(Boolean).join(' • ');
      return {
        id: entry.id || `${entry.type}-${entry.text}`,
        type,
        context,
        text: entry.text,
        detail: entry.detail,
        createdAt: formatTimestamp(entry.createdAt),
      };
    });
  }, [league, season]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="League News"
      width="min(96vw, 720px)"
    >
      {items.length === 0 ? (
        <div style={{ color: '#cde8cd', fontSize: 14 }}>
          No transactions, injuries, or headlines have been recorded yet.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxHeight: '70vh',
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {items.map((item) => (
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
                {item.createdAt && (
                  <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.7)' }}>{item.createdAt}</div>
                )}
              </header>
              {item.context && (
                <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.75)', marginTop: 2 }}>{item.context}</div>
              )}
              <p style={{ margin: '8px 0 4px', fontSize: 14, color: '#f0fff0', lineHeight: 1.4 }}>
                {item.text}
              </p>
              {item.detail && (
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(205,232,205,0.8)' }}>{item.detail}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
