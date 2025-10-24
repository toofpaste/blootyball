// src/App.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameView from './GameView';
import GlobalControls from './ui/GlobalControls';
import Modal from './ui/Modal';
import { SeasonStatsContent } from './ui/SeasonStatsModal';
import TeamDirectoryModal from './ui/TeamDirectoryModal';
import LeaderboardsModal from './ui/LeaderboardsModal';
import NewsModal from './ui/NewsModal';
import SeasonScheduleModal from './ui/SeasonScheduleModal';
import FreeAgentModal from './ui/FreeAgentModal';
import PressArticlesModal from './ui/PressArticlesModal';
import { cloneRecordBook } from './engine/league';
import { DEFAULT_OFFSEASON_DAY_DURATION_MS } from './engine/personnel';
import { cloneTeamWikiMap } from './data/teamWikiTemplates';
import RecordBookModal from './ui/RecordBookModal';
import LeagueWikiModal from './ui/LeagueWikiModal';
import { useWikiAiUpdater } from './utils/useWikiAiUpdater';
import './AppLayout.css';
import { PlayerCardProvider } from './ui/PlayerCardProvider';

const GAME_COUNT = 2;
const RESET_DELAY_MS = 1200;
const PLAYOFF_STAGE_ORDER = { regular: 0, semifinals: 1, championship: 2, complete: 3 };

function stageRank(stage) {
  return PLAYOFF_STAGE_ORDER[stage] ?? -1;
}

function formatTickerTimestamp(value) {
  if (!value) return { label: null, iso: null };
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { label: null, iso: null };
    }
    return {
      label: date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      iso: date.toISOString(),
    };
  } catch (err) {
    return { label: null, iso: null };
  }
}

function cloneAwardsEntry(entry) {
  if (!entry) return null;
  return {
    seasonNumber: entry.seasonNumber ?? null,
    mvp: entry.mvp ? { ...entry.mvp } : null,
    offensive: entry.offensive ? { ...entry.offensive } : null,
    defensive: entry.defensive ? { ...entry.defensive } : null,
  };
}

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
    playLog: Array.isArray(result.playLog) ? result.playLog.map((entry) => ({ ...entry })) : [],
    playerStats: clonePlayerStatsMap(result.playerStats || {}),
    playerTeams: { ...(result.playerTeams || {}) },
  };
}

function cloneScheduleGame(game) {
  if (!game) return null;
  return {
    ...game,
    result: game.result ? cloneResult(game.result) : game.result,
  };
}

function scheduleEntryPriority(entry) {
  if (!entry) return -Infinity;
  const tag = String(entry.tag || '');
  let stage = 0;
  if (tag === 'playoff-championship') stage = 3;
  else if (tag === 'playoff-semifinal') stage = 2;
  else if (tag.startsWith('playoff')) stage = 1;
  const playedScore = entry.played ? 2 : 0;
  const resultScore = entry.result ? 1 : 0;
  return stage * 10 + playedScore * 2 + resultScore;
}

function clonePlayerStatEntry(entry = {}) {
  const passing = entry.passing || {};
  const rushing = entry.rushing || {};
  const receiving = entry.receiving || {};
  const defense = entry.defense || {};
  const misc = entry.misc || {};
  const kicking = entry.kicking || {};
  return {
    passing: {
      attempts: passing.attempts ?? 0,
      completions: passing.completions ?? 0,
      yards: passing.yards ?? 0,
      touchdowns: passing.touchdowns ?? 0,
      interceptions: passing.interceptions ?? 0,
      sacks: passing.sacks ?? 0,
      sackYards: passing.sackYards ?? 0,
    },
    rushing: {
      attempts: rushing.attempts ?? 0,
      yards: rushing.yards ?? 0,
      touchdowns: rushing.touchdowns ?? 0,
      fumbles: rushing.fumbles ?? 0,
    },
    receiving: {
      targets: receiving.targets ?? 0,
      receptions: receiving.receptions ?? 0,
      yards: receiving.yards ?? 0,
      touchdowns: receiving.touchdowns ?? 0,
      drops: receiving.drops ?? 0,
    },
    defense: {
      tackles: defense.tackles ?? 0,
      sacks: defense.sacks ?? 0,
      interceptions: defense.interceptions ?? 0,
      forcedFumbles: defense.forcedFumbles ?? 0,
    },
    misc: {
      fumbles: misc.fumbles ?? 0,
    },
    kicking: {
      attempts: kicking.attempts ?? 0,
      made: kicking.made ?? 0,
      long: kicking.long ?? 0,
      patAttempts: kicking.patAttempts ?? 0,
      patMade: kicking.patMade ?? 0,
    },
  };
}

function clonePlayerStatsMap(stats = {}) {
  const map = {};
  Object.entries(stats).forEach(([playerId, entry]) => {
    map[playerId] = clonePlayerStatEntry(entry);
  });
  return map;
}

function mergePlayerStatEntry(target, source = {}) {
  if (!target) return;
  const src = clonePlayerStatEntry(source);
  const dst = target;
  dst.passing.attempts += src.passing.attempts;
  dst.passing.completions += src.passing.completions;
  dst.passing.yards += src.passing.yards;
  dst.passing.touchdowns += src.passing.touchdowns;
  dst.passing.interceptions += src.passing.interceptions;
  dst.passing.sacks += src.passing.sacks;
  dst.passing.sackYards += src.passing.sackYards;

  dst.rushing.attempts += src.rushing.attempts;
  dst.rushing.yards += src.rushing.yards;
  dst.rushing.touchdowns += src.rushing.touchdowns;
  dst.rushing.fumbles += src.rushing.fumbles;

  dst.receiving.targets += src.receiving.targets;
  dst.receiving.receptions += src.receiving.receptions;
  dst.receiving.yards += src.receiving.yards;
  dst.receiving.touchdowns += src.receiving.touchdowns;
  dst.receiving.drops += src.receiving.drops;

  dst.defense.tackles += src.defense.tackles;
  dst.defense.sacks += src.defense.sacks;
  dst.defense.interceptions += src.defense.interceptions;
  dst.defense.forcedFumbles += src.defense.forcedFumbles;

  dst.misc.fumbles += src.misc.fumbles;

  dst.kicking.attempts += src.kicking.attempts;
  dst.kicking.made += src.kicking.made;
  dst.kicking.long = Math.max(dst.kicking.long, src.kicking.long);
  dst.kicking.patAttempts += src.kicking.patAttempts;
  dst.kicking.patMade += src.kicking.patMade;
}

function mergePlayerStatsMap(target, source = {}) {
  if (!target) return;
  Object.entries(source).forEach(([playerId, entry]) => {
    if (!target[playerId]) {
      target[playerId] = clonePlayerStatEntry(entry);
      return;
    }
    mergePlayerStatEntry(target[playerId], entry);
  });
}

function clonePlayerDevelopmentMap(map = {}) {
  const out = {};
  Object.entries(map).forEach(([playerId, attrs]) => {
    out[playerId] = { ...attrs };
  });
  return out;
}

