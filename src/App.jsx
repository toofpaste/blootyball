// src/App.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameView from './GameView';
import GlobalControls from './ui/GlobalControls';
import Modal from './ui/Modal';
import { SeasonStatsContent } from './ui/SeasonStatsModal';
import './AppLayout.css';

const GAME_COUNT = 2;
const RESET_DELAY_MS = 1200;

function cloneTeamEntry(team = {}) {
  const record = team.record || {};
  const stats = team.stats || {};
  const safeStats = Object.keys(stats).reduce((acc, key) => {
    acc[key] = Number.isFinite(stats[key]) ? stats[key] : 0;
    return acc;
  }, {});
  return {
    ...team,
    pointsFor: Number.isFinite(team.pointsFor) ? team.pointsFor : 0,
    pointsAgainst: Number.isFinite(team.pointsAgainst) ? team.pointsAgainst : 0,
    record: {
      wins: Number.isFinite(record.wins) ? record.wins : 0,
      losses: Number.isFinite(record.losses) ? record.losses : 0,
      ties: Number.isFinite(record.ties) ? record.ties : 0,
    },
    stats: {
      passingYards: Number.isFinite(safeStats.passingYards) ? safeStats.passingYards : 0,
      passingTD: Number.isFinite(safeStats.passingTD) ? safeStats.passingTD : 0,
      rushingYards: Number.isFinite(safeStats.rushingYards) ? safeStats.rushingYards : 0,
      rushingTD: Number.isFinite(safeStats.rushingTD) ? safeStats.rushingTD : 0,
      receivingYards: Number.isFinite(safeStats.receivingYards) ? safeStats.receivingYards : 0,
      receivingTD: Number.isFinite(safeStats.receivingTD) ? safeStats.receivingTD : 0,
      tackles: Number.isFinite(safeStats.tackles) ? safeStats.tackles : 0,
      sacks: Number.isFinite(safeStats.sacks) ? safeStats.sacks : 0,
      interceptions: Number.isFinite(safeStats.interceptions) ? safeStats.interceptions : 0,
    },
  };
}

function cloneResult(result) {
  if (!result) return null;
  return {
    ...result,
    score: { ...(result.score || {}) },
  };
}

function cloneScheduleGame(game) {
  if (!game) return null;
  return {
    ...game,
    result: game.result ? cloneResult(game.result) : game.result,
  };
}

function cloneSeason(season) {
  if (!season) return null;
  const teams = Object.entries(season.teams || {}).reduce((acc, [id, team]) => {
    acc[id] = cloneTeamEntry(team);
    return acc;
  }, {});
  const schedule = Array.isArray(season.schedule)
    ? season.schedule.map((game) => cloneScheduleGame(game))
    : [];
  const results = Array.isArray(season.results)
    ? season.results.map((result) => cloneResult(result)).filter(Boolean)
    : [];

  return {
    ...season,
    teams,
    schedule,
    results,
    completedGames: Number.isFinite(season.completedGames)
      ? season.completedGames
      : results.length,
  };
}

function mergeTeamEntry(target, source = {}) {
  if (!target) return;
  const record = source.record || {};
  const stats = source.stats || {};
  target.pointsFor += Number.isFinite(source.pointsFor) ? source.pointsFor : 0;
  target.pointsAgainst += Number.isFinite(source.pointsAgainst) ? source.pointsAgainst : 0;
  target.record.wins += Number.isFinite(record.wins) ? record.wins : 0;
  target.record.losses += Number.isFinite(record.losses) ? record.losses : 0;
  target.record.ties += Number.isFinite(record.ties) ? record.ties : 0;

  const mergeStat = (key) => {
    const value = Number.isFinite(stats[key]) ? stats[key] : 0;
    target.stats[key] = (target.stats[key] || 0) + value;
  };

  mergeStat('passingYards');
  mergeStat('passingTD');
  mergeStat('rushingYards');
  mergeStat('rushingTD');
  mergeStat('receivingYards');
  mergeStat('receivingTD');
  mergeStat('tackles');
  mergeStat('sacks');
  mergeStat('interceptions');
}

function mergeSeasonData(target, source) {
  if (!target || !source) return;

  Object.entries(source.teams || {}).forEach(([id, team]) => {
    if (!target.teams[id]) {
      target.teams[id] = cloneTeamEntry(team);
      return;
    }
    mergeTeamEntry(target.teams[id], team);
  });

  const seenResults = new Set(
    (target.results || []).map((result) => result?.gameId || result?.index),
  );

  (source.results || []).forEach((result) => {
    const key = result?.gameId || result?.index;
    if (key == null || seenResults.has(key)) return;
    target.results.push(cloneResult(result));
    seenResults.add(key);
  });

  const schedule = Array.isArray(source.schedule) ? source.schedule : [];
  schedule.forEach((game, index) => {
    if (!game) return;
    const played = game.played || (game.result && Object.keys(game.result).length);
    if (!played) return;
    const existing = target.schedule[index] ? cloneScheduleGame(target.schedule[index]) : null;
    target.schedule[index] = {
      ...(existing || {}),
      ...cloneScheduleGame(game),
      played: true,
    };
  });

  target.completedGames = target.results.length;
}

