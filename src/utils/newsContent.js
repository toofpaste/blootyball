import { callChatCompletion, extractJsonPayload } from './openaiClient';
import { getTeamIdentity } from '../engine/data/teamLibrary';

function resolveTeamIdentity(teamId) {
  if (!teamId) return { id: null, name: null, abbr: null };
  const identity = getTeamIdentity(teamId);
  if (!identity) {
    return { id: teamId, name: teamId, abbr: teamId };
  }
  return {
    id: identity.id || teamId,
    name: identity.displayName || identity.name || teamId,
    abbr: identity.abbr || (identity.displayName || identity.name || teamId).slice(0, 3).toUpperCase(),
  };
}

function getTeamSnapshot(season, league, teamId) {
  if (!teamId || !season) return null;
  const totals = season.assignmentTotals?.[teamId] || season.teams?.[teamId] || null;
  const identity = resolveTeamIdentity(teamId);
  const record = totals?.record || {};
  const staff = {
    coach: league?.teamCoaches?.[teamId]?.identity?.displayName
      || league?.teamCoaches?.[teamId]?.identity?.name
      || league?.teamCoaches?.[teamId]?.name
      || null,
    gm: league?.teamGms?.[teamId]?.name || league?.teamGms?.[teamId]?.identity?.name || null,
    scout: league?.teamScouts?.[teamId]?.name || null,
  };
  return {
    id: teamId,
    name: identity.name,
    abbr: identity.abbr,
    record: {
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
    },
    pointsFor: totals?.pointsFor ?? 0,
    pointsAgainst: totals?.pointsAgainst ?? 0,
    stats: {
      passingYards: totals?.stats?.passingYards ?? 0,
      rushingYards: totals?.stats?.rushingYards ?? 0,
      receivingYards: totals?.stats?.receivingYards ?? 0,
      sacks: totals?.stats?.sacks ?? 0,
      interceptions: totals?.stats?.interceptions ?? 0,
    },
    staff,
  };
}

function buildNewsPromptContext({ league, season, entry }) {
  const team = getTeamSnapshot(season, league, entry.teamId) || null;
  const partnerTeam = entry.partnerTeam ? getTeamSnapshot(season, league, entry.partnerTeam) : null;
  const recentHeadlines = Array.isArray(league?.newsFeed)
    ? league.newsFeed
      .filter((item) => item && item.id !== entry.id)
      .slice(0, 5)
      .map((item) => ({ type: item.type, text: item.text, detail: item.detail || null }))
    : [];

  return {
    type: entry.type,
    baseHeadline: entry.text,
    baseDetail: entry.detail || null,
    context: entry.context || null,
    team,
    partnerTeam,
    seasonNumber: entry.seasonNumber || season?.seasonNumber || league?.seasonNumber || 1,
    createdAt: entry.createdAt || null,
    recentHeadlines,
  };
}

function fallbackPlayerArticle(context) {
  const { baseHeadline, baseDetail, team, seasonNumber } = context;
  const sentences = [];
  if (baseHeadline) sentences.push(baseHeadline.replace(/\s+/g, ' ').trim());
  if (team) {
    sentences.push(`${team.name} currently sit at ${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ''} on the season.`);
    sentences.push(`Their point differential is ${(team.pointsFor - team.pointsAgainst).toFixed(0)} with ${team.pointsFor.toFixed(0)} points scored.`);
  } else {
    sentences.push('The team is looking to build momentum as the season continues.');
  }
  if (baseDetail) {
    sentences.push(baseDetail.replace(/\s+/g, ' ').trim());
  }
  sentences.push('Coaches and teammates are keeping a close eye on how this storyline unfolds in the coming weeks.');
  sentences.push('Fans are buzzing about what this means for the locker room vibe and the next matchup.');
  sentences.push('Stay tuned as we track the twists and turns of this development.');
  sentences.push(`Season ${seasonNumber} still has time for plenty more plot twists.`);

  while (sentences.length < 8) {
    sentences.push('Everyone around the league is eager to see how this energy carries into the next game.');
  }

  const article = sentences.join(' ');
  const preview = `${sentences[0]} ${sentences[1] || ''}`.trim();
  return {
    headline: baseHeadline || 'League Update',
    preview,
    article,
    tone: 'balanced',
  };
}