function mergePlayerDevelopmentMap(target, source = {}) {
  if (!target) return;
  Object.entries(source).forEach(([playerId, attrs]) => {
    if (!target[playerId]) {
      target[playerId] = { ...attrs };
      return;
    }
    Object.entries(attrs || {}).forEach(([attr, value]) => {
      if (target[playerId][attr] == null) {
        target[playerId][attr] = value;
      }
    });
  });
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
  const assignmentTotals = Object.entries(season.assignmentTotals || {}).reduce((acc, [teamId, totals]) => {
    acc[teamId] = {
      id: totals.id ?? teamId,
      info: totals.info ? { ...totals.info } : null,
      record: {
        wins: totals.record?.wins ?? 0,
        losses: totals.record?.losses ?? 0,
        ties: totals.record?.ties ?? 0,
      },
      pointsFor: totals.pointsFor ?? 0,
      pointsAgainst: totals.pointsAgainst ?? 0,
      stats: {
        passingYards: totals.stats?.passingYards ?? 0,
        passingTD: totals.stats?.passingTD ?? 0,
        rushingYards: totals.stats?.rushingYards ?? 0,
        rushingTD: totals.stats?.rushingTD ?? 0,
        receivingYards: totals.stats?.receivingYards ?? 0,
        receivingTD: totals.stats?.receivingTD ?? 0,
        tackles: totals.stats?.tackles ?? 0,
        sacks: totals.stats?.sacks ?? 0,
        interceptions: totals.stats?.interceptions ?? 0,
      },
    };
    return acc;
  }, {});

  return {
    ...season,
    teams,
    schedule,
    results,
    assignmentTotals,
    playerStats: clonePlayerStatsMap(season.playerStats || {}),
    playerDevelopment: clonePlayerDevelopmentMap(season.playerDevelopment || {}),
    completedGames: Number.isFinite(season.completedGames)
      ? season.completedGames
      : results.length,
    phase: season.phase || 'regular',
    playoffBracket: season.playoffBracket ? JSON.parse(JSON.stringify(season.playoffBracket)) : null,
    awards: cloneAwardsEntry(season.awards),
    championTeamId: season.championTeamId || null,
    championResult: season.championResult ? cloneResult(season.championResult) : null,
    playerAges: { ...(season.playerAges || {}) },
    previousAwards: Array.isArray(season.previousAwards) ? season.previousAwards.map((entry) => cloneAwardsEntry(entry) || null).filter(Boolean) : [],
    config: season.config ? { ...season.config } : null,
  };
}

