// src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import Toolbar from './ui/Toolbar';
import Scoreboard from './ui/Scoreboard';
import { FIELD_PIX_W, FIELD_PIX_H } from './engine/constants';
import { createInitialGameState, stepGame, betweenPlays, withForceNextOutcome, withForceNextPlay } from './engine/state';
import { TEAM_RED, TEAM_BLK } from './engine/constants';
import { draw } from './render/draw';
import PlayLog from './ui/PlayLog';

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
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100vh', background: '#0b3d0b' }}>
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
      <div style={{ display: 'grid', placeItems: 'center', padding: '8px', overflow: 'auto' }}>
        <canvas
          ref={canvasRef}
          style={{ borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', background: '#0a7f2e' }}
        />
        <PlayLog items={state.playLog.slice(-10)} />
      </div>
    </div>
  );
}

function fmtClock(s) {
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}
