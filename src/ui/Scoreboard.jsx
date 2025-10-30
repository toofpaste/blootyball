// src/ui/Scoreboard.jsx
import React, { useCallback } from 'react';

function TimeoutDots({ remaining = 3, total = 3 }) {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeRemaining = Math.max(0, Math.min(Math.floor(remaining), safeTotal));
  if (safeTotal <= 0) return null;

  const ariaLabel = `${safeRemaining} timeout${safeRemaining === 1 ? '' : 's'} remaining`;

  return (
    <div className="scoreboard__team-timeouts" role="img" aria-label={ariaLabel}>
      {Array.from({ length: safeTotal }, (_, index) => {
        const available = index < safeRemaining;
        const dotClass = [
          'scoreboard__timeout-dot',
          available ? 'scoreboard__timeout-dot--available' : 'scoreboard__timeout-dot--used',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span
            key={`timeout-${index}`}
            className={dotClass}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

function TeamPanel({ team = {}, align = 'left' }) {
  const {
    displayName = 'Team',
    abbr = '',
    recordText = '0-0-0',
    score = 0,
    color = '#e8ffe8',
    timeoutsRemaining = 3,
    timeoutsTotal = 3,
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
          <div className="scoreboard__team-labels">
            <span className="scoreboard__team-abbr">{abbr || displayName}</span>
            <span className="scoreboard__team-name">{label}</span>
            <span className="scoreboard__team-record">{recordText}</span>
          </div>
          <TimeoutDots remaining={timeoutsRemaining} total={timeoutsTotal} />
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
  collapsed = false,
  onRequestView,
}) {
  const safeDown = Number.isFinite(down) && down > 0 ? down : 1;
  const safeToGo = Number.isFinite(toGo) && toGo > 0 ? Math.round(toGo) : 10;
  const safeQuarter = Number.isFinite(quarter) && quarter > 0 ? quarter : 1;
  const downDistanceText = `${ordinal(safeDown)} & ${Math.max(1, safeToGo)}`;
  const quarterText = `Q${safeQuarter}`;
  const canShowStats = typeof onShowStats === 'function';
  const interactive = typeof onRequestView === 'function';

  const handleClick = useCallback(() => {
    if (!interactive) return;
    onRequestView();
  }, [interactive, onRequestView]);

  const handleKeyDown = useCallback(
    (event) => {
      if (!interactive) return;
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onRequestView();
      }
    },
    [interactive, onRequestView],
  );

  const handleShowStats = useCallback(
    (event) => {
      if (!canShowStats) return;
      event.stopPropagation();
      onShowStats();
    },
    [canShowStats, onShowStats],
  );

  const rootClassName = [
    'scoreboard',
    interactive ? 'scoreboard--interactive' : null,
    collapsed ? 'scoreboard--collapsed' : 'scoreboard--expanded',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClassName}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? !collapsed : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
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
        {interactive ? (
          <div className="scoreboard__view-status" aria-live="polite">
            {collapsed ? 'Click to watch this game' : 'Currently viewing'}
          </div>
        ) : null}
        {canShowStats ? (
          <button
            type="button"
            className="scoreboard__stats-button"
            onClick={handleShowStats}
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