function mergeTeamEntry(target, source = {}) {
  if (!target) return;
  const record = source.record || {};
  const stats = source.stats || {};
  const mergeNumeric = (currentValue, incomingValue) => {
    const incoming = Number.isFinite(incomingValue) ? incomingValue : 0;
    const current = Number.isFinite(currentValue) ? currentValue : 0;
    return Math.max(current, incoming);
  };

  target.pointsFor = mergeNumeric(target.pointsFor, source.pointsFor);
  target.pointsAgainst = mergeNumeric(target.pointsAgainst, source.pointsAgainst);
  target.record.wins = mergeNumeric(target.record.wins, record.wins);
  target.record.losses = mergeNumeric(target.record.losses, record.losses);
  target.record.ties = mergeNumeric(target.record.ties, record.ties);

  const mergeStat = (key) => {
    const value = Number.isFinite(stats[key]) ? stats[key] : 0;
    const current = Number.isFinite(target.stats[key]) ? target.stats[key] : 0;
    target.stats[key] = Math.max(current, value);
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

  if (source.config) {
    target.config = target.config ? { ...target.config, ...source.config } : { ...source.config };
  }

  Object.entries(source.teams || {}).forEach(([id, team]) => {
    if (!target.teams[id]) {
      target.teams[id] = cloneTeamEntry(team);
      return;
    }
    mergeTeamEntry(target.teams[id], team);
  });

  target.assignmentTotals ||= {};
  Object.entries(source.assignmentTotals || {}).forEach(([id, totals]) => {
    if (!target.assignmentTotals[id]) {
      target.assignmentTotals[id] = cloneTeamEntry(totals);
      return;
    }
    mergeTeamEntry(target.assignmentTotals[id], totals);
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

  target.playerStats ||= {};
  mergePlayerStatsMap(target.playerStats, source.playerStats || {});

  target.playerDevelopment ||= {};
  mergePlayerDevelopmentMap(target.playerDevelopment, source.playerDevelopment || {});

  target.completedGames = target.results.length;

  if (stageRank(source.phase) > stageRank(target.phase)) {
    target.phase = source.phase;
  }

  if (source.playoffBracket) {
    if (!target.playoffBracket || stageRank(source.playoffBracket.stage) >= stageRank(target.playoffBracket.stage)) {
      target.playoffBracket = JSON.parse(JSON.stringify(source.playoffBracket));
    }
  }

  if (source.awards) {
    target.awards = cloneAwardsEntry(source.awards);
  }

  if (source.championTeamId) {
    target.championTeamId = source.championTeamId;
  }

  if (source.championResult) {
    target.championResult = cloneResult(source.championResult);
  }

  target.playerAges = { ...(target.playerAges || {}), ...(source.playerAges || {}) };

  if (Array.isArray(source.previousAwards) && source.previousAwards.length) {
    const existing = Array.isArray(target.previousAwards) ? target.previousAwards.slice() : [];
    const seen = new Set(existing.map((entry) => entry.seasonNumber));
    source.previousAwards.forEach((entry) => {
      if (!entry) return;
      if (entry.seasonNumber != null && seen.has(entry.seasonNumber)) return;
      existing.push(cloneAwardsEntry(entry));
      if (entry.seasonNumber != null) seen.add(entry.seasonNumber);
    });
    target.previousAwards = existing;
  }
}

function clonePlayerRecordForLeague(player = {}) {
  if (!player) return null;
  return {
    ...player,
    ratings: { ...(player.ratings || {}) },
    modifiers: { ...(player.modifiers || {}) },
    temperament: player.temperament ? { ...player.temperament } : null,
    contract: player.contract ? { ...player.contract } : null,
  };
}

function cloneRosterSide(side = {}) {
  return Object.entries(side).reduce((acc, [role, player]) => {
    if (!player) return acc;
    acc[role] = clonePlayerRecordForLeague(player);
    return acc;
  }, {});
}

function cloneTeamRoster(roster = {}) {
  return {
    offense: cloneRosterSide(roster.offense || roster.off || {}),
    defense: cloneRosterSide(roster.defense || roster.def || {}),
    special: roster.special?.K ? { K: clonePlayerRecordForLeague(roster.special.K) } : {},
  };
}

function cloneNewsFeed(feed = []) {
  return Array.isArray(feed) ? feed.map((entry) => ({ ...entry })) : [];
}

function cloneTeamHistoryEntry(entry = {}) {
  return {
    seasonNumber: entry.seasonNumber ?? null,
    record: {
      wins: entry.record?.wins ?? 0,
      losses: entry.record?.losses ?? 0,
      ties: entry.record?.ties ?? 0,
    },
    pointsFor: entry.pointsFor ?? 0,
    pointsAgainst: entry.pointsAgainst ?? 0,
    pointDifferential:
      entry.pointDifferential != null
        ? entry.pointDifferential
        : (entry.pointsFor ?? 0) - (entry.pointsAgainst ?? 0),
    playoffResult: entry.playoffResult || 'Regular Season',
  };
}

function cloneInjuredReserve(reserve = {}) {
  return Object.entries(reserve).reduce((acc, [playerId, entry]) => {
    acc[playerId] = {
      ...entry,
      player: entry?.player ? clonePlayerRecordForLeague(entry.player) : null,
    };
    return acc;
  }, {});
}

function cloneInjuryLog(log = {}) {
  return Object.entries(log).reduce((acc, [playerId, entry]) => {
    acc[playerId] = {
      ...entry,
      player: entry?.player ? clonePlayerRecordForLeague(entry.player) : null,
    };
    return acc;
  }, {});
}

function cloneLeague(league) {
  if (!league) return null;
  const playerAwards = Object.entries(league.playerAwards || {}).reduce((acc, [playerId, awards]) => {
    acc[playerId] = Array.isArray(awards) ? awards.map((award) => ({ ...award })) : [];
    return acc;
  }, {});
  const teamChampionships = Object.entries(league.teamChampionships || {}).reduce((acc, [teamId, data]) => {
    acc[teamId] = {
      count: data.count || (Array.isArray(data.seasons) ? data.seasons.length : 0),
      seasons: Array.isArray(data.seasons) ? [...data.seasons] : [],
    };
    return acc;
  }, {});
  const playerDirectory = Object.entries(league.playerDirectory || {}).reduce((acc, [playerId, meta]) => {
    acc[playerId] = { ...meta };
    return acc;
  }, {});
  const teamScouts = Object.entries(league.teamScouts || {}).reduce((acc, [teamId, scout]) => {
    acc[teamId] = { ...scout };
    return acc;
  }, {});
  const teamCoaches = Object.entries(league.teamCoaches || {}).reduce((acc, [teamId, coach]) => {
    acc[teamId] = coach
      ? {
        ...coach,
        identity: coach.identity ? { ...coach.identity } : null,
      }
      : null;
    return acc;
  }, {});
  const teamGms = Object.entries(league.teamGms || {}).reduce((acc, [teamId, gm]) => {
    acc[teamId] = gm ? { ...gm } : null;
    return acc;
  }, {});
  const teamMoods = Object.entries(league.teamMoods || {}).reduce((acc, [teamId, mood]) => {
    acc[teamId] = mood ? { ...mood } : null;
    return acc;
  }, {});
  const teamRosters = Object.entries(league.teamRosters || {}).reduce((acc, [teamId, roster]) => {
    acc[teamId] = cloneTeamRoster(roster);
    return acc;
  }, {});
  const freeAgents = Array.isArray(league.freeAgents)
    ? league.freeAgents.map((player) => clonePlayerRecordForLeague(player))
    : [];
  const staffFreeAgents = {
    coaches: Array.isArray(league.staffFreeAgents?.coaches)
      ? league.staffFreeAgents.coaches.map((entry) => ({ ...entry, identity: entry.identity ? { ...entry.identity } : null }))
      : [],
    scouts: Array.isArray(league.staffFreeAgents?.scouts)
      ? league.staffFreeAgents.scouts.map((entry) => ({ ...entry }))
      : [],
    gms: Array.isArray(league.staffFreeAgents?.gms)
      ? league.staffFreeAgents.gms.map((entry) => ({ ...entry }))
      : [],
  };
  const newsFeed = cloneNewsFeed(league.newsFeed || []);
  const injuredReserve = cloneInjuredReserve(league.injuredReserve || {});
  const injuryLog = cloneInjuryLog(league.injuryLog || {});
  const injuryCounts = Object.entries(league.injuryCounts || {}).reduce((acc, [seasonNumber, counts]) => {
    acc[seasonNumber] = { ...(counts || {}) };
    return acc;
  }, {});
  const teamSeasonHistory = Object.entries(league.teamSeasonHistory || {}).reduce((acc, [teamId, seasons]) => {
    acc[teamId] = Array.isArray(seasons) ? seasons.map((entry) => cloneTeamHistoryEntry(entry)) : [];
    return acc;
  }, {});
  const recordBook = cloneRecordBook(league.recordBook || {});
  const teamWiki = cloneTeamWikiMap(league.teamWiki || {});
  const teamWikiAiLog = Array.isArray(league.teamWikiAiLog)
    ? league.teamWikiAiLog.map((entry) => ({ ...entry }))
    : [];
  const teamPayroll = Object.entries(league.teamPayroll || {}).reduce((acc, [teamId, value]) => {
    acc[teamId] = value ?? 0;
    return acc;
  }, {});
  const settings = league.settings ? { ...league.settings } : null;
  if (settings?.season) {
    settings.season = { ...settings.season };
  }
  return {
    ...league,
    playerDevelopment: clonePlayerDevelopmentMap(league.playerDevelopment || {}),
    playerAges: { ...(league.playerAges || {}) },
    careerStats: clonePlayerStatsMap(league.careerStats || {}),
    playerAwards,
    awardsHistory: Array.isArray(league.awardsHistory)
      ? league.awardsHistory.map((entry) => cloneAwardsEntry(entry)).filter(Boolean)
      : [],
    teamChampionships,
    lastChampion: league.lastChampion ? { ...league.lastChampion } : null,
    finalizedSeasonNumber: league.finalizedSeasonNumber ?? null,
    seasonNumber: league.seasonNumber ?? 1,
    playerDirectory,
    teamCoaches,
    teamScouts,
    teamGms,
    teamMoods,
    teamRosters,
    freeAgents,
    staffFreeAgents,
    newsFeed,
    injuredReserve,
    injuryLog,
    injuryCounts,
    seasonSnapshot: league.seasonSnapshot ? cloneSeason(league.seasonSnapshot) : null,
    teamSeasonHistory,
    recordBook,
    teamWiki,
    teamWikiLastUpdatedSeason: league.teamWikiLastUpdatedSeason ?? 0,
    teamWikiAiLog,
    teamPayroll,
    salaryCap: league.salaryCap ?? 100000000,
    settings,
  };
}

function mergeLeagueData(target, source) {
  if (!target || !source) return;
  target.seasonNumber = Math.max(target.seasonNumber || 1, source.seasonNumber || 1);
  if (source.settings) {
    target.settings ||= {};
    Object.entries(source.settings).forEach(([key, value]) => {
      if (key === 'season' && value) {
        target.settings.season = { ...(target.settings.season || {}), ...value };
      } else if (value != null) {
        target.settings[key] = value;
      }
    });
  }
  target.playerDevelopment ||= {};
  mergePlayerDevelopmentMap(target.playerDevelopment, source.playerDevelopment || {});
  target.playerAges = { ...(target.playerAges || {}), ...(source.playerAges || {}) };
  target.careerStats ||= {};
  mergePlayerStatsMap(target.careerStats, source.careerStats || {});

  target.playerAwards ||= {};
  Object.entries(source.playerAwards || {}).forEach(([playerId, awards]) => {
    const existing = target.playerAwards[playerId] ? [...target.playerAwards[playerId]] : [];
    const seen = new Set(existing.map((award) => `${award.award}-${award.season}`));
    (awards || []).forEach((award) => {
      if (!award) return;
      const key = `${award.award}-${award.season}`;
      if (seen.has(key)) return;
      existing.push({ ...award });
      seen.add(key);
    });
    target.playerAwards[playerId] = existing;
  });

  const historyMap = new Map((target.awardsHistory || []).map((entry) => [entry.seasonNumber, entry]));
  (source.awardsHistory || []).forEach((entry) => {
    if (!entry) return;
    if (!historyMap.has(entry.seasonNumber)) {
      const cloned = cloneAwardsEntry(entry);
      if (cloned) historyMap.set(cloned.seasonNumber, cloned);
    }
  });
  target.awardsHistory = Array.from(historyMap.values()).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0));

  target.teamChampionships ||= {};
  Object.entries(source.teamChampionships || {}).forEach(([teamId, data]) => {
    if (!target.teamChampionships[teamId]) {
      target.teamChampionships[teamId] = {
        count: data.count || (Array.isArray(data.seasons) ? data.seasons.length : 0),
        seasons: Array.isArray(data.seasons) ? [...data.seasons] : [],
      };
      return;
    }
    const entry = target.teamChampionships[teamId];
    const seasons = new Set(entry.seasons || []);
    (data.seasons || []).forEach((seasonNumber) => seasons.add(seasonNumber));
    entry.seasons = Array.from(seasons).sort((a, b) => a - b);
    entry.count = entry.seasons.length;
  });

  target.teamSeasonHistory ||= {};
  Object.entries(source.teamSeasonHistory || {}).forEach(([teamId, seasons]) => {
    const existingList = Array.isArray(target.teamSeasonHistory[teamId])
      ? target.teamSeasonHistory[teamId].map((entry) => cloneTeamHistoryEntry(entry))
      : [];
    const existing = new Map(existingList.map((entry, index) => {
      const key = entry.seasonNumber != null ? entry.seasonNumber : `legacy-${index}`;
      return [key, entry];
    }));
    (seasons || []).forEach((entry) => {
      if (!entry) return;
      const cloned = cloneTeamHistoryEntry(entry);
      const key = cloned.seasonNumber != null ? cloned.seasonNumber : `pending-${existing.size}`;
      existing.set(key, cloned);
    });
    const merged = Array.from(existing.values()).sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0));
    target.teamSeasonHistory[teamId] = merged;
  });

  if (!target.lastChampion || (source.lastChampion && (source.lastChampion.seasonNumber || 0) > (target.lastChampion.seasonNumber || 0))) {
    target.lastChampion = source.lastChampion ? { ...source.lastChampion } : target.lastChampion;
  }

  target.finalizedSeasonNumber = Math.max(target.finalizedSeasonNumber || 0, source.finalizedSeasonNumber || 0);

  target.playerDirectory ||= {};
  Object.entries(source.playerDirectory || {}).forEach(([playerId, meta]) => {
    if (!meta) return;
    const existing = target.playerDirectory[playerId] || {};
    target.playerDirectory[playerId] = { ...existing, ...meta };
  });

  target.teamScouts ||= {};
  Object.entries(source.teamScouts || {}).forEach(([teamId, scout]) => {
    if (!scout) return;
    const existing = target.teamScouts[teamId] || {};
    target.teamScouts[teamId] = { ...existing, ...scout };
  });
  target.teamCoaches ||= {};
  Object.entries(source.teamCoaches || {}).forEach(([teamId, coach]) => {
    if (!coach) return;
    const existing = target.teamCoaches[teamId] || {};
    target.teamCoaches[teamId] = {
      ...existing,
      ...coach,
      identity: coach.identity ? { ...coach.identity } : existing.identity || null,
    };
  });
  target.teamGms ||= {};
  Object.entries(source.teamGms || {}).forEach(([teamId, gm]) => {
    if (!gm) return;
    const existing = target.teamGms[teamId] || {};
    target.teamGms[teamId] = { ...existing, ...gm };
  });
  const mergedMoods = { ...(target.teamMoods || {}) };
  Object.entries(source.teamMoods || {}).forEach(([teamId, mood]) => {
    mergedMoods[teamId] = mood ? { ...mood } : null;
  });
  target.teamMoods = mergedMoods;
  target.teamPayroll = { ...(target.teamPayroll || {}) };
  Object.entries(source.teamPayroll || {}).forEach(([teamId, value]) => {
    target.teamPayroll[teamId] = value ?? target.teamPayroll[teamId] ?? 0;
  });
  if (source.salaryCap != null) {
    target.salaryCap = source.salaryCap;
  }

  const sourceRosterVersion = Number.isFinite(source.teamRostersVersion)
    ? source.teamRostersVersion
    : null;
  const targetRosterVersion = Number.isFinite(target.teamRostersVersion)
    ? target.teamRostersVersion
    : null;

  const cloneRosterMap = (rosters = {}) => (
    Object.entries(rosters).reduce((acc, [teamId, roster]) => {
      acc[teamId] = cloneTeamRoster(roster);
      return acc;
    }, {})
  );

  if (source.teamRosters) {
    const shouldReplaceRosters = (
      !target.teamRosters
      || (sourceRosterVersion != null
        && (targetRosterVersion == null || sourceRosterVersion > targetRosterVersion))
    );

    if (shouldReplaceRosters) {
      target.teamRosters = cloneRosterMap(source.teamRosters);
    } else if (target.teamRosters) {
      const mergeRosterSide = (targetSide = {}, sourceSide = {}) => {
        Object.entries(sourceSide).forEach(([role, player]) => {
          if (!player) return;
          const existing = targetSide[role];
          if (!existing || existing.id !== player.id) {
            targetSide[role] = clonePlayerRecordForLeague(player);
          }
        });
        return targetSide;
      };

      Object.entries(source.teamRosters).forEach(([teamId, roster]) => {
        if (!target.teamRosters[teamId]) {
          target.teamRosters[teamId] = cloneTeamRoster(roster);
          return;
        }
        const entry = target.teamRosters[teamId];
        entry.offense = mergeRosterSide(entry.offense || {}, roster?.offense || {});
        entry.defense = mergeRosterSide(entry.defense || {}, roster?.defense || {});
        const special = entry.special || {};
        const sourceKicker = roster?.special?.K || null;
        if (sourceKicker && (!special.K || special.K.id !== sourceKicker.id)) {
          special.K = clonePlayerRecordForLeague(sourceKicker);
        }
        entry.special = special;
      });
    }

    if (sourceRosterVersion != null) {
      target.teamRostersVersion = targetRosterVersion == null
        ? sourceRosterVersion
        : Math.max(targetRosterVersion, sourceRosterVersion);
    }
  }

  if (!target.freeAgents && Array.isArray(source.freeAgents)) {
    target.freeAgents = source.freeAgents.map((player) => clonePlayerRecordForLeague(player));
  }

  target.staffFreeAgents ||= { coaches: [], scouts: [], gms: [] };
  ['coaches', 'scouts', 'gms'].forEach((key) => {
    const existing = Array.isArray(target.staffFreeAgents[key])
      ? target.staffFreeAgents[key]
      : [];
    const seen = new Set(existing.map((entry) => entry?.id).filter(Boolean));
    (source.staffFreeAgents?.[key] || []).forEach((entry, index) => {
      if (!entry) return;
      const id = entry.id || `${key}-import-${index}-${existing.length}`;
      if (seen.has(id)) return;
      const clone = { ...entry };
      if (clone.identity) clone.identity = { ...clone.identity };
      clone.id = id;
      existing.push(clone);
      seen.add(id);
    });
    target.staffFreeAgents[key] = existing;
  });

  const newsSeed = new Map((target.newsFeed || []).map((entry) => [entry.id || `${entry.type}-${entry.text}`, entry]));
  (source.newsFeed || []).forEach((entry) => {
    if (!entry) return;
    const key = entry.id || `${entry.type}-${entry.text}`;
    if (!newsSeed.has(key)) {
      newsSeed.set(key, { ...entry });
    }
  });
  target.newsFeed = Array.from(newsSeed.values()).sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  if (target.newsFeed.length > 200) {
    target.newsFeed.length = 200;
  }

  target.injuredReserve ||= {};
  Object.entries(source.injuredReserve || {}).forEach(([playerId, entry]) => {
    if (!target.injuredReserve[playerId]) {
      target.injuredReserve[playerId] = {
        ...entry,
        player: entry?.player ? clonePlayerRecordForLeague(entry.player) : null,
      };
    }
  });

  target.injuryLog ||= {};
  Object.entries(source.injuryLog || {}).forEach(([playerId, entry]) => {
    if (!target.injuryLog[playerId]) {
      target.injuryLog[playerId] = {
        ...entry,
        player: entry?.player ? clonePlayerRecordForLeague(entry.player) : null,
      };
    }
  });

  target.injuryCounts ||= {};
  Object.entries(source.injuryCounts || {}).forEach(([seasonNumber, counts]) => {
    if (!target.injuryCounts[seasonNumber]) {
      target.injuryCounts[seasonNumber] = { ...(counts || {}) };
    }
  });

  if (!target.seasonSnapshot && source.seasonSnapshot) {
    target.seasonSnapshot = cloneSeason(source.seasonSnapshot);
  }

  target.recordBook = cloneRecordBook(target.recordBook || {});
  if (source.recordBook) {
    const incoming = cloneRecordBook(source.recordBook);
    target.recordBook.categories ||= {};
    Object.entries(incoming.categories || {}).forEach(([key, entry]) => {
      const existing = target.recordBook.categories[key];
      if (!existing || (entry.value ?? 0) > (existing.value ?? 0)) {
        target.recordBook.categories[key] = entry;
      }
    });
    target.recordBook.lastUpdatedSeason = Math.max(
      target.recordBook.lastUpdatedSeason ?? 0,
      incoming.lastUpdatedSeason ?? 0,
    );
  }

  target.teamWiki = cloneTeamWikiMap(target.teamWiki || {});
  Object.entries(source.teamWiki || {}).forEach(([teamId, entry]) => {
    if (!entry) return;
    const cloned = cloneTeamWikiMap({ [teamId]: entry })[teamId];
    const existing = target.teamWiki[teamId];
    if (!existing) {
      target.teamWiki[teamId] = cloned;
      return;
    }

    const summaryMap = new Map();
    (existing.seasonSummaries || []).forEach((summary) => {
      summaryMap.set(summary.seasonNumber, { ...summary });
    });
    (cloned.seasonSummaries || []).forEach((summary) => {
      if (!summary) return;
      summaryMap.set(summary.seasonNumber, { ...summary });
    });
    existing.seasonSummaries = Array.from(summaryMap.values()).sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));

    const recordMap = new Map();
    (existing.recordsSet || []).forEach((record) => {
      recordMap.set(`${record.key}-${record.seasonNumber}`, { ...record });
    });
    (cloned.recordsSet || []).forEach((record) => {
      if (!record) return;
      const key = `${record.key}-${record.seasonNumber}`;
      const existingRecord = recordMap.get(key);
      if (!existingRecord || (record.value ?? 0) > (existingRecord.value ?? 0)) {
        recordMap.set(key, { ...record });
      }
    });
    existing.recordsSet = Array.from(recordMap.values()).sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0));

    const playerMap = new Map();
    (existing.notablePlayers || []).forEach((player) => {
      playerMap.set(player.playerId, {
        ...player,
        highlights: Array.isArray(player.highlights) ? player.highlights.slice() : [],
        seasons: Array.isArray(player.seasons) ? player.seasons.slice() : [],
      });
    });
    (cloned.notablePlayers || []).forEach((player) => {
      if (!player) return;
      const existingPlayer = playerMap.get(player.playerId);
      const highlights = Array.isArray(player.highlights) ? player.highlights : [];
      const seasons = Array.isArray(player.seasons) ? player.seasons : [];
      if (existingPlayer) {
        highlights.forEach((highlight) => {
          if (!existingPlayer.highlights.includes(highlight)) existingPlayer.highlights.push(highlight);
        });
        seasons.forEach((seasonNumber) => {
          if (!existingPlayer.seasons.includes(seasonNumber)) existingPlayer.seasons.push(seasonNumber);
        });
      } else {
        playerMap.set(player.playerId, {
          ...player,
          highlights: highlights.slice(),
          seasons: seasons.slice(),
        });
      }
    });
    existing.notablePlayers = Array.from(playerMap.values()).sort((a, b) => (b.seasons?.length || 0) - (a.seasons?.length || 0));

    if ((cloned.lastUpdatedSeason ?? 0) >= (existing.lastUpdatedSeason ?? 0)) {
      existing.sections = Array.isArray(cloned.sections)
        ? cloned.sections.map((section) => ({ ...section }))
        : existing.sections;
      existing.totals = { ...cloned.totals };
    }

    existing.lastUpdatedSeason = Math.max(existing.lastUpdatedSeason ?? 0, cloned.lastUpdatedSeason ?? 0);
    if (cloned.aiSections) {
      existing.aiSections = { ...(existing.aiSections || {}), ...cloned.aiSections };
    }
  });

  target.teamWikiLastUpdatedSeason = Math.max(
    target.teamWikiLastUpdatedSeason ?? 0,
    source.teamWikiLastUpdatedSeason ?? 0,
  );

  const aiLog = Array.isArray(target.teamWikiAiLog) ? target.teamWikiAiLog.slice() : [];
  (source.teamWikiAiLog || []).forEach((entry) => {
    if (!entry) return;
    aiLog.push({ ...entry });
  });
  target.teamWikiAiLog = aiLog;
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

