// src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import Toolbar from './ui/Toolbar';
import Scoreboard from './ui/Scoreboard';
import { FIELD_PIX_W, FIELD_PIX_H } from './engine/constants';
import { createInitialGameState, stepGame, betweenPlays, withForceNextOutcome, withForceNextPlay } from './engine/state';
import { getDiagnostics } from './engine/diagnostics';
import { TEAM_RED, TEAM_BLK } from './engine/constants';
import { draw } from './render/draw';
import PlayLog from './ui/PlayLog';
import StatsSummary from './ui/StatsSummary';

export default function App() {
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [state, setState] = useState(() => createInitialGameState());

  const LOGICAL_W = FIELD_PIX_H;
  const LOGICAL_H = FIELD_PIX_W;

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    canvas.style.width = `${LOGICAL_W}px`;
    canvas.style.height = `${LOGICAL_H}px`;
  }, []);

  useEffect(() => {
    let rafId; let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000) * simSpeed; last = now;
      if (running) setState(prev => stepGame(prev, dt));
      draw(canvasRef.current, state);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [running, simSpeed, state]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__blootyball = {
        state,
        diagnostics: getDiagnostics(state),
      };
    }
  }, [state]);

  const onNextPlay = () => setState(s => betweenPlays(s));
  const onReset = () => { setState(createInitialGameState()); setRunning(false); };

  // new handlers for debug tools
  const handleForcePlayName = (nameOrNull) => {
    setState(s => withForceNextPlay(s, nameOrNull));
  };
  const handleForceOutcome = (outcomeOrNull) => {
    setState(s => withForceNextOutcome(s, outcomeOrNull));
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b3d0b',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingBottom: 24,
        color: '#e8ffe8',
      }}
    >
      <Toolbar
        running={running}
        setRunning={setRunning}
        simSpeed={simSpeed}
        setSimSpeed={setSimSpeed}
        yardLine={Math.round(state.drive.losYards)}
        down={state.drive.down}
        toGo={Math.max(1, Math.round(state.drive.toGo))}
        quarter={state.clock.quarter}
        timeLeft={fmtClock(state.clock.time)}
        result={state.play.resultText}
        onNextPlay={onNextPlay}
        onReset={onReset}
        // new debug props
        onForcePlayName={handleForcePlayName}
        onForceOutcome={handleForceOutcome}
        forcedPlayName={state.debug?.forceNextPlayName || null}
        forceOutcome={state.debug?.forceNextOutcome || null}
      />
      <Scoreboard
        redScore={state.scores?.[TEAM_RED] ?? 0}
        blkScore={state.scores?.[TEAM_BLK] ?? 0}
        quarter={state.clock.quarter}
        timeLeftText={fmtClock(state.clock.time)}
        down={state.drive.down}
        toGo={state.drive.toGo}
      />
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px',
          gap: '18px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 'min(1200px, 98%)',
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PlayLog items={state.playLog} />
          </div>
          <div
            style={{
              flex: '1 1 600px',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                borderRadius: 12,
                boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
                background: '#0a7f2e',
                maxWidth: '100%',
              }}
            />
          </div>
          <div style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <StatsSummary
              stats={state.playerStats}
              directory={state.playerDirectory}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtClock(s) {
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}
