import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { generatePressArticle } from '../utils/newsContent';
import {
  loadPressWeek,
  prunePressWeeks,
  savePressWeek,
  listStoredWeeks,
} from '../utils/pressArchive';

function buildAngles(seasonProgress = {}, coverageWeek = null) {
  const upcomingWeek = seasonProgress.currentWeek || 1;
  const totalWeeks = seasonProgress.totalWeeks || upcomingWeek;
  const recapWeek = coverageWeek || Math.max(1, upcomingWeek - 1);
  const storylinesWeek = Math.min(totalWeeks, Math.max(1, upcomingWeek));
  const nextWeek = Math.min(totalWeeks, storylinesWeek + 1);

  return [
    {
      id: `week-${recapWeek}-recap`,
      label: `Week ${recapWeek} Heat Check`,
      description: 'Recap last week\'s results, streaks, and highlight-reel plays with colorful commentary.',
      focus: 'recap',
      prompt: 'Lead with the biggest swings, standout players, and coaching calls from the completed week. Cite specific scores or stats where possible.',
      toneHint: 'realistic with a dash of hype',
      nextWeek: storylinesWeek,
      recapWeek,
    },
    {
      id: `week-${storylinesWeek}-stakes`,
      label: `Race for Week ${storylinesWeek}`,
      description: 'Dig into standings pressure, playoff math, and what every contender needs right now.',
      focus: 'stakes',
      prompt: 'Explain what is at stake in the standings, referencing point differentials, streaks, and executive decisions shaping the playoff race.',
      toneHint: 'intense and analytical',
      nextWeek,
    },
    {
      id: `week-${storylinesWeek}-streakwatch`,
      label: `Streak Watch & Power Pulse`,
      description: 'Detail hot streaks, slumps, and point swings redefining the league hierarchy.',
      focus: 'streaks',
      prompt: 'Spotlight the hottest and coldest teams using streak data and recent scores. Work in colourful flair while staying grounded in numbers.',
      toneHint: 'energetic and quirky',
      nextWeek,
    },
    {
      id: `week-${nextWeek}-matchups`,
      label: `Marquee Matchups for Week ${nextWeek}`,
      description: 'Preview pivotal games, revenge narratives, and tactical battles on tap for the next slate.',
      focus: 'matchups',
      prompt: 'Preview one or two compelling upcoming games by referencing the involved teams, their coaches or GMs, and how recent trends set the stage.',
      toneHint: 'dramatic and anticipatory',
      nextWeek,
    },
    {
      id: `week-${storylinesWeek}-clubhouse`,
      label: `Clubhouse Chatter & Front Office Buzz`,
      description: 'Report on trades, signings, locker-room energy, and delightful oddities sweeping the league.',
      focus: 'buzz',
      prompt: 'Blend notable headlines with staff personalities and fan reaction. Keep it funny or wholesome while highlighting concrete developments.',
      toneHint: 'whimsical and heartfelt',
      nextWeek,
    },
  ];
}

function splitParagraphs(text) {
  if (!text) return [];
  const segments = text.split(/\n+/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length) return segments;
  return text.split(/(?<=[.!?])\s+/).map((segment) => segment.trim()).filter(Boolean);
}

function parseWeekKey(weekKey) {
  const match = /^S(\d+)-W(\d+)$/.exec(weekKey || '');
  if (!match) return { seasonNumber: 0, weekNumber: 0 };
  return {
    seasonNumber: Number.parseInt(match[1], 10) || 0,
    weekNumber: Number.parseInt(match[2], 10) || 0,
  };
}

function formatWeekLabel(weekKey) {
  const { seasonNumber, weekNumber } = parseWeekKey(weekKey);
  if (!seasonNumber && !weekNumber) return 'Press Coverage';
  return `Season ${seasonNumber} • Week ${weekNumber}`;
}

const MAX_IN_MEMORY_WEEKS = 3;
const MAX_STORED_WEEKS = 12;