export function combineSeasonSnapshots(rawSnapshots) {
  let snapshots = rawSnapshots
    .map((snapshot, index) => ({
      snapshot,
      season: snapshot?.season || null,
      index,
    }))
    .filter((entry) => entry.season);

  if (!snapshots.length) return null;

  const seasonNumbers = snapshots
    .map(({ season }) => season?.seasonNumber)
    .filter((value) => Number.isFinite(value));

  if (seasonNumbers.length) {
    const latestSeason = Math.max(...seasonNumbers);
    const sameSeason = snapshots.filter(({ season }) => season?.seasonNumber === latestSeason);
    if (sameSeason.length) {
      snapshots = sameSeason;
    }
  }

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

  const baseSchedule = Array.isArray(combinedSeason.schedule)
    ? combinedSeason.schedule.map((game) => cloneScheduleGame(game))
    : [];

  const scheduleMap = new Map();
  baseSchedule.forEach((game, idx) => {
    if (!game) return;
    scheduleMap.set(idx, game);
  });

  snapshots.forEach(({ season }) => {
    const schedule = Array.isArray(season.schedule) ? season.schedule : [];
    schedule.forEach((game, idx) => {
      if (!game) return;
      const candidate = cloneScheduleGame(game);
      const existing = scheduleMap.get(idx);
      if (!existing) {
        scheduleMap.set(idx, candidate);
        return;
      }

      const existingScore = scheduleEntryPriority(existing);
      const candidateScore = scheduleEntryPriority(candidate);
      if (candidateScore > existingScore) {
        scheduleMap.set(idx, candidate);
        return;
      }

      if (candidateScore === existingScore) {
        const merged = { ...existing };
        if (existing.meta) merged.meta = { ...existing.meta };
        if (existing.result) merged.result = cloneResult(existing.result);
        if (!merged.round && candidate.round) merged.round = candidate.round;
        if (candidate.week != null && (merged.week == null || !Number.isFinite(merged.week))) {
          merged.week = candidate.week;
        }
        if (!merged.tag && candidate.tag) merged.tag = candidate.tag;
        if (!merged.label && candidate.label) merged.label = candidate.label;
        if (candidate.meta) {
          merged.meta = { ...(merged.meta || {}), ...candidate.meta };
        }
        if (candidate.played) {
          merged.played = merged.played || candidate.played;
        }
        if (candidate.result) {
          merged.result = cloneResult(candidate.result);
        }
        scheduleMap.set(idx, merged);
      }
    });
  });

  const scheduleLengths = snapshots
    .map(({ season }) => season?.schedule?.length)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const highestIndex = scheduleMap.size ? Math.max(...scheduleMap.keys()) : -1;
  const targetLengthCandidates = [
    baseSchedule.length,
    highestIndex + 1,
    ...(scheduleLengths.length ? [Math.max(...scheduleLengths)] : []),
  ].filter((value) => Number.isFinite(value) && value >= 0);
  const targetLength = targetLengthCandidates.length
    ? Math.max(...targetLengthCandidates)
    : baseSchedule.length;

  const mergedSchedule = Array.from({ length: targetLength }).map((_, idx) => {
    const entry = scheduleMap.get(idx);
    return entry ? cloneScheduleGame(entry) : null;
  });
  combinedSeason.schedule = mergedSchedule;

  combinedSeason.results = (combinedSeason.results || []).slice().sort((a, b) => {
    const aIdx = a?.index ?? 0;
    const bIdx = b?.index ?? 0;
    return aIdx - bIdx;
  });
  combinedSeason.completedGames = combinedSeason.results.length;

  const regularLengthCandidates = snapshots
    .map(({ season }) => (Number.isFinite(season?.regularSeasonLength) ? season.regularSeasonLength : null))
    .filter((value) => Number.isFinite(value) && value > 0);
  const observedRegularGames = mergedSchedule.filter((game) => game && !String(game.tag || '').startsWith('playoff')).length;
  let regularLength = Number.isFinite(combinedSeason.regularSeasonLength)
    ? combinedSeason.regularSeasonLength
    : 0;
  regularLengthCandidates.forEach((value) => {
    if (value > regularLength) regularLength = value;
  });
  if (observedRegularGames > regularLength) {
    regularLength = observedRegularGames;
  }
  if (regularLength > 0) {
    combinedSeason.regularSeasonLength = regularLength;
  }

  const regularWeekCandidates = snapshots
    .map(({ season }) => season?.regularSeasonWeeks)
    .filter((value) => Number.isFinite(value) && value > 0);
  const observedRegularWeeks = combinedSeason.schedule
    .filter((game) => game && !String(game.tag || '').startsWith('playoff'))
    .map((game) => (Number.isFinite(game.week) ? game.week : null))
    .filter((week) => week != null);
  const observedWeekMax = observedRegularWeeks.length
    ? Math.max(...observedRegularWeeks)
    : 0;
  if (regularWeekCandidates.length) {
    combinedSeason.regularSeasonWeeks = Math.max(observedWeekMax, ...regularWeekCandidates);
  } else if (observedWeekMax > 0) {
    combinedSeason.regularSeasonWeeks = observedWeekMax;
  }

  const current = pickCurrentMatchup(snapshots.map(({ snapshot }) => snapshot));
  const lastCompleted = pickLastCompletedGame(snapshots.map(({ snapshot }) => snapshot));

  const nextIndexCandidates = snapshots
    .map(({ season }) => season?.currentGameIndex)
    .filter((value) => Number.isFinite(value));
  if (nextIndexCandidates.length) {
    combinedSeason.currentGameIndex = Math.min(...nextIndexCandidates);
  }

  const leagueEntries = snapshots
    .map(({ snapshot, index }) => ({
      league: snapshot?.league || null,
      index,
    }))
    .filter((entry) => entry.league);

  let combinedLeague = null;
  if (leagueEntries.length) {
    const [firstLeague, ...otherLeagues] = leagueEntries;
    combinedLeague = cloneLeague(firstLeague.league);
    otherLeagues.forEach(({ league }) => mergeLeagueData(combinedLeague, league));
  }

  return {
    label: 'Season Totals',
    season: combinedSeason,
    league: combinedLeague,
    currentMatchup: current.matchup,
    currentScores: current.scores,
    lastCompletedGame: lastCompleted,
  };
}

