import React, { useMemo } from 'react';
import Modal from './Modal';
import { formatRecord } from '../engine/league';
import { TEAM_RED, TEAM_BLK } from '../engine/constants';

function getTeamName(season, teamId) {
  if (!teamId) return '—';
  const info = season?.teams?.[teamId]?.info;
  return info?.displayName || `${info?.city || ''} ${info?.name || ''}`.trim() || teamId;
}

function buildTeamRows(season) {
  const entries = Object.values(season?.teams || {});
  return entries
    .map((team) => {
      const gamesPlayed = (team.record?.wins || 0) + (team.record?.losses || 0) + (team.record?.ties || 0);
      const diff = (team.pointsFor || 0) - (team.pointsAgainst || 0);
      return {
        id: team.id,
        name: team.info?.displayName || team.id,
        recordText: formatRecord(team.record),
        gamesPlayed,
        pointsFor: team.pointsFor || 0,
        pointsAgainst: team.pointsAgainst || 0,
        diff,
        passingYards: Math.round(team.stats?.passingYards || 0),
        rushingYards: Math.round(team.stats?.rushingYards || 0),
        receivingYards: Math.round(team.stats?.receivingYards || 0),
        sacks: Math.round(team.stats?.sacks || 0),
        interceptions: Math.round(team.stats?.interceptions || 0),
        wins: team.record?.wins || 0,
        losses: team.record?.losses || 0,
        ties: team.record?.ties || 0,
      };
    })
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (b.ties !== a.ties) return b.ties - a.ties;
      return b.diff - a.diff;
    });
}

function buildCompletedResults(season) {
  const results = season?.results || [];
  return results
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((game) => {
      const homeName = getTeamName(season, game.homeTeamId);
      const awayName = getTeamName(season, game.awayTeamId);
      const homeScore = game.score?.[game.homeTeamId] ?? 0;
      const awayScore = game.score?.[game.awayTeamId] ?? 0;
      const winnerName = game.winner ? getTeamName(season, game.winner) : 'Tie';
      return {
        id: game.gameId || `Game-${game.index}`,
        label: `Game ${game.index + 1}`,
        summary: `${homeName} ${homeScore} - ${awayScore} ${awayName}`,
        winner: winnerName,
      };
    });
}

function CurrentGameSummary({ season, matchup, scores }) {
  if (!season || !matchup) return null;
  const homeId = matchup.slotToTeam?.[TEAM_RED];
  const awayId = matchup.slotToTeam?.[TEAM_BLK];
  const homeName = getTeamName(season, homeId);
  const awayName = getTeamName(season, awayId);
  const homeScore = scores?.[TEAM_RED] ?? 0;
  const awayScore = scores?.[TEAM_BLK] ?? 0;
  const gameNumber = (matchup.index ?? 0) + 1;

  return (
    <div style={{ marginBottom: 18, padding: '12px 16px', background: 'rgba(12,64,12,0.85)', borderRadius: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
        Current Game • Game {gameNumber} of {season.schedule?.length || '?'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 600 }}>
        <span>{homeName}</span>
        <span>{homeScore} - {awayScore}</span>
        <span>{awayName}</span>
      </div>
    </div>
  );
}

export default function SeasonStatsModal({
  open,
  onClose,
  season,
  currentMatchup = null,
  currentScores = {},
  lastCompletedGame = null,
}) {
  const teamRows = useMemo(() => buildTeamRows(season), [season]);
  const completed = useMemo(() => buildCompletedResults(season), [season]);
  const totalGames = season?.schedule?.length || 0;
  const completedCount = season?.completedGames || completed.length || 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Season Overview"
      width="min(96vw, 960px)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontSize: 14, color: '#cde8cd' }}>
          Progress: {completedCount} / {totalGames || '—'} games completed
        </div>

        <CurrentGameSummary season={season} matchup={currentMatchup} scores={currentScores} />

        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>Team Standings</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: 'rgba(10,70,10,0.85)', color: '#f2fff2' }}>
                  <th style={thStyle}>Team</th>
                  <th style={thStyle}>Record</th>
                  <th style={thStyle}>GP</th>
                  <th style={thStyle}>PF</th>
                  <th style={thStyle}>PA</th>
                  <th style={thStyle}>Diff</th>
                  <th style={thStyle}>Pass Yds</th>
                  <th style={thStyle}>Rush Yds</th>
                  <th style={thStyle}>Rec Yds</th>
                  <th style={thStyle}>Sacks</th>
                  <th style={thStyle}>INT</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.length ? teamRows.map((row, idx) => {
                  const isEven = idx % 2 === 0;
                  return (
                    <tr key={row.id} style={{ background: isEven ? 'rgba(7,45,7,0.75)' : 'rgba(5,32,5,0.9)', color: '#f2fff2' }}>
                      <td style={tdStyle}>{row.name}</td>
                      <td style={tdStyle}>{row.recordText}</td>
                      <td style={tdStyle}>{row.gamesPlayed}</td>
                      <td style={tdStyle}>{row.pointsFor}</td>
                      <td style={tdStyle}>{row.pointsAgainst}</td>
                      <td style={tdStyle}>{row.diff}</td>
                      <td style={tdStyle}>{row.passingYards}</td>
                      <td style={tdStyle}>{row.rushingYards}</td>
                      <td style={tdStyle}>{row.receivingYards}</td>
                      <td style={tdStyle}>{row.sacks}</td>
                      <td style={tdStyle}>{row.interceptions}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td style={{ ...tdStyle, textAlign: 'center' }} colSpan={11}>No team statistics available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700, letterSpacing: 0.4 }}>Completed Games</h3>
          {completed.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {completed.map(game => (
                <li
                  key={game.id}
                  style={{
                    background: 'rgba(8,59,8,0.65)',
                    border: '1px solid rgba(26,92,26,0.35)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    color: '#e4ffe4'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{game.label}</div>
                  <div style={{ fontSize: 14 }}>{game.summary}</div>
                  <div style={{ fontSize: 12, color: '#b5e5b5' }}>Winner: {game.winner}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontStyle: 'italic', color: '#cde8cd' }}>No games completed yet.</div>
          )}
        </div>

        {!currentMatchup && lastCompletedGame?.matchup && !completed.length ? (
          <div style={{ fontSize: 13, color: '#cde8cd' }}>
            Last result: {getTeamName(season, lastCompletedGame.matchup.slotToTeam?.[TEAM_RED])} {lastCompletedGame.scores?.[TEAM_RED] ?? 0} - {lastCompletedGame.scores?.[TEAM_BLK] ?? 0} {getTeamName(season, lastCompletedGame.matchup.slotToTeam?.[TEAM_BLK])}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

const thStyle = {
  padding: '8px 10px',
  fontSize: 12,
  textAlign: 'left',
  fontWeight: 600,
  letterSpacing: 0.3,
};

const tdStyle = {
  padding: '8px 10px',
  fontSize: 13,
  textAlign: 'left',
};
