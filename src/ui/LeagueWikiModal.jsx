import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';

const panelStyle = {
  display: 'grid',
  gridTemplateColumns: '240px 1fr',
  gap: 16,
  minHeight: '60vh',
};

const navButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'transparent',
  border: '1px solid rgba(26,92,26,0.4)',
  borderRadius: 10,
  padding: '10px 12px',
  color: '#f2fff2',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 140ms ease, transform 140ms ease',
};

function SeasonHistoryTable({ summaries }) {
  if (!summaries || !summaries.length) {
    return (
      <div style={{ fontSize: 13, color: '#cde8cd' }}>
        No seasons recorded yet. Finish a season to populate the franchise history.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={{ background: 'rgba(10,70,10,0.8)', textAlign: 'left' }}>
            <th style={thStyle}>Season</th>
            <th style={thStyle}>Record</th>
            <th style={thStyle}>PF / PA</th>
            <th style={thStyle}>Playoffs</th>
            <th style={thStyle}>Awards</th>
            <th style={thStyle}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary, index) => {
            const striped = index % 2 === 0;
            const background = striped ? 'rgba(7,45,7,0.7)' : 'rgba(5,32,5,0.88)';
            const notes = summary.notes || summary.notablePlayers?.map((player) => player.highlight).join(' • ');
            return (
              <tr key={summary.seasonNumber ?? `summary-${index}`} style={{ background }}>
                <td style={tdStyle}>{summary.seasonNumber != null ? `Season ${summary.seasonNumber}` : '—'}</td>
                <td style={tdStyle}>{summary.recordText || '0-0'}</td>
                <td style={tdStyle}>{`${summary.pointsFor ?? 0} / ${summary.pointsAgainst ?? 0}`}</td>
                <td style={tdStyle}>{summary.playoffResult || 'Regular Season'}</td>
                <td style={tdStyle}>{summary.awards?.length ? summary.awards.join(', ') : '—'}</td>
                <td style={tdStyle}>{notes || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecordHighlightList({ records }) {
  if (!records || !records.length) {
    return <div style={{ fontSize: 13, color: '#cde8cd' }}>No franchise records yet.</div>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {records.map((record) => (
        <li key={`${record.key}-${record.seasonNumber ?? 'legacy'}`} style={{ fontSize: 13 }}>
          <span style={{ color: '#9bd79b', fontWeight: 600 }}>{record.label}:</span>{' '}
          {record.value != null ? `${Math.round(record.value)}${record.unit ? ` ${record.unit}` : ''}` : '—'}
          {record.holderName ? ` • ${record.holderName}` : ''}
          {record.seasonNumber ? ` • Season ${record.seasonNumber}` : ''}
        </li>
      ))}
    </ul>
  );
}

function NotablePlayersSection({ players }) {
  if (!players || !players.length) {
    return <div style={{ fontSize: 13, color: '#cde8cd' }}>No notable players yet.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {players.map((player) => (
        <div
          key={player.playerId || player.name}
          style={{
            border: '1px solid rgba(26,92,26,0.35)',
            borderRadius: 12,
            padding: '12px 14px',
            background: 'rgba(5,32,5,0.85)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 700, color: '#f2fff2', fontSize: 14 }}>{player.name || player.playerId}</div>
          <div style={{ fontSize: 11, color: '#a1dba1' }}>
            Seasons: {player.seasons?.length ? player.seasons.map((season) => `S${season}`).join(', ') : '—'}
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(player.highlights || []).map((highlight, index) => (
              <li key={index} style={{ fontSize: 12, color: '#cde8cd' }}>{highlight}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const thStyle = {
  padding: '10px 12px',
  fontSize: 12,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  fontWeight: 600,
};

const tdStyle = {
  padding: '10px 12px',
  fontSize: 12,
  verticalAlign: 'top',
  color: '#f2fff2',
};

export default function LeagueWikiModal({ open, onClose, teamWiki, recordBook, aiOverrides }) {
  const teams = useMemo(() => {
    const entries = Object.values(teamWiki || {});
    entries.sort((a, b) => {
      const nameA = a.displayName || a.id || '';
      const nameB = b.displayName || b.id || '';
      return nameA.localeCompare(nameB);
    });
    return entries;
  }, [teamWiki]);

  const [activeTeamId, setActiveTeamId] = useState(() => (teams[0]?.id ?? null));

  useEffect(() => {
    if (!open) return;
    if (!activeTeamId && teams.length) {
      setActiveTeamId(teams[0].id);
    }
  }, [open, teams, activeTeamId]);

  useEffect(() => {
    if (!teams.length) {
      setActiveTeamId(null);
      return;
    }
    if (!activeTeamId || !teams.find((team) => team.id === activeTeamId)) {
      setActiveTeamId(teams[0].id);
    }
  }, [teams, activeTeamId]);

  const activeTeam = teams.find((team) => team.id === activeTeamId) || null;
  const overrides = activeTeamId && aiOverrides?.teams?.[activeTeamId]?.sections ? aiOverrides.teams[activeTeamId].sections : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="League Wiki"
      width="min(96vw, 1080px)"
    >
      {!teams.length ? (
        <div style={{ fontSize: 14, color: '#cde8cd', textAlign: 'center', padding: '20px 0' }}>
          Team wiki entries will unlock once the season begins.
        </div>
      ) : (
        <div style={panelStyle}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {teams.map((team) => {
              const isActive = team.id === activeTeamId;
              return (
                <button
                  type="button"
                  key={team.id}
                  onClick={() => setActiveTeamId(team.id)}
                  style={{
                    ...navButtonStyle,
                    background: isActive ? 'rgba(10,70,10,0.85)' : navButtonStyle.background,
                    transform: isActive ? 'translateY(-1px)' : 'none',
                    borderColor: isActive ? 'rgba(148,238,148,0.4)' : navButtonStyle.border,
                  }}
                >
                  <span>{team.displayName || team.id}</span>
                  <span style={{ fontSize: 11, color: '#9bd79b' }}>
                    {team.seasonSummaries?.length || 0} seasons
                  </span>
                </button>
              );
            })}
          </nav>

          <article
            style={{
              background: 'rgba(4,26,4,0.92)',
              borderRadius: 14,
              padding: '18px 22px',
              color: '#f2fff2',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              minHeight: 0,
              overflowY: 'auto',
              maxHeight: '70vh',
            }}
          >
            {!activeTeam ? (
              <div style={{ fontSize: 14, color: '#cde8cd' }}>Select a team to view its encyclopedia entry.</div>
            ) : (
              <>
                <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{activeTeam.displayName || activeTeam.id}</h2>
                  <div style={{ fontSize: 12, color: '#9bd79b' }}>
                    Last updated: Season {activeTeam.lastUpdatedSeason || '—'}
                  </div>
                </header>

                <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(activeTeam.sections || []).map((section) => {
                    const override = overrides?.[section.id];
                    return (
                      <div key={section.id}>
                        <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>{section.title}</h3>
                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: '#e8ffe8' }}>
                          {override || section.body || '—'}
                        </p>
                      </div>
                    );
                  })}
                </section>

                <section>
                  <h3 style={sectionTitleStyle}>Season Results</h3>
                  <SeasonHistoryTable summaries={activeTeam.seasonSummaries || []} />
                </section>

                <section>
                  <h3 style={sectionTitleStyle}>Franchise Totals</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                    <div style={badgeStyle}>Playoff Appearances: {activeTeam.totals?.playoffAppearances ?? 0}</div>
                    <div style={badgeStyle}>BluperBowl Wins: {activeTeam.totals?.bluperbowlWins ?? 0}</div>
                    <div style={badgeStyle}>League Awards: {activeTeam.totals?.awards ?? 0}</div>
                    <div style={badgeStyle}>Championships Counted: {activeTeam.totals?.championships ?? 0}</div>
                  </div>
                </section>

                <section>
                  <h3 style={sectionTitleStyle}>Record Highlights</h3>
                  <RecordHighlightList records={activeTeam.recordsSet || []} />
                </section>

                <section>
                  <h3 style={sectionTitleStyle}>Notable Players</h3>
                  <NotablePlayersSection players={activeTeam.notablePlayers || []} />
                </section>
              </>
            )}
          </article>
        </div>
      )}
    </Modal>
  );
}

const sectionTitleStyle = {
  margin: '0 0 8px',
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 0.4,
};

const badgeStyle = {
  padding: '8px 10px',
  borderRadius: 10,
  background: 'rgba(6,44,6,0.75)',
  border: '1px solid rgba(26,92,26,0.35)',
  color: '#f2fff2',
};