function computeSeasonProgress(season) {
  const seasonNumber = Number.isFinite(season?.seasonNumber) ? season.seasonNumber : null;
  const formatSeasonPrefix = () => {
    if (Number.isFinite(seasonNumber) && seasonNumber > 0) {
      return `Season ${seasonNumber}`;
    }
    return 'Season';
  };
  const buildWeekLabel = (week, totalWeeks) => {
    const prefix = formatSeasonPrefix();
    return `${prefix} Week ${week} of ${totalWeeks}`;
  };

  if (!season) {
    return {
      label: buildWeekLabel(1, 16),
      currentWeek: 1,
      totalWeeks: 16,
      phase: 'regular',
      completedWeeks: 0,
    };
  }

  const schedule = Array.isArray(season.schedule) ? season.schedule : [];
  const regularGames = schedule.filter((game) => {
    const tag = String(game?.tag || '');
    return !tag.startsWith('playoff');
  });

  const weekSet = new Set();
  let gamesInWeekOne = 0;
  regularGames.forEach((game) => {
    if (!game) return;
    const week = Number.isFinite(game.week) ? game.week : null;
    if (week != null) {
      weekSet.add(week);
      if (week === 1) gamesInWeekOne += 1;
    }
  });

  const inferredWeeks = weekSet.size;
  const defaultWeeks = season.regularSeasonWeeks
    ? season.regularSeasonWeeks
    : season.regularSeasonLength
      ? Math.max(1, Math.round((season.regularSeasonLength || 0) / Math.max(1, gamesInWeekOne || 4)))
      : 16;
  const rawTotalWeeks = inferredWeeks || defaultWeeks || 16;
  const totalWeeks = Math.max(1, rawTotalWeeks);
  const gamesPerWeek = Math.max(
    1,
    gamesInWeekOne || Math.round((regularGames.length || totalWeeks) / Math.max(1, totalWeeks)) || 4,
  );

  const playedRegular = regularGames.filter((game) => {
    if (!game) return false;
    if (game.played) return true;
    const result = game.result || null;
    return result && Object.keys(result).length > 0;
  }).length;

  const phase = season.phase || 'regular';
  const bracketStage = season.playoffBracket?.stage || null;

  if (phase === 'complete' || bracketStage === 'complete') {
    return {
      label: `${formatSeasonPrefix()} Complete`,
      currentWeek: totalWeeks,
      totalWeeks,
      phase: 'complete',
      completedWeeks: totalWeeks,
    };
  }
  if (phase === 'championship' || bracketStage === 'championship') {
    return {
      label: `${formatSeasonPrefix()} Playoffs • Championship`,
      currentWeek: totalWeeks,
      totalWeeks,
      phase: 'championship',
      completedWeeks: totalWeeks,
    };
  }
  if (phase === 'playoffs' || phase === 'semifinals' || bracketStage === 'semifinals') {
    return {
      label: `${formatSeasonPrefix()} Playoffs • Semifinals`,
      currentWeek: totalWeeks,
      totalWeeks,
      phase: 'playoffs',
      completedWeeks: Math.max(0, totalWeeks - 1),
    };
  }

  if (!regularGames.length) {
    return {
      label: buildWeekLabel(1, 16),
      currentWeek: 1,
      totalWeeks: 16,
      phase: 'regular',
      completedWeeks: 0,
    };
  }

  if (playedRegular >= regularGames.length) {
    return {
      label: `${formatSeasonPrefix()} Regular Season Complete`,
      currentWeek: totalWeeks,
      totalWeeks,
      phase: 'regular',
      completedWeeks: totalWeeks,
    };
  }

  const completedWeeks = Math.floor(playedRegular / gamesPerWeek);
  const boundedCompletedWeeks = Math.max(0, Math.min(totalWeeks, completedWeeks));
  let currentWeek = Math.min(totalWeeks, boundedCompletedWeeks + 1);
  if (currentWeek <= 0) currentWeek = 1;

  return {
    label: buildWeekLabel(currentWeek, totalWeeks),
    currentWeek,
    totalWeeks,
    phase: 'regular',
    completedWeeks: boundedCompletedWeeks,
  };
}

