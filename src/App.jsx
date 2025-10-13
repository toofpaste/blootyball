// src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import Toolbar from './ui/Toolbar';
import Scoreboard from './ui/Scoreboard';
import { FIELD_PIX_W, FIELD_PIX_H, COLORS } from './engine/constants';
import { createInitialGameState, stepGame, betweenPlays, withForceNextOutcome, withForceNextPlay } from './engine/state';
import { getDiagnostics } from './engine/diagnostics';
import { TEAM_RED, TEAM_BLK } from './engine/constants';
import { draw } from './render/draw';
import PlayLog from './ui/PlayLog';
import StatsSummary from './ui/StatsSummary';
import SeasonStatsModal from './ui/SeasonStatsModal';
import { formatRecord } from './engine/league';
import { resolveTeamColor } from './engine/colors';
import './AppLayout.css';

export default function App() {
  const canvasRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [state, setState] = useState(() => createInitialGameState());
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);

  const LOGICAL_W = FIELD_PIX_H;
  const LOGICAL_H = FIELD_PIX_W;

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    canvas.style.width = '100%';
    canvas.style.maxWidth = `${LOGICAL_W}px`;
    canvas.style.height = 'auto';
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

  useEffect(() => {
    if (state.gameComplete && running) {
      setRunning(false);
    }
  }, [state.gameComplete, running]);

  const season = state.season || {};
  const totalGames = season.schedule?.length || 0;
  const activeMatchup = state.matchup || null;
  const fallbackMatchup = !activeMatchup ? state.lastCompletedGame?.matchup : null;
  const activeScores = activeMatchup ? state.scores : (state.lastCompletedGame?.scores || {});

  const buildTeam = (slot) => {
    const matchupInfo = activeMatchup || fallbackMatchup;
    const teamId = matchupInfo?.slotToTeam?.[slot] || null;
    const entry = teamId ? season.teams?.[teamId] : null;
    const identity = matchupInfo?.identities?.[slot] || entry?.info || null;
    const record = entry?.record || { wins: 0, losses: 0, ties: 0 };
    const recordText = formatRecord(record);
    const colors = (identity?.colors || entry?.info?.colors) || {};
    const defaultColor = slot === TEAM_RED ? COLORS.red : COLORS.black;
    const resolvedColor = resolveTeamColor(colors, defaultColor);
    const displayName = identity?.displayName || entry?.info?.displayName || identity?.name || teamId || slot;
    const label = identity?.abbr || entry?.info?.abbr || displayName;
    return {
      id: teamId || slot,
      displayName,
      label,
      recordText,
      score: activeScores?.[slot] ?? 0,
      color: resolvedColor,
      info: entry?.info || identity || {},
    };
  };

  const homeTeam = buildTeam(TEAM_RED);
  const awayTeam = buildTeam(TEAM_BLK);

  let gameLabel = '';
  if (totalGames) {
    if (!activeMatchup && state.gameComplete) {
      gameLabel = 'Season complete';
    } else if (activeMatchup) {
      const index = activeMatchup.index != null ? activeMatchup.index : season.currentGameIndex;
      gameLabel = `Game ${Math.min((index ?? 0) + 1, totalGames)} of ${totalGames}`;
    } else if (fallbackMatchup) {
      const index = fallbackMatchup.index != null ? fallbackMatchup.index : (season.completedGames ?? 1) - 1;
      const safeIndex = index != null ? index : 0;
      gameLabel = `Final • Game ${Math.min(safeIndex + 1, totalGames)} of ${totalGames}`;
    }
  }

  const statsTeams = [homeTeam, awayTeam].filter(team => team.id && team.id !== TEAM_RED && team.id !== TEAM_BLK);

  const onNextPlay = () => setState(s => betweenPlays(s));
  const onReset = () => { setSeasonModalOpen(false); setState(createInitialGameState()); setRunning(false); };

  // new handlers for debug tools
  const handleForcePlayName = (nameOrNull) => {
    setState(s => withForceNextPlay(s, nameOrNull));
  };
  const handleForceOutcome = (outcomeOrNull) => {
    setState(s => withForceNextOutcome(s, outcomeOrNull));
  };

  return (
    <div className="app-root">
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
        home={homeTeam}
        away={awayTeam}
        quarter={state.clock?.quarter ?? 1}
        timeLeftText={fmtClock(state.clock?.time ?? 0)}
        down={state.drive?.down ?? 1}
        toGo={state.drive?.toGo ?? 10}
        gameLabel={gameLabel}
        onShowSeasonStats={() => setSeasonModalOpen(true)}
      />
      <div className="main-shell">
        <div className="app-layout">
          <div className="sidebar sidebar--log">
            <PlayLog items={state.playLog} />
          </div>
          <div className="field-wrapper">
            <canvas ref={canvasRef} className="field-canvas" />
          </div>
          <div className="sidebar sidebar--stats">
            <StatsSummary
              stats={state.playerStats}
              directory={state.playerDirectory}
              teams={statsTeams}
            />
          </div>
        </div>
      </div>
      <SeasonStatsModal
        open={seasonModalOpen}
        onClose={() => setSeasonModalOpen(false)}
        season={season}
        currentMatchup={activeMatchup}
        currentScores={state.scores}
        lastCompletedGame={state.lastCompletedGame}
      />
    </div>
  );
}

function fmtClock(s) {
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}