function pickCurrentMatchup(snapshots) {
  const withMatchups = snapshots
    .map((entry, index) => ({
      index,
      matchup: entry.currentMatchup,
      scores: entry.currentScores,
    }))
    .filter((entry) => entry.matchup);

  if (!withMatchups.length) return { matchup: null, scores: {} };

  withMatchups.sort((a, b) => {
    const aIdx = a.matchup?.index ?? Infinity;
    const bIdx = b.matchup?.index ?? Infinity;
    return aIdx - bIdx;
  });

  const { matchup, scores } = withMatchups[0];
  return { matchup, scores: scores || {} };
}

function pickLastCompletedGame(snapshots) {
  const completed = snapshots
    .map((entry) => entry.lastCompletedGame)
    .filter((game) => game && game.matchup);

  if (!completed.length) return null;

  completed.sort((a, b) => {
    const aIdx = a.matchup?.index ?? -1;
    const bIdx = b.matchup?.index ?? -1;
    return bIdx - aIdx;
  });

  const latest = completed[0];
  return {
    ...latest,
    matchup: latest.matchup ? { ...latest.matchup } : null,
    scores: latest.scores ? { ...latest.scores } : {},
  };
}

function combineSeasonSnapshots(rawSnapshots) {
  const snapshots = rawSnapshots
    .map((snapshot, index) => ({
      snapshot,
      season: snapshot?.season || null,
      index,
    }))
    .filter((entry) => entry.season);

  if (!snapshots.length) return null;

  snapshots.sort((a, b) => {
    const aOffset = a.season?.assignmentOffset ?? a.season?.currentGameIndex ?? 0;
    const bOffset = b.season?.assignmentOffset ?? b.season?.currentGameIndex ?? 0;
    return aOffset - bOffset;
  });

  const [first, ...rest] = snapshots;
  const combinedSeason = cloneSeason(first.season);

  rest.forEach(({ season }) => {
    mergeSeasonData(combinedSeason, season);
  });

  combinedSeason.results = (combinedSeason.results || []).slice().sort((a, b) => {
    const aIdx = a?.index ?? 0;
    const bIdx = b?.index ?? 0;
    return aIdx - bIdx;
  });
  combinedSeason.completedGames = combinedSeason.results.length;

  const seasonLengths = snapshots
    .map(({ season }) => season?.schedule?.length)
    .filter((value) => Number.isFinite(value));
  if (seasonLengths.length) {
    const maxLength = Math.max(...seasonLengths);
    combinedSeason.schedule = Array.from({ length: maxLength }).map((_, idx) => {
      return cloneScheduleGame(combinedSeason.schedule[idx]) || null;
    });
  }

  const current = pickCurrentMatchup(snapshots.map(({ snapshot }) => snapshot));
  const lastCompleted = pickLastCompletedGame(snapshots.map(({ snapshot }) => snapshot));

  const nextIndexCandidates = snapshots
    .map(({ season }) => season?.currentGameIndex)
    .filter((value) => Number.isFinite(value));
  if (nextIndexCandidates.length) {
    combinedSeason.currentGameIndex = Math.min(...nextIndexCandidates);
  }

  return {
    label: 'Season Totals',
    season: combinedSeason,
    currentMatchup: current.matchup,
    currentScores: current.scores,
    lastCompletedGame: lastCompleted,
  };
}

export default function App() {
  const [completionFlags, setCompletionFlags] = useState(() => Array(GAME_COUNT).fill(false));
  const autoResumeRef = useRef(Array(GAME_COUNT).fill(false));
  const [resetSignal, setResetSignal] = useState({ token: 0, autoResume: Array(GAME_COUNT).fill(false) });
  const [globalRunning, setGlobalRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [seasonStatsOpen, setSeasonStatsOpen] = useState(false);
  const [seasonStatsSnapshots, setSeasonStatsSnapshots] = useState(() => []);
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

    setSeasonStatsSnapshots(snapshots);
    setSeasonStatsOpen(true);
  }, []);

  const aggregatedSeasonStats = useMemo(
    () => combineSeasonSnapshots(seasonStatsSnapshots),
    [seasonStatsSnapshots],
  );

  const modalTitle = aggregatedSeasonStats?.label
    ? `Season Overview • ${aggregatedSeasonStats.label}`
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
        {aggregatedSeasonStats ? (
          <SeasonStatsContent
            season={aggregatedSeasonStats.season}
            currentMatchup={aggregatedSeasonStats.currentMatchup}
            currentScores={aggregatedSeasonStats.currentScores}
            lastCompletedGame={aggregatedSeasonStats.lastCompletedGame}
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
