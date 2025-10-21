// src/ui/Scoreboard.jsx
import React from 'react';

function TeamPanel({ team = {}, align = 'left' }) {
  const {
    displayName = 'Team',
    abbr = '',
    recordText = '0-0-0',
    score = 0,
    color = '#e8ffe8',
  } = team;

  const isRight = align === 'right';
  const label = displayName || abbr || 'Team';

  return (
    <div className={`scoreboard__team scoreboard__team--${isRight ? 'right' : 'left'}`}>
      <div className="scoreboard__team-meta">
        <span
          className="scoreboard__team-color"
          style={{ background: color || '#e8ffe8' }}
          aria-hidden="true"
        />
        <div className="scoreboard__team-text">
          <span className="scoreboard__team-abbr">{abbr || displayName}</span>
          <span className="scoreboard__team-name">{label}</span>
          <span className="scoreboard__team-record">{recordText}</span>
        </div>
      </div>
      <div className="scoreboard__score" aria-label={`${label} score`}>
        {Number.isFinite(score) ? score : 0}
      </div>
    </div>
  );
}

export default function Scoreboard({
  home = {},
  away = {},
  quarter = 1,
  timeLeftText = '15:00',
  down = 1,
  toGo = 10,
  gameLabel = '',
  onShowStats,
}) {
  const safeDown = Number.isFinite(down) && down > 0 ? down : 1;
  const safeToGo = Number.isFinite(toGo) && toGo > 0 ? Math.round(toGo) : 10;
  const safeQuarter = Number.isFinite(quarter) && quarter > 0 ? quarter : 1;
  const downDistanceText = `${ordinal(safeDown)} & ${Math.max(1, safeToGo)}`;
  const quarterText = `Q${safeQuarter}`;
  const canShowStats = typeof onShowStats === 'function';

  return (
    <div className="scoreboard">
      <TeamPanel team={away} align="left" />
      <div className="scoreboard__info">
        <div className="scoreboard__label" aria-live="polite">
          {gameLabel}
        </div>
        <div className="scoreboard__status">
          <span>{downDistanceText}</span>
          <span aria-label="Quarter">{quarterText}</span>
          <span aria-label="Game clock">{timeLeftText}</span>
        </div>
        {canShowStats ? (
          <button
            type="button"
            className="scoreboard__stats-button"
            onClick={onShowStats}
          >
            Game Stats
          </button>
        ) : null}
      </div>
      <TeamPanel team={home} align="right" />
    </div>
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