async function generatePlayerNewsContent({ league, season, entry }) {
  const context = buildNewsPromptContext({ league, season, entry });
  const fallback = fallbackPlayerArticle(context);

  const userPrompt = `You are writing a quirky yet heartfelt sports news blurb for a fictional football universe. `
    + `Use the provided JSON context to craft a new headline and an 8-10 sentence article that elaborates on the situation. `
    + `Keep the tone funny, weird, wholesome, or realistic based on the vibe of the base headline. `
    + `Mention specific team names, records, or notable details where possible. `
    + `Return JSON with fields headline, preview, article, and tone. The preview should be 1-2 sentences teaser.`;

  const response = await callChatCompletion({
    messages: [
      { role: 'system', content: 'You are a creative beat reporter who covers a whimsical professional football league.' },
      { role: 'user', content: `${userPrompt}\n\nContext:\n${JSON.stringify(context, null, 2)}` },
    ],
    temperature: 0.95,
    maxTokens: 750,
    responseFormat: 'json_object',
  });

  if (!response) {
    return fallback;
  }

  const parsed = extractJsonPayload(response);
  if (!parsed || !parsed.article) {
    return fallback;
  }

  return {
    headline: parsed.headline || fallback.headline,
    preview: parsed.preview || fallback.preview,
    article: parsed.article || fallback.article,
    tone: parsed.tone || 'dynamic',
  };
}

function computeGamesPerWeek(season, seasonProgress) {
  const totalWeeks = seasonProgress?.totalWeeks || season?.regularSeasonLength || 16;
  const scheduleLength = Array.isArray(season?.schedule) ? season.schedule.length : (season?.results?.length || totalWeeks);
  if (!totalWeeks) return 1;
  return Math.max(1, Math.round(scheduleLength / totalWeeks));
}

function buildRecentResults(season, seasonProgress, limit = 8) {
  const results = Array.isArray(season?.results) ? season.results.slice() : [];
  results.sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
  const perWeek = computeGamesPerWeek(season, seasonProgress);
  return results.slice(0, limit).map((game) => {
    const home = resolveTeamIdentity(game.homeTeamId);
    const away = resolveTeamIdentity(game.awayTeamId);
    const homeScore = game.score?.[game.homeTeamId] ?? 0;
    const awayScore = game.score?.[game.awayTeamId] ?? 0;
    const winnerId = homeScore === awayScore ? null : (homeScore > awayScore ? game.homeTeamId : game.awayTeamId);
    const weekIndex = Math.floor((game.index ?? 0) / perWeek) + 1;
    return {
      id: game.gameId || `game-${game.index}`,
      label: `Week ${weekIndex}`,
      summary: `${home.name} ${homeScore} - ${awayScore} ${away.name}`,
      winner: winnerId ? resolveTeamIdentity(winnerId).name : 'Tie',
    };
  });
}

function computeTeamStreaks(season) {
  const results = Array.isArray(season?.results) ? season.results.slice() : [];
  results.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const ledger = new Map();
  results.forEach((game) => {
    const home = game.homeTeamId;
    const away = game.awayTeamId;
    const homeScore = game.score?.[home] ?? 0;
    const awayScore = game.score?.[away] ?? 0;
    const winner = homeScore === awayScore ? null : (homeScore > awayScore ? home : away);
    const entries = [
      { team: home, opponent: away, score: `${homeScore}-${awayScore}`, result: winner === home ? 'W' : (winner === null ? 'T' : 'L') },
      { team: away, opponent: home, score: `${awayScore}-${homeScore}`, result: winner === away ? 'W' : (winner === null ? 'T' : 'L') },
    ];
    entries.forEach(({ team, opponent, score, result }) => {
      if (!team) return;
      if (!ledger.has(team)) ledger.set(team, []);
      ledger.get(team).push({ opponent, score, result });
    });
  });

  const streaks = {};
  ledger.forEach((games, teamId) => {
    let count = 0;
    let symbol = null;
    for (let i = games.length - 1; i >= 0; i -= 1) {
      const entry = games[i];
      if (!symbol) {
        symbol = entry.result;
      }
      if (entry.result === symbol) {
        count += 1;
      } else {
        break;
      }
    }
    if (count <= 1 && (symbol === 'T' || symbol === 'L')) {
      // ignore tiny skids
      streaks[teamId] = `${symbol}${count}`;
    } else {
      streaks[teamId] = `${symbol || 'N'}${count}`;
    }
  });
  return streaks;
}

