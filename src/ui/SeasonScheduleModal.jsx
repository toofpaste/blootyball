import React, { useMemo } from 'react';
import Modal from './Modal';
import { getTeamIdentity } from '../engine/data/teamLibrary';

function resolveTeamName(teamId, season) {
  if (!teamId) return 'TBD';
  const info = season?.teams?.[teamId]?.info || getTeamIdentity(teamId) || {};
  return info.displayName || info.name || info.abbr || teamId;
}

function formatTag(tag, round) {
  if (!tag) return round || 'Regular Season';
  if (tag === 'playoff-semifinal') {
    return round || 'Playoffs • Semifinal';
  }
  if (tag === 'playoff-championship') {
    return round || 'BluperBowl';
  }
  if (tag === 'playoff') {
    return round || 'Playoffs';
  }
  return round || 'Regular Season';
}

function formatStatus({ played, isNext }) {
  if (played) return 'Final';
  if (isNext) return 'Up Next';
  return 'Scheduled';
}

function buildScheduleEntries(season) {
  if (!season) return [];
  const schedule = Array.isArray(season.schedule) ? season.schedule : [];
  const currentIndex = Number.isFinite(season.currentGameIndex) ? season.currentGameIndex : null;
  return schedule
    .map((game, index) => {
      if (!game) return null;
      const homeTeam = game.homeTeam;
      const awayTeam = game.awayTeam;
      const result = game.result || null;
      const played = Boolean(game.played || (result && result.winner !== undefined));
      const homeName = resolveTeamName(homeTeam, season);
      const awayName = resolveTeamName(awayTeam, season);
      const homeScore = result?.score ? result.score[homeTeam] ?? null : null;
      const awayScore = result?.score ? result.score[awayTeam] ?? null : null;
      const winner = result?.winner || null;
      const isNext = !played && currentIndex === index;
      const status = formatStatus({ played, isNext });
      const round = formatTag(game.tag, game.round);
      const matchup = `${awayName} @ ${homeName}`;
      let resultLabel = '—';
      if (played) {
        if (homeScore != null && awayScore != null) {
          resultLabel = `${homeName} ${homeScore} – ${awayScore} ${awayName}`;
        } else if (winner) {
          resultLabel = `${winner} won`;
        } else {
          resultLabel = 'Final';
        }
      } else if (isNext) {
        resultLabel = 'Kickoff pending';
      }
      return {
        index,
        order: index + 1,
        week: Number.isFinite(game.week) ? game.week : null,
        matchup,
        status,
        resultLabel,
        round,
        played,
        isNext,
      };
    })
    .filter(Boolean);
}

export default function SeasonScheduleModal({ open, onClose, season }) {
  const entries = useMemo(() => buildScheduleEntries(season), [season]);
  return (
    <Modal open={open} onClose={onClose} title="Season Schedule" width="min(96vw, 840px)">
      {season ? (
        entries.length ? (
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(6,44,6,0.95)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Order</th>
                  <th style={{ padding: '8px 10px' }}>Week</th>
                  <th style={{ padding: '8px 10px' }}>Matchup</th>
                  <th style={{ padding: '8px 10px' }}>Result</th>
                  <th style={{ padding: '8px 10px' }}>Stage</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const striped = index % 2 === 0;
                  const highlight = entry.isNext ? 'rgba(32,104,32,0.85)' : striped ? 'rgba(7,45,7,0.78)' : 'rgba(5,32,5,0.92)';
                  return (
                    <tr key={entry.index} style={{ background: highlight }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{entry.order}</td>
                      <td style={{ padding: '8px 10px' }}>{entry.week != null ? entry.week : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{entry.matchup}</td>
                      <td style={{ padding: '8px 10px' }}>{entry.resultLabel}</td>
                      <td style={{ padding: '8px 10px' }}>{entry.round}</td>
                      <td style={{ padding: '8px 10px' }}>{entry.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>No games have been scheduled yet.</div>
        )
      ) : (
        <div style={{ color: '#cde8cd', fontSize: 14 }}>Season data is not available yet.</div>
      )}
    </Modal>
  );
}
