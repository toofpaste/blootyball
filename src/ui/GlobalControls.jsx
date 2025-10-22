import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function GlobalControls({
  running,
  onToggleRunning,
  simSpeed,
  onSimSpeedChange,
  onToggleSeasonLength,
  longSeasonEnabled,
  onShowTeamDirectory,
  onShowSeasonStats,
  onShowSchedule,
  onShowLeaderboards,
  onShowNews,
  newsTickerItems,
  onShowPressArticles,
  onShowFreeAgents,
  onShowRecordBook,
  onShowLeagueWiki,
  onAdvanceOffseasonDay,
  seasonProgressLabel,
  hasUnseenNews,
  hasUnseenPressArticles,
  offseasonInfo,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverMenu, setHoverMenu] = useState(false);
  const menuRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const scheduleCloseMenu = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setMenuOpen(false);
      closeTimeoutRef.current = null;
    }, 160);
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const handleChange = (event) => setHoverMenu(Boolean(event.matches));
    setHoverMenu(Boolean(query.matches));
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }
    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointer = (event) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        clearCloseTimeout();
        setMenuOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        clearCloseTimeout();
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  useEffect(() => () => clearCloseTimeout(), []);

  const tickerItems = useMemo(() => {
    if (!Array.isArray(newsTickerItems)) return [];
    return newsTickerItems.filter((item) => item && item.text);
  }, [newsTickerItems]);

  const tickerKey = useMemo(() => {
    if (!tickerItems.length) return 'empty';
    return tickerItems
      .map((item) => item.id || `${item.timestampISO || ''}|${item.text}`)
      .join('|');
  }, [tickerItems]);

  const handleSpeedChange = (event) => {
    const value = parseFloat(event.target.value);
    if (!Number.isNaN(value)) {
      onSimSpeedChange?.(value);
    }
  };

  const defaultProgressText = longSeasonEnabled ? 'Week 1 of 14' : 'Week 1 of 7';
  const progressText = seasonProgressLabel || defaultProgressText;

  const formatCountdown = (ms) => {
    if (!Number.isFinite(ms)) return '--:--';
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  let offseasonChips = [];
  if (offseasonInfo) {
    const {
      active,
      ready,
      paused,
      totalDays,
      currentDay,
      daysRemaining,
      msUntilNextDay,
    } = offseasonInfo;
    const chips = [];

    if (ready) {
      chips.push('Offseason complete');
    } else if (active) {
      const total = Math.max(1, totalDays || 0);
      const dayNumber = Math.min(currentDay + 1, total);
      chips.push(`Offseason Day ${dayNumber} of ${total}`);
      if (paused) {
        chips.push('Press Start to advance');
      } else if (msUntilNextDay != null) {
        chips.push(`Next day in ${formatCountdown(msUntilNextDay)}`);
      }
    }

    if (Number.isFinite(daysRemaining)) {
      const kickoffText = daysRemaining === 1
        ? '1 day until season kickoff'
        : `${daysRemaining} days until season kickoff`;
      chips.push(kickoffText);
    }

    offseasonChips = chips;
  }

  const canAdvanceOffseason = Boolean(offseasonInfo?.active);

  const handleMenuAction = (callback) => () => {
    callback?.();
    clearCloseTimeout();
    setMenuOpen(false);
  };

  const renderMenuButton = (label, callback, { pressed = null, disabled = false, indicator = false } = {}) => (
    <button
      type="button"
      className="global-header__menu-item"
      onClick={callback ? handleMenuAction(callback) : undefined}
      aria-pressed={pressed}
      disabled={disabled}
    >
      <span>{label}</span>
      {indicator ? <span className="global-header__menu-dot" aria-hidden="true" /> : null}
    </button>
  );

  const menuPanel = (
    <div
      className="global-header__menu-panel"
      role="menu"
      aria-hidden={!menuOpen}
    >
      <div className="global-header__menu-section">
        <h3 className="global-header__menu-heading">Season Tools</h3>
        {renderMenuButton(`Long Season: ${longSeasonEnabled ? 'On' : 'Off'}`, onToggleSeasonLength, {
          pressed: !!longSeasonEnabled,
        })}
        {canAdvanceOffseason
          ? renderMenuButton('Advance Offseason Day', onAdvanceOffseasonDay)
          : null}
        {renderMenuButton('Season Overview', onShowSeasonStats)}
        {renderMenuButton('Season Schedule', onShowSchedule)}
        {renderMenuButton('Leaderboards', onShowLeaderboards)}
        {renderMenuButton('League Records', onShowRecordBook)}
      </div>
      <div className="global-header__menu-section">
        <h3 className="global-header__menu-heading">League Hub</h3>
        {renderMenuButton('Team Pages', onShowTeamDirectory)}
        {renderMenuButton('League Wiki', onShowLeagueWiki)}
        {renderMenuButton('Free Agents', onShowFreeAgents)}
        {renderMenuButton('League News', onShowNews, { indicator: hasUnseenNews })}
        {renderMenuButton('Press Articles', onShowPressArticles, { indicator: hasUnseenPressArticles })}
      </div>
    </div>
  );

  return (
    <header className="global-header">
      {tickerItems.length ? (
        <button
          type="button"
          className="global-header__ticker"
          onClick={onShowNews}
          aria-label="Show latest league news"
        >
          <span className="global-header__ticker-label" aria-hidden="true">Latest News</span>
          <div className="global-header__ticker-marquee" key={tickerKey}>
            <div className="global-header__ticker-track">
              {[0, 1].map((loopIndex) => (
                <ul
                  key={`ticker-loop-${loopIndex}`}
                  className="global-header__ticker-segment"
                  aria-hidden={loopIndex > 0}
                >
                  {tickerItems.map((item) => (
                    <li key={`${loopIndex}-${item.id}`} className="global-header__ticker-item">
                      {item.timestampLabel ? (
                        <span className="global-header__ticker-timestamp">
                          <time dateTime={item.timestampISO || undefined}>{item.timestampLabel}</time>
                        </span>
                      ) : null}
                      <span className="global-header__ticker-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </button>
      ) : null}
      <div className="global-header__inner">
        <div className="global-header__brand">
          <span className="global-header__title">Blootyball</span>
          <span className="global-header__season" aria-live="polite">{progressText}</span>
        </div>
        <div className="global-header__actions">
          <button type="button" className="global-header__primary" onClick={onToggleRunning}>
            {running ? 'Pause Sim' : 'Start Sim'}
          </button>
          <label className="global-header__speed">
            <span className="global-header__speed-label">Speed</span>
            <input
              type="range"
              min="0.2"
              max="3"
              step="0.1"
              value={simSpeed}
              onChange={handleSpeedChange}
              className="global-header__speed-slider"
            />
            <span className="global-header__speed-value">{(simSpeed ?? 1).toFixed(1)}x</span>
          </label>
          <div
            className={`global-header__menu${menuOpen ? ' is-open' : ''}`}
            ref={menuRef}
            onMouseEnter={hoverMenu ? () => {
              clearCloseTimeout();
              setMenuOpen(true);
            } : undefined}
            onMouseLeave={hoverMenu ? scheduleCloseMenu : undefined}
          >
            <button
              type="button"
              className="global-header__menu-button"
              onClick={() => {
                clearCloseTimeout();
                setMenuOpen((prev) => !prev);
              }}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="global-header__menu-icon" aria-hidden="true" />
              {(hasUnseenNews || hasUnseenPressArticles) ? (
                <span className="global-header__menu-indicator" aria-hidden="true" />
              ) : null}
            </button>
            {menuPanel}
          </div>
        </div>
      </div>
      {offseasonChips.length ? (
        <div className="global-header__offseason" aria-live="polite">
          {offseasonChips.map((text, index) => (
            <span key={index} className="global-header__chip">{text}</span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
