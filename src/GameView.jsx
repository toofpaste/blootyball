import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Scoreboard from './ui/Scoreboard';
import { FIELD_PIX_W, FIELD_PIX_H, COLORS, TEAM_RED, TEAM_BLK } from './engine/constants';
import { createInitialGameState, resumeAssignedMatchup, stepGame, progressOffseason } from './engine/state';
import { DEFAULT_OFFSEASON_DAY_DURATION_MS } from './engine/personnel';
import { getDiagnostics } from './engine/diagnostics';
import PlayLog from './ui/PlayLog';
import StatsSummary from './ui/StatsSummary';
import Modal from './ui/Modal';
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
  seasonConfig = null,
}, ref) {
  const canvasRef = useRef(null);
  const [localRunning, setLocalRunning] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [state, setState] = useState(() => createInitialGameState({
    assignmentOffset: gameIndex,
    assignmentStride: parallelSlotCount,
    lockstepAssignments: true,
    seasonConfig,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastResetTokenRef = useRef(resetSignal?.token ?? 0);
  const notifiedCompleteRef = useRef(false);
  const prevGlobalRunningRef = useRef(globalRunning);
  const runningTransitionRef = useRef(globalRunning);
  const lastSeasonConfigRef = useRef(seasonConfig);

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
    advanceOffseasonDay() {
      setState((prev) => {
        const offseason = prev?.league?.offseason;
        if (!offseason || !offseason.active || offseason.nextSeasonReady) {
          return prev;
        }
        const nowTs = Date.now();
        const next = {
          ...prev,
          league: {
            ...prev.league,
            offseason: {
              ...offseason,
              nextDayAt: nowTs,
            },
          },
        };
        return progressOffseason(next, nowTs);
      });
    },
  }), [label, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.round(LOGICAL_W * dpr);
    canvas.height = Math.round(LOGICAL_H * dpr);
    canvas.style.width = '100%';
    canvas.style.maxWidth = 'min(100%, 900px)';
    canvas.style.height = 'auto';
  }, []);

  useEffect(() => {
    let rafId;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000) * simSpeed;
      last = now;
      if (globalRunning && localRunning) {
        setState((prev) => {
          const next = stepGame(prev, dt);
          stateRef.current = next;
          return next;
        });
      }
      const snapshot = stateRef.current;
      if (canvasRef.current && snapshot) {
        drawSafe(canvasRef.current, snapshot);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      if (typeof performance !== 'undefined' && typeof performance.clearMeasures === 'function') {
        performance.clearMeasures();
      }
    };
  }, [globalRunning, localRunning, simSpeed]);

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
    if (!globalRunning) return undefined;
    const interval = setInterval(() => {
      setState((prev) => {
        const next = progressOffseason(prev);
        return next === prev ? prev : next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [globalRunning]);

  useEffect(() => {
    const previous = runningTransitionRef.current;
    runningTransitionRef.current = globalRunning;
    if (previous === globalRunning) return;
    setState((prev) => {
      const offseason = prev?.league?.offseason;
      if (!offseason || !offseason.active || offseason.nextSeasonReady) {
        return prev;
      }
      const duration = offseason.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS;
      const nowTs = Date.now();
      const next = { ...prev, league: { ...prev.league, offseason: { ...offseason } } };
      const off = next.league.offseason;
      if (globalRunning) {
        const remaining = Number.isFinite(off.pausedRemainingMs)
          ? Math.max(0, off.pausedRemainingMs)
          : (off.currentDay > 0 && off.nextDayAt
            ? Math.max(0, off.nextDayAt - nowTs)
            : duration);
        off.nextDayAt = nowTs + remaining;
        off.lastAdvancedAt = nowTs;
        if ('pausedRemainingMs' in off) delete off.pausedRemainingMs;
      } else {
        const remaining = off.nextDayAt ? Math.max(0, off.nextDayAt - nowTs) : duration;
        off.pausedRemainingMs = remaining;
        off.nextDayAt = nowTs + remaining;
        off.lastAdvancedAt = nowTs;
      }
      return next;
    });
  }, [globalRunning]);

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
    const offseason = state?.league?.offseason;
    if (!offseason) return;
    if (!offseason.nextSeasonReady || offseason.nextSeasonStarted) return;
    setState((prev) => {
      const next = progressOffseason(prev);
      return next === prev ? prev : next;
    });
  }, [state]);

  useEffect(() => {
    const token = resetSignal?.token ?? 0;
    const previousConfig = lastSeasonConfigRef.current;
    const currentConfig = seasonConfig;
    const prevLong = previousConfig?.longSeason ?? false;
    const nextLong = currentConfig?.longSeason ?? false;
    const configChanged = prevLong !== nextLong;
    lastSeasonConfigRef.current = currentConfig;
    if (!configChanged && token === lastResetTokenRef.current) return;
    lastResetTokenRef.current = token;
    const shouldResume = !configChanged && !!resetSignal?.autoResume?.[gameIndex];
    notifiedCompleteRef.current = false;
    setState((prev) => {
      if (prev && !configChanged) {
        const resumed = resumeAssignedMatchup(prev);
        if (resumed !== prev) {
          return resumed;
        }
      }
      return createInitialGameState({
        assignmentOffset: gameIndex,
        assignmentStride: parallelSlotCount,
        league: configChanged ? null : (prev?.league || null),
        lockstepAssignments: true,
        seasonConfig,
      });
    });
    setLocalRunning(shouldResume);
    onManualReset?.(gameIndex);
  }, [resetSignal, gameIndex, onManualReset, parallelSlotCount, seasonConfig]);

  const offseasonBlockingGames = Boolean(
    state?.league?.offseason?.active && !state?.league?.offseason?.nextSeasonStarted,
  );

  useEffect(() => {
    if (offseasonBlockingGames) {
      if (localRunning) {
        setLocalRunning(false);
      }
    } else if (
      globalRunning
      && !state.gameComplete
      && (!prevGlobalRunningRef.current || !localRunning)
    ) {
      setLocalRunning(true);
    }
    prevGlobalRunningRef.current = globalRunning;
  }, [
    globalRunning,
    state.gameComplete,
    localRunning,
    offseasonBlockingGames,
  ]);

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
  const statsTeams = [awayStatsTeam, homeStatsTeam].filter(Boolean);
  const hasStatsTeams = statsTeams.length > 0;

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
        onShowStats={hasStatsTeams ? () => setStatsModalOpen(true) : undefined}
      />
      <div className="game-instance__body">
        <div className="field-shell">
          <canvas ref={canvasRef} className="field-canvas" />
        </div>
        <PlayLog items={state.playLog} />
      </div>
      <Modal
        open={statsModalOpen && hasStatsTeams}
        onClose={() => setStatsModalOpen(false)}
        title="Game Leaders"
        width="min(94vw, 680px)"
      >
        {hasStatsTeams ? (
          <StatsSummary
            stats={state.playerStats}
            directory={state.playerDirectory}
            teams={statsTeams}
            title="Game Leaders"
            injuredReserve={state.league?.injuredReserve || {}}
          />
        ) : (
          <div style={{ padding: '16px', color: '#cfe9cf' }}>No player stats recorded yet.</div>
        )}
      </Modal>
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
