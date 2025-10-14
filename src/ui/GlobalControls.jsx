import React from 'react';

export default function GlobalControls({
  running,
  onToggleRunning,
  simSpeed,
  onSimSpeedChange,
  onShowSeasonStats,
}) {
  const handleSpeedChange = (event) => {
    const value = parseFloat(event.target.value);
    if (!Number.isNaN(value)) {
      onSimSpeedChange?.(value);
    }
  };

  return (
    <div className="global-controls">
      <button type="button" className="global-controls__button" onClick={onToggleRunning}>
        {running ? 'Pause' : 'Start'}
      </button>
      <button
        type="button"
        className="global-controls__button global-controls__button--secondary"
        onClick={onShowSeasonStats}
      >
        Season Stats
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