function buildStandings(season, league) {
  const teams = Object.keys(season?.assignmentTotals || season?.teams || {});
  return teams.map((teamId) => {
    const snapshot = getTeamSnapshot(season, league, teamId) || { id: teamId, name: teamId, record: { wins: 0, losses: 0, ties: 0 } };
    const diff = snapshot.pointsFor - snapshot.pointsAgainst;
    return {
      ...snapshot,
      pointDifferential: diff,
      winPct: (snapshot.record.wins + snapshot.record.ties * 0.5)
        / Math.max(1, snapshot.record.wins + snapshot.record.losses + snapshot.record.ties),
    };
  }).sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (b.pointDifferential !== a.pointDifferential) return b.pointDifferential - a.pointDifferential;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function collectNotableNews(league, limit = 6) {
  if (!Array.isArray(league?.newsFeed)) return [];
  return league.newsFeed
    .filter((entry) => entry && entry.text)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      text: entry.text,
      detail: entry.detail || null,
      teamId: entry.teamId || null,
    }));
}

function fallbackPressArticle(context) {
  const { angleLabel, standings, recentResults, currentWeek, seasonNumber } = context;
  const sentences = [];
  sentences.push(`${angleLabel} for Week ${currentWeek} of Season ${seasonNumber}.`);
  if (standings.length) {
    const leaders = standings.slice(0, 3).map((team) => `${team.name} (${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ''})`).join(', ');
    sentences.push(`Top of the standings: ${leaders}.`);
  }
  if (recentResults.length) {
    sentences.push(`Recent scores include ${recentResults.slice(0, 3).map((game) => game.summary).join('; ')}.`);
  }
  sentences.push('The playoff picture is tightening as teams jostle for position.');
  sentences.push('Coaches are searching for advantages while scouts shuffle their reports.');
  sentences.push('General managers continue to weigh potential moves before the deadline.');
  sentences.push('Fans are keeping tabs on breakout players and highlight-reel plays every week.');
  sentences.push('Expect more fireworks in the coming slate of games.');
  sentences.push('Momentum swings are defining the season, and the next chapter is ready to be written.');
  const article = sentences.join(' ');
  const preview = `${sentences[0]} ${sentences[1] || ''}`.trim();
  return {
    headline: angleLabel,
    preview,
    article,
    source: 'fallback',
  };
}

async function generatePressArticle({ league, season, seasonProgress, angle }) {
  if (!league || !season) return null;
  const standings = buildStandings(season, league);
  const recentResults = buildRecentResults(season, seasonProgress, 8);
  const streaks = computeTeamStreaks(season);
  const notableNews = collectNotableNews(league, 8);
  const context = {
    angle,
    angleLabel: angle.label,
    seasonNumber: season?.seasonNumber || league?.seasonNumber || 1,
    currentWeek: seasonProgress?.currentWeek || 1,
    totalWeeks: seasonProgress?.totalWeeks || null,
    standings,
    streaks,
    recentResults,
    notableNews,
  };

  const fallback = fallbackPressArticle(context);

  const userPrompt = `Generate an 8-10 sentence sports column for a weekly press article. `
    + `Use the JSON context to reference team records, streaks, and recent headlines. `
    + `The writing should feel like insider coverage, touching on coaches, executives, roster moves, and what is at stake. `
    + `Provide JSON with headline, preview, and article. Preview should be 1-2 sentences summarizing the hook.`;

  const response = await callChatCompletion({
    messages: [
      { role: 'system', content: 'You are a veteran sports journalist covering a dramatic football league.' },
      { role: 'user', content: `${userPrompt}\n\nContext:\n${JSON.stringify(context, null, 2)}` },
    ],
    temperature: 0.9,
    maxTokens: 900,
    responseFormat: 'json_object',
  });

  if (!response) {
    return fallback;
  }

  const parsed = extractJsonPayload(response);
  if (!parsed || !parsed.article) {
    return fallback;
  }

  return {
    headline: parsed.headline || fallback.headline,
    preview: parsed.preview || fallback.preview,
    article: parsed.article || fallback.article,
    source: 'chatgpt',
  };
}

export {
  generatePlayerNewsContent,
  generatePressArticle,
  buildNewsPromptContext,
  buildStandings,
};
