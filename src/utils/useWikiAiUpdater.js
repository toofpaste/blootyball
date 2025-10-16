import { useEffect, useRef } from 'react';

function buildTeamContext(league) {
  const map = {};
  if (!league?.teamWiki) return map;
  Object.values(league.teamWiki).forEach((entry) => {
    if (!entry?.id) return;
    const latestSeason = Array.isArray(entry.seasonSummaries) ? entry.seasonSummaries[0] : null;
    map[entry.id] = {
      name: entry.displayName || entry.id,
      lastUpdatedSeason: entry.lastUpdatedSeason ?? null,
      totals: entry.totals || {},
      latestSeason: latestSeason
        ? {
            seasonNumber: latestSeason.seasonNumber ?? null,
            record: latestSeason.recordText || '0-0',
            playoffResult: latestSeason.playoffResult || 'Regular Season',
            awards: latestSeason.awards || [],
            notes: latestSeason.notes || '',
          }
        : null,
      notablePlayers: Array.isArray(entry.notablePlayers)
        ? entry.notablePlayers.slice(0, 3).map((player) => ({
            name: player.name || player.playerId,
            highlights: player.highlights || [],
          }))
        : [],
      recordHighlights: Array.isArray(entry.recordsSet)
        ? entry.recordsSet.slice(0, 3).map((record) => ({
            label: record.label,
            value: record.value,
            unit: record.unit,
            seasonNumber: record.seasonNumber ?? null,
            holder: record.holderName || '',
          }))
        : [],
    };
  });
  return map;
}

function createPromptPayload(league) {
  const seasonNumber = league?.teamWikiLastUpdatedSeason || league?.finalizedSeasonNumber || 0;
  const teams = buildTeamContext(league);
  return {
    seasonNumber,
    teams,
  };
}

function extractJson(content) {
  if (!content) return null;
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end >= start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

export function useWikiAiUpdater({ league, onOverride }) {
  const processingRef = useRef(false);
  const lastSeasonRef = useRef(0);

  useEffect(() => {
    const seasonNumber = league?.teamWikiLastUpdatedSeason || league?.finalizedSeasonNumber || 0;
    if (!seasonNumber || seasonNumber <= (lastSeasonRef.current || 0)) return;

    const envKey = typeof process !== 'undefined' && process.env
      ? process.env.REACT_APP_OPENAI_API_KEY
      : undefined;
    const apiKey = envKey
      || (typeof window !== 'undefined' ? window.__BLOOTYBALL_OPENAI_KEY : null);
    if (!apiKey) {
      lastSeasonRef.current = seasonNumber;
      onOverride?.({ seasonNumber, teams: {} });
      return;
    }
    if (processingRef.current) return;
    processingRef.current = true;

    const controller = new AbortController();
    const payload = createPromptPayload(league);
    const messages = [
      {
        role: 'system',
        content: 'You are a sports writer keeping a league encyclopedia up to date. Respond with JSON only.',
      },
      {
        role: 'user',
        content: `Update the wiki prose for each team using the latest season results. Return JSON keyed by team id with a "sections" map containing updated section text. Use concise paragraphs. Context: ${JSON.stringify(payload)}`,
      },
    ];

    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        const content = data?.choices?.[0]?.message?.content;
        const parsed = extractJson(content);
        if (parsed && typeof parsed === 'object') {
          onOverride?.({ seasonNumber, teams: parsed });
        } else {
          onOverride?.({ seasonNumber, teams: {} });
        }
      })
      .catch(() => {
        onOverride?.({ seasonNumber, teams: {} });
      })
      .finally(() => {
        processingRef.current = false;
        lastSeasonRef.current = seasonNumber;
      });

    return () => controller.abort();
  }, [league, onOverride]);
}
