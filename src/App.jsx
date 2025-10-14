// src/App.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import GameView from './GameView';
import './AppLayout.css';

const GAME_COUNT = 2;
const RESET_DELAY_MS = 1200;

export default function App() {
  const [completionFlags, setCompletionFlags] = useState(() => Array(GAME_COUNT).fill(false));
  const autoResumeRef = useRef(Array(GAME_COUNT).fill(false));
  const [resetSignal, setResetSignal] = useState({ token: 0, autoResume: Array(GAME_COUNT).fill(false) });

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
      setResetSignal(prev => ({
        token: prev.token + 1,
        autoResume,
      }));
      setCompletionFlags(Array(GAME_COUNT).fill(false));
    }, RESET_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [completionFlags]);

  return (
    <div className="app-root">
      <div className="games-stack">
        {Array.from({ length: GAME_COUNT }).map((_, index) => (
          <GameView
            key={index}
            gameIndex={index}
            label={`Game ${index + 1}`}
            resetSignal={resetSignal}
            onGameComplete={handleGameComplete}
            onManualReset={handleGameReset}
          />
        ))}
      </div>
    </div>
  );
}
