import React from 'react';

export default function GlobalControls({
  running,
  onToggleRunning,
  simSpeed,
  onSimSpeedChange,
  onShowTeamDirectory,
  onShowSeasonStats,
  onShowSchedule,
  onShowLeaderboards,
  onShowNews,
  onShowPressArticles,
  onShowFreeAgents,
  onShowRecordBook,
  onShowLeagueWiki,
  seasonProgressLabel,
  hasUnseenNews,
  hasUnseenPressArticles,
}) {
  const handleSpeedChange = (event) => {
    const value = parseFloat(event.target.value);
    if (!Number.isNaN(value)) {
      onSimSpeedChange?.(value);
    }
  };

  const progressText = seasonProgressLabel || 'Week 1 of 16';

  return (
    <div className="global-controls">
      <span className="global-controls__season" aria-live="polite">{progressText}</span>
      <button type="button" className="global-controls__button" onClick={onToggleRunning}>
        {running ? 'Pause' : 'Start'}
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowTeamDirectory}
      >
        Team Pages
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowLeagueWiki}
      >
        League Wiki
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowNews}
      >
        League News
        {hasUnseenNews ? <span className="global-controls__news-indicator" aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowPressArticles}
      >
        Articles From The Press
        {hasUnseenPressArticles ? <span className="global-controls__news-indicator" aria-hidden="true" /> : null}
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowFreeAgents}
      >
        Free Agents
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowSeasonStats}
      >
        Season Stats
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowSchedule}
      >
        Season Schedule
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowLeaderboards}
      >
        Leaderboards
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowRecordBook}
      >
        League Records
      </button>
      <label className="global-controls__speed">
        <span className="global-controls__speed-label">Speed</span>
        <input
          type="range"
          min="0.2"
          max="3"
          step="0.1"
          value={simSpeed}
          onChange={handleSpeedChange}
          className="global-controls__speed-slider"
        />
        <span className="global-controls__speed-value">{(simSpeed ?? 1).toFixed(1)}x</span>
      </label>
    </div>
  );
}