export default function App() {
  const [completionFlags, setCompletionFlags] = useState(() => Array(GAME_COUNT).fill(false));
  const autoResumeRef = useRef(Array(GAME_COUNT).fill(false));
  const [resetSignal, setResetSignal] = useState({ token: 0, autoResume: Array(GAME_COUNT).fill(false) });
  const [globalRunning, setGlobalRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [finalSecondsMode, setFinalSecondsMode] = useState(false);
  const [seasonStatsOpen, setSeasonStatsOpen] = useState(false);
  const [teamDirectoryOpen, setTeamDirectoryOpen] = useState(false);
  const [leaderboardsOpen, setLeaderboardsOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [pressOpen, setPressOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [freeAgentsOpen, setFreeAgentsOpen] = useState(false);
  const [recordBookOpen, setRecordBookOpen] = useState(false);
  const [leagueWikiOpen, setLeagueWikiOpen] = useState(false);
  const [lastSeenNewsTimestamp, setLastSeenNewsTimestamp] = useState(0);
  const [lastSeenPressWeekKey, setLastSeenPressWeekKey] = useState('');
  const [seasonSnapshots, setSeasonSnapshots] = useState(() => []);
  const [wikiOverrides, setWikiOverrides] = useState({ seasonNumber: 0, teams: {} });
  const [now, setNow] = useState(() => Date.now());
  const [longSeasonEnabled, setLongSeasonEnabled] = useState(false);
  const gameRefs = useRef([]);
  const lastKnownSeasonNumberRef = useRef(1);
  const pendingAutoResetRef = useRef(null);
  const seasonConfig = useMemo(() => ({ longSeason: longSeasonEnabled }), [longSeasonEnabled]);

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

  const handleToggleRunning = useCallback(() => {
    if (pendingAutoResetRef.current) {
      clearTimeout(pendingAutoResetRef.current);
      pendingAutoResetRef.current = null;
    }
    setGlobalRunning(prev => !prev);
  }, []);

  const handleSimSpeedChange = useCallback((value) => {
    setSimSpeed(value);
  }, []);

  const handleToggleFinalSecondsMode = useCallback(() => {
    setFinalSecondsMode((prev) => !prev);
  }, []);

  const handleToggleSeasonLength = useCallback(() => {
    setGlobalRunning(false);
    autoResumeRef.current = Array(GAME_COUNT).fill(false);
    setCompletionFlags(Array(GAME_COUNT).fill(false));
    setLongSeasonEnabled((prev) => !prev);
    setResetSignal((prev) => ({
      token: prev.token + 1,
      autoResume: Array(GAME_COUNT).fill(false),
    }));
  }, []);

  const collectSeasonSnapshots = useCallback(() => {
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
    setSeasonSnapshots(snapshots);
    return snapshots;
  }, []);

  const handleAdvanceOffseasonDay = useCallback(() => {
    let advanced = false;
    gameRefs.current.forEach((instance) => {
      if (instance && typeof instance.advanceOffseasonDay === 'function') {
        instance.advanceOffseasonDay();
        advanced = true;
      }
    });
    if (!advanced) return;
    const nowTs = Date.now();
    setNow(nowTs);
    setTimeout(() => {
      collectSeasonSnapshots();
    }, 0);
  }, [collectSeasonSnapshots]);

  const handleApplyWikiOverrides = useCallback((update) => {
    if (!update || typeof update !== 'object') return;
    setWikiOverrides((prev) => {
      const nextSeason = update.seasonNumber ?? prev.seasonNumber ?? 0;
      if (nextSeason < (prev.seasonNumber ?? 0)) return prev;
      const teams = update.teams && typeof update.teams === 'object' ? update.teams : {};
      return { seasonNumber: nextSeason, teams };
    });
  }, []);

  useEffect(() => {
    collectSeasonSnapshots();
  }, [collectSeasonSnapshots]);

  useEffect(() => {
    const id = setInterval(() => {
      collectSeasonSnapshots();
    }, 1000);
    return () => clearInterval(id);
  }, [collectSeasonSnapshots]);

  useEffect(() => {
    if (!completionFlags.some(Boolean)) return;
    collectSeasonSnapshots();
  }, [completionFlags, collectSeasonSnapshots]);

  useEffect(() => {
    if (!resetSignal?.token && resetSignal?.token !== 0) return;
    collectSeasonSnapshots();
  }, [resetSignal?.token, collectSeasonSnapshots]);

  const handleOpenSeasonStats = useCallback(() => {
    collectSeasonSnapshots();
    setSeasonStatsOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenSchedule = useCallback(() => {
    collectSeasonSnapshots();
    setScheduleOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenTeamDirectory = useCallback(() => {
    collectSeasonSnapshots();
    setTeamDirectoryOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenFreeAgents = useCallback(() => {
    collectSeasonSnapshots();
    setFreeAgentsOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenLeaderboards = useCallback(() => {
    collectSeasonSnapshots();
    setLeaderboardsOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenNews = useCallback(() => {
    collectSeasonSnapshots();
    setNewsOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenPress = useCallback(() => {
    collectSeasonSnapshots();
    setPressOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenRecordBook = useCallback(() => {
    collectSeasonSnapshots();
    setRecordBookOpen(true);
  }, [collectSeasonSnapshots]);

  const handleOpenLeagueWiki = useCallback(() => {
    collectSeasonSnapshots();
    setLeagueWikiOpen(true);
  }, [collectSeasonSnapshots]);

  const aggregatedSeasonStats = useMemo(
    () => combineSeasonSnapshots(seasonSnapshots),
    [seasonSnapshots],
  );

  const aggregatedSeasonNumber = aggregatedSeasonStats?.season?.seasonNumber
    ?? aggregatedSeasonStats?.league?.seasonNumber
    ?? null;

  useEffect(() => {
    if (!globalRunning) return undefined;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [globalRunning]);

  useWikiAiUpdater({
    league: aggregatedSeasonStats?.league || null,
    onOverride: handleApplyWikiOverrides,
  });

  useEffect(() => {
    if (!Number.isFinite(aggregatedSeasonNumber)) return;
    const previousSeason = Number.isFinite(lastKnownSeasonNumberRef.current)
      ? lastKnownSeasonNumberRef.current
      : aggregatedSeasonNumber;
    if (aggregatedSeasonNumber > previousSeason) {
      autoResumeRef.current = Array(GAME_COUNT).fill(false);
      setCompletionFlags(Array(GAME_COUNT).fill(false));
      setResetSignal((prev) => ({
        token: prev.token + 1,
        autoResume: Array(GAME_COUNT).fill(false),
      }));
      prevActiveSlotCountRef.current = GAME_COUNT;
    }
    lastKnownSeasonNumberRef.current = aggregatedSeasonNumber;
  }, [aggregatedSeasonNumber]);

  const seasonProgress = useMemo(
    () => computeSeasonProgress(aggregatedSeasonStats?.season || null),
    [aggregatedSeasonStats],
  );

  const fallbackSeasonNumber = Number.isFinite(aggregatedSeasonNumber)
    ? aggregatedSeasonNumber
    : (Number.isFinite(lastKnownSeasonNumberRef.current) ? lastKnownSeasonNumberRef.current : 1);
  const safeFallbackSeason = Number.isFinite(fallbackSeasonNumber) && fallbackSeasonNumber > 0
    ? fallbackSeasonNumber
    : 1;
  const fallbackWeeks = longSeasonEnabled ? 14 : 7;

  const seasonProgressLabel = aggregatedSeasonStats?.season
    ? seasonProgress.label
    : `Season ${safeFallbackSeason} Week 1 of ${fallbackWeeks}`;

  const offseasonState = aggregatedSeasonStats?.league?.offseason || null;

  const offseasonInfo = useMemo(() => {
    if (!offseasonState) return null;
    const totalDays = Number.isFinite(offseasonState.totalDays) ? offseasonState.totalDays : 0;
    const currentDay = Number.isFinite(offseasonState.currentDay) ? offseasonState.currentDay : 0;
    const daysRemaining = Math.max(0, totalDays - currentDay);
    const ready = !!offseasonState.nextSeasonReady && !offseasonState.nextSeasonStarted;
    const active = !!offseasonState.active && !ready;
    const paused = active && !globalRunning;
    if (!active && !ready) return null;
    let msUntilNextDay = null;
    if (active && globalRunning) {
      const target = offseasonState.nextDayAt
        || ((
          offseasonState.lastAdvancedAt || Date.now()
        ) + (offseasonState.dayDurationMs || DEFAULT_OFFSEASON_DAY_DURATION_MS));
      msUntilNextDay = Math.max(0, target - now);
    }
    return {
      active,
      ready,
      paused,
      totalDays,
      currentDay,
      daysRemaining,
      msUntilNextDay,
    };
  }, [offseasonState, globalRunning, now]);

  const pressCoverageWeek = useMemo(() => {
    if (!seasonProgress) return null;
    const completedWeeks = seasonProgress.completedWeeks || 0;
    if (seasonProgress.phase && seasonProgress.phase !== 'regular') {
      return completedWeeks || seasonProgress.currentWeek || null;
    }
    if (completedWeeks <= 0) return null;
    return completedWeeks;
  }, [seasonProgress]);

  const postseasonSingleField = useMemo(() => {
    const phase = seasonProgress?.phase;
    if (!phase) return false;
    if (phase === 'playoffs' || phase === 'semifinals' || phase === 'championship') {
      return true;
    }

    if (phase === 'complete') {
      const offseasonActive = Boolean(offseasonState?.active);
      const offseasonWaiting = Boolean(offseasonState?.nextSeasonReady && !offseasonState?.nextSeasonStarted);
      if ((offseasonActive || offseasonWaiting) && !offseasonState?.nextSeasonStarted) {
        return true;
      }
    }

    return false;
  }, [
    seasonProgress?.phase,
    offseasonState?.active,
    offseasonState?.nextSeasonReady,
    offseasonState?.nextSeasonStarted,
  ]);

  const activeSlotCount = postseasonSingleField ? 1 : GAME_COUNT;
  const prevActiveSlotCountRef = useRef(activeSlotCount);

  useEffect(() => {
    const prev = prevActiveSlotCountRef.current;
    if (activeSlotCount === prev) return;

    for (let idx = activeSlotCount; idx < GAME_COUNT; idx += 1) {
      autoResumeRef.current[idx] = false;
    }

    setCompletionFlags((prevFlags) => {
      const next = prevFlags.slice();
      let changed = false;

      for (let idx = 0; idx < GAME_COUNT; idx += 1) {
        if (idx >= activeSlotCount) {
          if (!next[idx]) {
            next[idx] = true;
            changed = true;
          }
        } else if (idx >= prev) {
          if (next[idx]) {
            next[idx] = false;
            changed = true;
          }
        }
      }

      return changed ? next : prevFlags;
    });

    prevActiveSlotCountRef.current = activeSlotCount;
  }, [activeSlotCount]);

  const offseasonBlockingResets = Boolean(
    offseasonState?.active && !offseasonState?.nextSeasonReady,
  );

  useEffect(() => {
    if (offseasonBlockingResets) {
      if (pendingAutoResetRef.current) {
        clearTimeout(pendingAutoResetRef.current);
        pendingAutoResetRef.current = null;
      }
      return undefined;
    }

    const required = Array.from({ length: GAME_COUNT }, (_, idx) => idx < activeSlotCount);
    const anyRequiredComplete = required.some((needed, idx) => needed && completionFlags[idx]);
    if (!anyRequiredComplete) return undefined;
    const missingRequired = required.some((needed, idx) => needed && !completionFlags[idx]);
    if (missingRequired) return undefined;

    const autoResume = autoResumeRef.current.map((value, idx) => (idx < activeSlotCount ? value : false));
    autoResumeRef.current = Array(GAME_COUNT).fill(false);

    const timeout = setTimeout(() => {
      if (pendingAutoResetRef.current !== timeout) return;
      pendingAutoResetRef.current = null;
      const shouldResume = autoResume.slice(0, activeSlotCount).some(Boolean);
      setGlobalRunning(shouldResume);
      setResetSignal(prev => ({
        token: prev.token + 1,
        autoResume,
      }));
      setCompletionFlags(prevFlags => prevFlags.map((flag, idx) => (idx < activeSlotCount ? false : true)));
    }, RESET_DELAY_MS);

    pendingAutoResetRef.current = timeout;

    return () => {
      if (pendingAutoResetRef.current === timeout) {
        pendingAutoResetRef.current = null;
      }
      clearTimeout(timeout);
    };
  }, [
    completionFlags,
    activeSlotCount,
    offseasonBlockingResets,
  ]);

  const pressWeekKey = useMemo(() => {
    const seasonNumber = aggregatedSeasonStats?.season?.seasonNumber
      || aggregatedSeasonStats?.league?.seasonNumber
      || null;
    const coverageWeek = pressCoverageWeek || null;
    if (!seasonNumber || !coverageWeek) return null;
    return `S${seasonNumber}-W${coverageWeek}`;
  }, [
    aggregatedSeasonStats?.season?.seasonNumber,
    aggregatedSeasonStats?.league?.seasonNumber,
    pressCoverageWeek,
  ]);

  const leagueNewsFeed = aggregatedSeasonStats?.league?.newsFeed;

  const leagueNewsMeta = useMemo(() => {
    const feed = leagueNewsFeed;
    if (!Array.isArray(feed) || feed.length === 0) return { latest: 0, count: 0 };
    let latest = 0;
    feed.forEach((entry) => {
      const value = entry?.createdAt ? new Date(entry.createdAt).getTime() : 0;
      if (!Number.isNaN(value)) {
        latest = Math.max(latest, value);
      }
    });
    return { latest, count: feed.length };
  }, [leagueNewsFeed]);

  const newsTickerItems = useMemo(() => {
    if (!Array.isArray(leagueNewsFeed) || leagueNewsFeed.length === 0) return [];
    return leagueNewsFeed
      .filter((entry) => entry && entry.text && entry.type !== 'press')
      .slice(0, 5)
      .map((entry, index) => {
        const timestampSource = entry.createdAt || entry.generatedAt || entry.timestamp || null;
        const { label: timestampLabel, iso: timestampISO } = formatTickerTimestamp(timestampSource);
        return {
          id: entry.id || `ticker-${index}`,
          text: entry.text,
          timestampLabel,
          timestampISO,
        };
      });
  }, [leagueNewsFeed]);

  useEffect(() => {
    if (!leagueNewsMeta.count) {
      setLastSeenNewsTimestamp(0);
    }
  }, [leagueNewsMeta.count]);

  useEffect(() => {
    if (!newsOpen) return;
    if (!leagueNewsMeta.count) {
      setLastSeenNewsTimestamp(0);
      return;
    }
    const latest = leagueNewsMeta.latest || Date.now();
    setLastSeenNewsTimestamp(latest);
  }, [newsOpen, leagueNewsMeta]);

  useEffect(() => {
    if (!pressOpen) return;
    if (!pressWeekKey) return;
    setLastSeenPressWeekKey(pressWeekKey);
  }, [pressOpen, pressWeekKey]);

  useEffect(() => {
    if (pressWeekKey) return;
    setLastSeenPressWeekKey('');
  }, [pressWeekKey]);

  const hasUnseenNews = leagueNewsMeta.count > 0 && leagueNewsMeta.latest > (lastSeenNewsTimestamp || 0);

  const pressCoverageAvailable = useMemo(() => {
    if (!seasonProgress) return false;
    if (seasonProgress.phase && seasonProgress.phase !== 'regular') return true;
    return (pressCoverageWeek || 0) >= 1;
  }, [seasonProgress, pressCoverageWeek]);

  const hasUnseenPressArticles = Boolean(
    pressCoverageAvailable
    && pressWeekKey
    && pressWeekKey !== (lastSeenPressWeekKey || ''),
  );

  const modalTitle = aggregatedSeasonStats?.label
    ? `Season Overview • ${aggregatedSeasonStats.label}`
    : 'Season Overview';

  return (
    <PlayerCardProvider season={aggregatedSeasonStats?.season || null} league={aggregatedSeasonStats?.league || null}>
      <div className="app-root">
        <GlobalControls
          running={globalRunning}
          onToggleRunning={handleToggleRunning}
          simSpeed={simSpeed}
          onSimSpeedChange={handleSimSpeedChange}
          onToggleSeasonLength={handleToggleSeasonLength}
          longSeasonEnabled={longSeasonEnabled}
          onShowTeamDirectory={handleOpenTeamDirectory}
          onShowSeasonStats={handleOpenSeasonStats}
          onShowSchedule={handleOpenSchedule}
          onShowLeaderboards={handleOpenLeaderboards}
          onShowNews={handleOpenNews}
          newsTickerItems={newsTickerItems}
          onShowPressArticles={handleOpenPress}
          onShowFreeAgents={handleOpenFreeAgents}
          onShowRecordBook={handleOpenRecordBook}
          onShowLeagueWiki={handleOpenLeagueWiki}
          onAdvanceOffseasonDay={handleAdvanceOffseasonDay}
          seasonProgressLabel={seasonProgressLabel}
          hasUnseenNews={hasUnseenNews}
          hasUnseenPressArticles={hasUnseenPressArticles}
          offseasonInfo={offseasonInfo}
          startAtFinalSeconds={finalSecondsMode}
          onToggleFinalSecondsMode={handleToggleFinalSecondsMode}
        />
      <div className={`games-stack${postseasonSingleField ? ' games-stack--single' : ''}`}>
        {Array.from({ length: GAME_COUNT }).map((_, index) => {
          const active = index < activeSlotCount;
          const assignmentOffset = active ? index : Math.min(activeSlotCount - 1, index);
          return (
            <GameView
              key={index}
              ref={(instance) => { gameRefs.current[index] = instance; }}
              gameIndex={index}
              label={`Game ${index + 1}`}
              resetSignal={resetSignal}
              onGameComplete={handleGameComplete}
              onManualReset={handleGameReset}
              globalRunning={active ? globalRunning : false}
              simSpeed={simSpeed}
              parallelSlotCount={activeSlotCount}
              assignmentOffset={assignmentOffset >= 0 ? assignmentOffset : 0}
              seasonConfig={seasonConfig}
              startAtFinalSeconds={finalSecondsMode}
              hidden={!active}
            />
          );
        })}
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
            league={aggregatedSeasonStats.league || null}
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
      <TeamDirectoryModal
        open={teamDirectoryOpen}
        onClose={() => setTeamDirectoryOpen(false)}
        season={aggregatedSeasonStats?.season || null}
        league={aggregatedSeasonStats?.league || null}
      />
      <SeasonScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        season={aggregatedSeasonStats?.season || null}
      />
      <LeaderboardsModal
        open={leaderboardsOpen}
        onClose={() => setLeaderboardsOpen(false)}
        season={aggregatedSeasonStats?.season || null}
        league={aggregatedSeasonStats?.league || null}
      />
      <RecordBookModal
        open={recordBookOpen}
        onClose={() => setRecordBookOpen(false)}
        recordBook={aggregatedSeasonStats?.league?.recordBook || null}
        league={aggregatedSeasonStats?.league || null}
      />
      <FreeAgentModal
        open={freeAgentsOpen}
        onClose={() => setFreeAgentsOpen(false)}
        league={aggregatedSeasonStats?.league || null}
      />
      <NewsModal
        open={newsOpen}
        onClose={() => setNewsOpen(false)}
        league={aggregatedSeasonStats?.league || null}
        season={aggregatedSeasonStats?.season || null}
      />
      <PressArticlesModal
        open={pressOpen}
        onClose={() => setPressOpen(false)}
        league={aggregatedSeasonStats?.league || null}
        season={aggregatedSeasonStats?.season || null}
        seasonProgress={seasonProgress}
        pressCoverageWeek={pressCoverageWeek}
      />
      <LeagueWikiModal
        open={leagueWikiOpen}
        onClose={() => setLeagueWikiOpen(false)}
        teamWiki={aggregatedSeasonStats?.league?.teamWiki || null}
        recordBook={aggregatedSeasonStats?.league?.recordBook || null}
        aiOverrides={wikiOverrides}
      />
      </div>
    </PlayerCardProvider>
  );
}
