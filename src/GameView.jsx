import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import Field3D from './render/Field3D';
import './AppLayout.css';

function fmtClock(seconds) {
  const m = Math.floor(seconds / 60);
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${ss}`;
}

function enforceFinalSeconds(state, reason = 'Final seconds mode enabled') {
  if (!state) return state;

  const currentQuarter = state.clock?.quarter ?? 1;
  const currentTime = state.clock?.time ?? 900;
  const needsClockAdjustment = currentQuarter !== 4 || currentTime > 5;
  const alreadyBoosted = state.__finalSecondsMeta?.boostedTeam != null;

  if (!needsClockAdjustment && alreadyBoosted) {
    return state;
  }

  const nextState = { ...state };

  if (needsClockAdjustment) {
    nextState.clock = {
      ...(state.clock || {}),
      quarter: 4,
      time: 5,
      running: false,
      awaitSnap: true,
      stopReason: reason,
    };
  }

  if (!alreadyBoosted) {
    const baseScores = state.scores || {};
    const boostedTeam = Math.random() < 0.5 ? TEAM_RED : TEAM_BLK;
    const boostAmount = 25 + Math.floor(Math.random() * 21);
    nextState.scores = {
      [TEAM_RED]: baseScores?.[TEAM_RED] ?? 0,
      [TEAM_BLK]: baseScores?.[TEAM_BLK] ?? 0,
    };
    nextState.scores[boostedTeam] = Math.max(nextState.scores[boostedTeam], boostAmount);
    nextState.__finalSecondsMeta = {
      ...(state.__finalSecondsMeta || {}),
      boostedTeam,
      boostedScore: nextState.scores[boostedTeam],
    };
  }

  return nextState;
}

const GameView = React.forwardRef(function GameView({
  gameIndex,
  label,
  resetSignal,
  onGameComplete,
  onManualReset,
  globalRunning = false,
  simSpeed = 1,
  parallelSlotCount = 1,
  assignmentOffset = null,
  seasonConfig = null,
  startAtFinalSeconds = false,
  collapsed = false,
  onRequestView,
}, ref) {
  const [localRunning, setLocalRunning] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [state, setState] = useState(() => {
    const baseState = createInitialGameState({
      assignmentOffset: assignmentOffset ?? gameIndex,
      assignmentStride: parallelSlotCount,
      lockstepAssignments: true,
      seasonConfig,
    });
    return startAtFinalSeconds
      ? enforceFinalSeconds(baseState, 'Final seconds mode enabled')
      : baseState;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const commitState = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      stateRef.current = next;
      return next;
    });
  }, []);
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
      commitState((prev) => {
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
  }), [commitState, label, state]);

  useEffect(() => {
    let rafId;
    let last = performance.now();
    let accumulator = 0;
    let lastRenderedState = stateRef.current;
    let forceSync = true;
    const fixedStep = 1 / 120;
    const maxStepsPerFrame = Math.max(12, Math.ceil(simSpeed * 6));
    const maxDelta = 0.125;

    const loop = (now) => {
      const rawDelta = (now - last) / 1000;
      const clampedDelta = Math.min(maxDelta, Math.max(0, rawDelta));
      last = now;

      if (globalRunning && localRunning) {
        accumulator += clampedDelta * simSpeed;
        let steps = 0;
        while (accumulator >= fixedStep && steps < maxStepsPerFrame) {
          const nextState = stepGame(stateRef.current, fixedStep);
          if (nextState !== stateRef.current) {
            stateRef.current = nextState;
          }
          accumulator -= fixedStep;
          steps += 1;
        }
        if (steps === maxStepsPerFrame) {
          accumulator = 0;
        }
      } else {
        accumulator = 0;
      }

      const needsSync = forceSync || stateRef.current !== lastRenderedState;

      if (needsSync) {
        lastRenderedState = stateRef.current;
        forceSync = false;
        commitState(() => lastRenderedState);
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
  }, [commitState, globalRunning, localRunning, simSpeed]);

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
      commitState((prev) => progressOffseason(prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [commitState, globalRunning]);

  useEffect(() => {
    const previous = runningTransitionRef.current;
    runningTransitionRef.current = globalRunning;
    if (previous === globalRunning) return;
    commitState((prev) => {
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
  }, [commitState, globalRunning]);

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
    commitState((prev) => progressOffseason(prev));
  }, [commitState, state]);

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
    commitState((prev) => {
      if (prev && !configChanged) {
        const resumed = resumeAssignedMatchup(prev);
        const adjusted = startAtFinalSeconds
          ? enforceFinalSeconds(resumed, 'Final seconds mode enabled')
          : resumed;
        if (adjusted !== prev) {
          return adjusted;
        }
      }
      const nextState = createInitialGameState({
        assignmentOffset: assignmentOffset ?? gameIndex,
        assignmentStride: parallelSlotCount,
        league: configChanged ? null : (prev?.league || null),
        lockstepAssignments: true,
        seasonConfig,
      });
      const adjusted = startAtFinalSeconds
        ? enforceFinalSeconds(nextState, 'Final seconds mode enabled')
        : nextState;
      return adjusted;
    });
    setLocalRunning(shouldResume);
    onManualReset?.(gameIndex);
  }, [
    assignmentOffset,
    commitState,
    gameIndex,
    onManualReset,
    parallelSlotCount,
    resetSignal,
    seasonConfig,
    startAtFinalSeconds,
  ]);

  useEffect(() => {
    if (!startAtFinalSeconds) return;
    commitState((prev) => {
      const adjusted = enforceFinalSeconds(prev, 'Final seconds mode enabled');
      if (adjusted === prev) return prev;
      return adjusted;
    });
  }, [commitState, startAtFinalSeconds]);

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
  const scheduledGames = Number.isFinite(season.schedule?.length) ? season.schedule.length : null;
  const totalAssignedGames = season.assignmentTotalGames || season.assignment?.totalGames || 0;
  const totalGames = scheduledGames || totalAssignedGames || 0;
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
    const teamLabel = identity?.abbr || entry?.info?.abbr || displayName;
    const timeoutPool = state.clock?.timeouts || state.lastCompletedGame?.clock?.timeouts || {};
    const rawTimeouts = timeoutPool?.[slot];
    const timeoutsRemaining = Number.isFinite(rawTimeouts)
      ? Math.max(0, Math.min(3, Math.floor(rawTimeouts)))
      : 3;
    return {
      id: teamId || slot,
      displayName,
      label: teamLabel,
      abbr: teamLabel,
      recordText,
      score: activeScores?.[slot] ?? 0,
      color: resolvedColor,
      info: entry?.info || identity || {},
      timeoutsRemaining,
      timeoutsTotal: 3,
    };
  };

  const homeTeam = buildTeam(TEAM_RED);
  const awayTeam = buildTeam(TEAM_BLK);

  let gameLabel = '';
  const resolveGameNumber = (indexValue) => {
    if (!Number.isFinite(indexValue)) return 1;
    return Math.max(1, Math.floor(indexValue) + 1);
  };
  const formatGameProgress = (gameNumber, prefix = '') => {
    if (!Number.isFinite(gameNumber)) return prefix || '';
    const safeNumber = totalGames > 0 ? Math.min(gameNumber, totalGames) : gameNumber;
    const progressText = totalGames > 0
      ? `Game ${safeNumber} of ${totalGames}`
      : `Game ${safeNumber}`;
    return prefix ? `${prefix} ${progressText}` : progressText;
  };
  if (activeMatchup?.tag === 'playoff-championship') {
    gameLabel = 'BluperBowl';
  } else if (activeMatchup?.tag === 'playoff-semifinal') {
    gameLabel = activeMatchup.round ? `Playoffs • ${activeMatchup.round}` : 'Playoffs • Semifinal';
  } else {
    if (!activeMatchup && state.gameComplete) {
      gameLabel = 'Season complete';
    } else if (activeMatchup) {
      const index = activeMatchup.index != null ? activeMatchup.index : season.currentGameIndex;
      const gameNumber = resolveGameNumber(index);
      if (Number.isFinite(gameNumber)) {
        gameLabel = formatGameProgress(gameNumber);
      }
    } else if (fallbackMatchup) {
      const index = fallbackMatchup.index != null ? fallbackMatchup.index : (season.completedGames ?? 1) - 1;
      const safeIndex = Number.isFinite(index) ? index : 0;
      const gameNumber = resolveGameNumber(safeIndex);
      if (Number.isFinite(gameNumber)) {
        gameLabel = formatGameProgress(gameNumber, 'Final •');
      }
    }
  }

  const isValidTeam = (team) => team.id && team.id !== TEAM_RED && team.id !== TEAM_BLK;
  const homeStatsTeam = isValidTeam(homeTeam) ? homeTeam : null;
  const awayStatsTeam = isValidTeam(awayTeam) ? awayTeam : null;
  const statsTeams = [awayStatsTeam, homeStatsTeam].filter(Boolean);
  const hasStatsTeams = statsTeams.length > 0;

  const rootClassName = collapsed ? 'game-instance game-instance--collapsed' : 'game-instance';

  const handleRequestView = useCallback(() => {
    if (typeof onRequestView !== 'function') return;
    onRequestView(gameIndex);
  }, [gameIndex, onRequestView]);

  return (
    <section className={rootClassName} data-collapsed={collapsed ? 'true' : 'false'}>
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
        collapsed={collapsed}
        onRequestView={handleRequestView}
      />
      {collapsed ? null : (
        <div className="game-instance__body">
          <div className="field-shell">
            <Field3D state={state} />
          </div>
          <PlayLog items={state.playLog} />
        </div>
      )}
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

export default GameView;
