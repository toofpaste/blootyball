import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Scoreboard from './ui/Scoreboard';
import { FIELD_PIX_W, FIELD_PIX_H, COLORS, TEAM_RED, TEAM_BLK } from './engine/constants';
import { createInitialGameState, stepGame } from './engine/state';
import { getDiagnostics } from './engine/diagnostics';
import PlayLog from './ui/PlayLog';
import StatsSummary from './ui/StatsSummary';
import { formatRecord } from './engine/league';
import { resolveTeamColor } from './engine/colors';
import { draw } from './render/draw';
import './AppLayout.css';

function fmtClock(seconds) {
  const m = Math.floor(seconds / 60);
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

const LOGICAL_W = FIELD_PIX_H;
const LOGICAL_H = FIELD_PIX_W;

const GameView = React.forwardRef(function GameView({
  gameIndex,
  label,
  resetSignal,
  onGameComplete,
  onManualReset,
  globalRunning = false,
  simSpeed = 1,
  parallelSlotCount = 1,
}, ref) {
  const canvasRef = useRef(null);
  const [localRunning, setLocalRunning] = useState(false);
  const [state, setState] = useState(() => createInitialGameState({
    assignmentOffset: gameIndex,
    assignmentStride: parallelSlotCount,
  }));
  const lastResetTokenRef = useRef(resetSignal?.token ?? 0);
  const notifiedCompleteRef = useRef(false);
  const prevGlobalRunningRef = useRef(globalRunning);

  useImperativeHandle(ref, () => ({
    getSeasonSnapshot() {
      return {
        label,
        season: state.season,
        currentMatchup: state.matchup,
        currentScores: state.scores,
        lastCompletedGame: state.lastCompletedGame,
        league: state.league,
      };
    },
  }), [label, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    canvas.style.width = '100%';
    canvas.style.maxWidth = `${LOGICAL_W}px`;
    canvas.style.height = 'auto';
  }, []);

  useEffect(() => {
    let rafId;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000) * simSpeed;
      last = now;
      if (globalRunning && localRunning) {
        setState(prev => stepGame(prev, dt));
      }
      if (canvasRef.current) {
        drawSafe(canvasRef.current, state);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [globalRunning, localRunning, simSpeed, state]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__blootyball ||= {};
    window.__blootyball.games ||= [];
    const diagnostics = getDiagnostics(state);
    window.__blootyball.games[gameIndex] = { state, diagnostics };
    if (gameIndex === 0) {
      window.__blootyball.state = state;
      window.__blootyball.diagnostics = diagnostics;
    }
  }, [state, gameIndex]);

  useEffect(() => {
    if (state.gameComplete) {
      if (!notifiedCompleteRef.current) {
        onGameComplete?.(gameIndex, { shouldAutoResume: globalRunning && localRunning });
        notifiedCompleteRef.current = true;
      }
      if (localRunning) setLocalRunning(false);
    } else {
      notifiedCompleteRef.current = false;
    }
  }, [state.gameComplete, globalRunning, localRunning, gameIndex, onGameComplete]);

  useEffect(() => {
    const token = resetSignal?.token ?? 0;
    if (token === lastResetTokenRef.current) return;
    lastResetTokenRef.current = token;
    const shouldResume = !!resetSignal?.autoResume?.[gameIndex];
    notifiedCompleteRef.current = false;
    setState(createInitialGameState({
      assignmentOffset: gameIndex,
      assignmentStride: parallelSlotCount,
      league: state?.league || null,
    }));
    setLocalRunning(shouldResume);
    onManualReset?.(gameIndex);
  }, [resetSignal, gameIndex, onManualReset, parallelSlotCount, state?.league]);

  useEffect(() => {
    if (globalRunning && !prevGlobalRunningRef.current && !state.gameComplete) {
      setLocalRunning(true);
    }
    prevGlobalRunningRef.current = globalRunning;
  }, [globalRunning, state.gameComplete]);

  const season = state.season || {};
  const assignmentStride = season.assignmentStride || season.assignment?.stride || 1;
  const assignmentOffset = season.assignmentOffset ?? season.assignment?.offset ?? 0;
  const totalGames = season.assignmentTotalGames || season.assignment?.totalGames || season.schedule?.length || 0;
  const activeMatchup = state.matchup || null;
  const fallbackMatchup = !activeMatchup ? state.lastCompletedGame?.matchup : null;
  const activeScores = activeMatchup ? state.scores : (state.lastCompletedGame?.scores || {});

  const computeDisplayIndex = (indexValue) => {
    if (indexValue == null || indexValue < 0) return null;
    if (assignmentStride <= 1) return indexValue;
    const normalized = indexValue - assignmentOffset;
    if (normalized < 0) return null;
    return Math.floor(normalized / assignmentStride);
  };

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
    const teamLabel = identity?.abbr || entry?.info?.abbr || displayName;
    return {
      id: teamId || slot,
      displayName,
      label: teamLabel,
      abbr: teamLabel,
      recordText,
      score: activeScores?.[slot] ?? 0,
      color: resolvedColor,
      info: entry?.info || identity || {},
    };
  };

  const homeTeam = buildTeam(TEAM_RED);
  const awayTeam = buildTeam(TEAM_BLK);

  let gameLabel = '';
  if (activeMatchup?.tag === 'playoff-championship') {
    gameLabel = 'BluperBowl';
  } else if (activeMatchup?.tag === 'playoff-semifinal') {
    gameLabel = activeMatchup.round ? `Playoffs • ${activeMatchup.round}` : 'Playoffs • Semifinal';
  } else if (totalGames) {
    if (!activeMatchup && state.gameComplete) {
      gameLabel = 'Season complete';
    } else if (activeMatchup) {
      const index = activeMatchup.index != null ? activeMatchup.index : season.currentGameIndex;
      const displayIndex = computeDisplayIndex(index);
      const gameNumber = displayIndex != null ? displayIndex + 1 : (index != null ? index + 1 : 1);
      gameLabel = `Game ${Math.min(gameNumber, totalGames)} of ${totalGames}`;
    } else if (fallbackMatchup) {
      const index = fallbackMatchup.index != null ? fallbackMatchup.index : (season.completedGames ?? 1) - 1;
      const displayIndex = computeDisplayIndex(index);
      const safeIndex = displayIndex != null ? displayIndex : (index != null ? index : 0);
      gameLabel = `Final • Game ${Math.min(safeIndex + 1, totalGames)} of ${totalGames}`;
    }
  }

  const isValidTeam = (team) => team.id && team.id !== TEAM_RED && team.id !== TEAM_BLK;
  const homeStatsTeam = isValidTeam(homeTeam) ? homeTeam : null;
  const awayStatsTeam = isValidTeam(awayTeam) ? awayTeam : null;

  return (
    <section className="game-instance">
      <h2 className="game-instance__title">{label}</h2>
      <Scoreboard
        home={homeTeam}
        away={awayTeam}
        quarter={state.clock?.quarter ?? 1}
        timeLeftText={fmtClock(state.clock?.time ?? 0)}
        down={state.drive?.down ?? 1}
        toGo={state.drive?.toGo ?? 10}
        gameLabel={gameLabel}
      />
      <div className="main-shell">
        <div className="app-layout">
          {awayStatsTeam ? (
            <div className="stats-column stats-column--away">
              <StatsSummary
                stats={state.playerStats}
                directory={state.playerDirectory}
                teams={[awayStatsTeam]}
                title={`${awayStatsTeam.displayName || awayStatsTeam.label || 'Away'} Leaders`}
              />
            </div>
          ) : null}
          <div className="field-column">
            <div className="field-wrapper">
              <canvas ref={canvasRef} className="field-canvas" />
            </div>
            <PlayLog items={state.playLog} />
          </div>
          {homeStatsTeam ? (
            <div className="stats-column stats-column--home">
              <StatsSummary
                stats={state.playerStats}
                directory={state.playerDirectory}
                teams={[homeStatsTeam]}
                title={`${homeStatsTeam.displayName || homeStatsTeam.label || 'Home'} Leaders`}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function drawSafe(canvas, state) {
  try {
    draw(canvas, state);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to draw game', err);
  }
}

export default GameView;