export default function PressArticlesModal({
  open,
  onClose,
  league,
  season,
  seasonProgress,
  pressCoverageWeek,
}) {
  const [selectedArticleKey, setSelectedArticleKey] = useState(null);
  const [articlesByWeek, setArticlesByWeek] = useState({});
  const [archivedWeeks, setArchivedWeeks] = useState([]);
  const cacheRef = useRef(new Map());
  const orderRef = useRef([]);
  const inflightRef = useRef(new Set());
  const loadedSeasonRef = useRef(null);

  const angles = useMemo(() => buildAngles(seasonProgress, pressCoverageWeek), [seasonProgress, pressCoverageWeek]);
  const seasonNumber = season?.seasonNumber || league?.seasonNumber || 1;
  const weekKey = useMemo(() => {
    if (!pressCoverageWeek) return null;
    return `S${seasonNumber}-W${pressCoverageWeek}`;
  }, [seasonNumber, pressCoverageWeek]);

  const syncCacheToState = useCallback(() => {
    setArticlesByWeek(Object.fromEntries(cacheRef.current.entries()));
  }, []);

  const touchWeekCache = useCallback((key, payload) => {
    if (!key) return;
    const map = cacheRef.current;
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    map.set(key, safePayload);
    orderRef.current = orderRef.current.filter((entry) => entry !== key);
    orderRef.current.push(key);
    while (orderRef.current.length > MAX_IN_MEMORY_WEEKS) {
      const oldest = orderRef.current.shift();
      if (oldest && oldest !== key) {
        map.delete(oldest);
      }
    }
    syncCacheToState();
  }, [syncCacheToState]);

  const markWeekSeen = useCallback((key) => {
    if (!key) return;
    setArchivedWeeks((prev) => {
      if (prev.includes(key)) return prev;
      return [...prev, key];
    });
  }, []);

  const persistWeek = useCallback(async (key) => {
    if (!seasonNumber || !key) return;
    const payload = cacheRef.current.get(key) || {};
    await savePressWeek({ seasonNumber, weekKey: key, data: payload });
    const keepKeys = orderRef.current.slice();
    await prunePressWeeks({ seasonNumber, keepKeys, maxStoredWeeks: MAX_STORED_WEEKS });
  }, [seasonNumber]);

  useEffect(() => {
    if (!seasonNumber) {
      cacheRef.current = new Map();
      orderRef.current = [];
      setArticlesByWeek({});
      loadedSeasonRef.current = null;
      setArchivedWeeks([]);
      return;
    }
    if (loadedSeasonRef.current === seasonNumber) return;
    cacheRef.current = new Map();
    orderRef.current = [];
    setArticlesByWeek({});
    loadedSeasonRef.current = seasonNumber;
    setArchivedWeeks([]);
  }, [seasonNumber]);

  useEffect(() => {
    if (!seasonNumber) return;
    let cancelled = false;
    (async () => {
      const weeks = await listStoredWeeks(seasonNumber);
      if (cancelled) return;
      if (Array.isArray(weeks)) {
        setArchivedWeeks((prev) => {
          const merged = new Set([...prev, ...weeks]);
          return Array.from(merged);
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seasonNumber]);

  useEffect(() => {
    if (!open) {
      setSelectedArticleKey(null);
      return;
    }
    if (!league || !season) return;
    if (!weekKey) return;
    let cancelled = false;

    (async () => {
      if (cacheRef.current.has(weekKey)) {
        touchWeekCache(weekKey, cacheRef.current.get(weekKey));
        return;
      }
      const stored = await loadPressWeek({ seasonNumber, weekKey });
      if (cancelled) return;
      touchWeekCache(weekKey, stored);
      markWeekSeen(weekKey);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, league, season, weekKey, seasonNumber, touchWeekCache, markWeekSeen]);

  useEffect(() => {
    if (!open) return;
    if (!league || !season) return;
    if (!weekKey) return;
    const existingCache = cacheRef.current.get(weekKey) || {};
    cacheRef.current.set(weekKey, existingCache);
    syncCacheToState();
    markWeekSeen(weekKey);

    angles.forEach((angle) => {
      const cached = existingCache[angle.id];
      if (cached?.article) return;
      if (inflightRef.current.has(angle.id)) return;
      inflightRef.current.add(angle.id);
      generatePressArticle({ league, season, seasonProgress, coverageWeek: pressCoverageWeek, angle })
        .then(async (result) => {
          if (!result) return;
          const payload = {
            ...result,
            generatedAt: new Date().toISOString(),
            angle,
            weekKey,
          };
          const nextWeekData = {
            ...(cacheRef.current.get(weekKey) || {}),
            [angle.id]: payload,
          };
          touchWeekCache(weekKey, nextWeekData);
          markWeekSeen(weekKey);
          await persistWeek(weekKey);
        })
        .finally(() => {
          inflightRef.current.delete(angle.id);
        });
    });
  }, [
    open,
    league,
    season,
    seasonProgress,
    angles,
    weekKey,
    pressCoverageWeek,
    touchWeekCache,
    persistWeek,
    syncCacheToState,
    markWeekSeen,
  ]);

  const sections = useMemo(() => {
    const sectionMap = new Map();
    const knownWeekKeys = new Set([
      ...(archivedWeeks || []),
      ...Object.keys(articlesByWeek || {}),
      weekKey,
    ].filter(Boolean));

    knownWeekKeys.forEach((key) => {
      const stored = articlesByWeek[key] || {};
      const isLoaded = stored && Object.keys(stored).length > 0;
      if (key === weekKey) {
        const entries = angles.map((angle) => {
          const data = stored[angle.id] || null;
          const generating = inflightRef.current.has(angle.id) && !data;
          return {
            weekKey: key,
            angle,
            data,
            generating,
            ready: !!data?.article,
          };
        });
        const readyEntries = entries.filter((entry) => entry.ready);
        const hasPending = entries.some((entry) => entry.generating || (entry.data && !entry.data.article));
        sectionMap.set(key, { entries: readyEntries, hasPending, archived: false });
      } else {
        const entries = Object.values(stored).map((item) => ({
          weekKey: key,
          angle: item.angle || { id: item.id, label: item.headline, description: item.preview },
          data: item,
          generating: false,
        }));
        const readyEntries = entries.filter((entry) => entry.data?.article);
        const hasPending = readyEntries.length !== entries.length;
        sectionMap.set(key, { entries: readyEntries, hasPending, archived: !isLoaded });
      }
    });

    const sortedKeys = Array.from(knownWeekKeys).sort((a, b) => {
      const aParsed = parseWeekKey(a);
      const bParsed = parseWeekKey(b);
      if (aParsed.seasonNumber !== bParsed.seasonNumber) {
        return bParsed.seasonNumber - aParsed.seasonNumber;
      }
      return bParsed.weekNumber - aParsed.weekNumber;
    });

    return sortedKeys.map((key) => {
      const sectionData = sectionMap.get(key) || { entries: [], hasPending: false };
      return {
        weekKey: key,
        label: formatWeekLabel(key),
        entries: sectionData.entries || [],
        hasPending: sectionData.hasPending || false,
      };
    });
  }, [angles, articlesByWeek, weekKey, archivedWeeks]);

  const flatEntries = useMemo(() => sections.flatMap((section) => section.entries), [sections]);

  const activeArticle = useMemo(() => {
    if (!selectedArticleKey) return null;
    return flatEntries.find((entry) => `${entry.weekKey}::${entry.angle.id}` === selectedArticleKey) || null;
  }, [flatEntries, selectedArticleKey]);

  const handleOpenArticle = useCallback((week, angleId) => {
    setSelectedArticleKey(`${week}::${angleId}`);
  }, []);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticleKey(null);
  }, []);

  const handleLoadArchived = useCallback((week) => {
    if (!seasonNumber || !week) return;
    const inflightKey = `load:${week}`;
    if (inflightRef.current.has(inflightKey)) return;
    inflightRef.current.add(inflightKey);
    loadPressWeek({ seasonNumber, weekKey: week })
      .then((data) => {
        if (!data || typeof data !== 'object') return;
        touchWeekCache(week, data);
        markWeekSeen(week);
      })
      .finally(() => {
        inflightRef.current.delete(inflightKey);
      });
  }, [seasonNumber, touchWeekCache, markWeekSeen]);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Articles From The Press"
        width="min(96vw, 760px)"
      >
        {sections.length === 0 ? (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            Press coverage will appear once the season is underway.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {sections.map((section) => (
              <div key={section.weekKey} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(205,232,205,0.75)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {section.label}
                </div>
                {section.entries.length === 0 ? (
                  section.archived ? (
                    <button
                      type="button"
                      onClick={() => handleLoadArchived(section.weekKey)}
                      style={{
                        border: '1px solid rgba(32,112,32,0.45)',
                        borderRadius: 999,
                        background: 'rgba(6,36,6,0.9)',
                        color: '#e5ffe5',
                        padding: '8px 16px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                      }}
                    >
                      {inflightRef.current.has(`load:${section.weekKey}`)
                        ? 'Restoring archived coverage…'
                        : 'Load archived coverage'}
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.65)' }}>
                      {section.hasPending
                        ? 'Articles are being drafted for this week.'
                        : 'No articles available for this week yet.'}
                    </div>
                  )
                ) : (
                  section.entries.map(({ weekKey: entryWeek, angle, data, generating }) => (
                    <button
                      key={`${entryWeek}-${angle.id}`}
                      type="button"
                      onClick={() => handleOpenArticle(entryWeek, angle.id)}
                      style={{
                        border: '1px solid rgba(32,112,32,0.45)',
                        borderRadius: 12,
                        background: 'rgba(6,36,6,0.94)',
                        padding: '14px 18px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <header style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontWeight: 700, color: '#e5ffe5', fontSize: 16, letterSpacing: 0.5 }}>
                          {data?.headline || angle.label}
                        </div>
                        {data?.generatedAt && (
                          <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.65)' }}>
                            {new Date(data.generatedAt).toLocaleString()}
                          </div>
                        )}
                      </header>
                      {data?.source && (
                        <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.7)', fontStyle: 'italic' }}>
                          {data.source === 'chatgpt' ? 'Generated via ChatGPT API' : 'Generated with local fallback'}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.7)' }}>{angle.description}</div>
                      <div style={{ fontSize: 13, color: 'rgba(205,232,205,0.85)', lineHeight: 1.45 }}>
                        {data?.preview || 'Click to open the full column from the press box.'}
                      </div>
                      {generating && (
                        <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.65)', fontStyle: 'italic' }}>
                          Drafting fresh insights…
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!activeArticle}
        onClose={handleCloseArticle}
        title={activeArticle?.data?.headline || activeArticle?.angle?.label || 'Press Column'}
        width="min(94vw, 680px)"
      >
        {!activeArticle ? (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            Choose an article to read the press coverage.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeArticle.data?.source && (
              <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.7)', fontStyle: 'italic' }}>
                {activeArticle.data.source === 'chatgpt'
                  ? 'Generated via ChatGPT API'
                  : 'Generated with local fallback'}
              </div>
            )}
            {activeArticle.angle?.description && (
              <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.7)' }}>
                {activeArticle.angle.description}
              </div>
            )}
            {splitParagraphs(activeArticle.data?.article || '').map((paragraph, idx) => (
              <p key={idx} style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, color: '#f0fff0' }}>
                {paragraph}
              </p>
            ))}
            {!activeArticle.data?.article && (
              <div style={{ fontSize: 13, color: 'rgba(205,232,205,0.8)' }}>
                Article content is still being prepared.
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
