// src/App.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import GameView from './GameView';
import GlobalControls from './ui/GlobalControls';
import Modal from './ui/Modal';
import { SeasonStatsContent } from './ui/SeasonStatsModal';
import './AppLayout.css';

const GAME_COUNT = 2;
const RESET_DELAY_MS = 1200;

export default function App() {
  const [completionFlags, setCompletionFlags] = useState(() => Array(GAME_COUNT).fill(false));
  const autoResumeRef = useRef(Array(GAME_COUNT).fill(false));
  const [resetSignal, setResetSignal] = useState({ token: 0, autoResume: Array(GAME_COUNT).fill(false) });
  const [globalRunning, setGlobalRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [seasonStatsOpen, setSeasonStatsOpen] = useState(false);
  const [seasonStatsActiveIndex, setSeasonStatsActiveIndex] = useState(0);
  const [seasonStatsData, setSeasonStatsData] = useState(() => Array(GAME_COUNT).fill(null));
  const gameRefs = useRef([]);

  const handleGameComplete = useCallback((index, { shouldAutoResume } = {}) => {
    setCompletionFlags(prev => {
      if (prev[index]) return prev;
      const next = prev.slice();
      next[index] = true;
      autoResumeRef.current[index] = !!shouldAutoResume;
      return next;
    });
  }, []);

  const handleGameReset = useCallback((index) => {
    autoResumeRef.current[index] = false;
    setCompletionFlags(prev => {
      if (!prev[index]) return prev;
      const next = prev.slice();
      next[index] = false;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!completionFlags.some(Boolean)) return;
    if (!completionFlags.every(Boolean)) return;

    const autoResume = autoResumeRef.current.slice();
    autoResumeRef.current = Array(GAME_COUNT).fill(false);

    const timeout = setTimeout(() => {
      setGlobalRunning(autoResume.some(Boolean));
      setResetSignal(prev => ({
        token: prev.token + 1,
        autoResume,
      }));
      setCompletionFlags(Array(GAME_COUNT).fill(false));
    }, RESET_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [completionFlags]);

  const handleToggleRunning = useCallback(() => {
    setGlobalRunning(prev => !prev);
  }, []);

  const handleSimSpeedChange = useCallback((value) => {
    setSimSpeed(value);
  }, []);

  const handleOpenSeasonStats = useCallback(() => {
    const snapshots = gameRefs.current.map((ref, index) => {
      if (ref && typeof ref.getSeasonSnapshot === 'function') {
        const snapshot = ref.getSeasonSnapshot();
        return {
          ...snapshot,
          label: snapshot?.label || `Game ${index + 1}`,
        };
      }
      return null;
    });

    setSeasonStatsData(snapshots);

    let nextIndex = seasonStatsActiveIndex;
    if (!snapshots[nextIndex]) {
      const firstAvailable = snapshots.findIndex(Boolean);
      nextIndex = firstAvailable >= 0 ? firstAvailable : 0;
    }
    setSeasonStatsActiveIndex(nextIndex);
    setSeasonStatsOpen(true);
  }, [seasonStatsActiveIndex]);

  const handleSelectSeasonStats = useCallback((index) => {
    setSeasonStatsActiveIndex(index);
  }, []);

  const activeSeasonStats = seasonStatsData[seasonStatsActiveIndex] || null;
  const modalTitle = activeSeasonStats?.label
    ? `Season Overview • ${activeSeasonStats.label}`
    : 'Season Overview';

  return (
    <div className="app-root">
      <GlobalControls
        running={globalRunning}
        onToggleRunning={handleToggleRunning}
        simSpeed={simSpeed}
        onSimSpeedChange={handleSimSpeedChange}
        onShowSeasonStats={handleOpenSeasonStats}
      />
      <div className="games-stack">
        {Array.from({ length: GAME_COUNT }).map((_, index) => (
          <GameView
            key={index}
            ref={(instance) => { gameRefs.current[index] = instance; }}
            gameIndex={index}
            label={`Game ${index + 1}`}
            resetSignal={resetSignal}
            onGameComplete={handleGameComplete}
            onManualReset={handleGameReset}
            globalRunning={globalRunning}
            simSpeed={simSpeed}
            parallelSlotCount={GAME_COUNT}
          />
        ))}
      </div>
      <Modal
        open={seasonStatsOpen}
        onClose={() => setSeasonStatsOpen(false)}
        title={modalTitle}
        width="min(96vw, 960px)"
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {Array.from({ length: GAME_COUNT }).map((_, index) => {
            const data = seasonStatsData[index];
            const isActive = index === seasonStatsActiveIndex;
            return (
              <button
                key={index}
                type="button"
                onClick={() => handleSelectSeasonStats(index)}
                disabled={!data}
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(26,122,26,0.7)',
                  background: isActive ? 'rgba(30,120,30,0.85)' : 'transparent',
                  color: data ? '#e8ffe8' : 'rgba(232,255,232,0.4)',
                  cursor: data ? 'pointer' : 'default',
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  opacity: data ? 1 : 0.6,
                }}
              >
                Game {index + 1}
              </button>
            );
          })}
        </div>
        {activeSeasonStats ? (
          <SeasonStatsContent
            season={activeSeasonStats.season}
            currentMatchup={activeSeasonStats.currentMatchup}
            currentScores={activeSeasonStats.currentScores}
            lastCompletedGame={activeSeasonStats.lastCompletedGame}
          />
        ) : (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            Season statistics are not available yet.
          </div>
        )}
      </Modal>
    </div>
  );
}
