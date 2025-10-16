import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { generatePressArticle } from '../utils/newsContent';

function buildAngles(seasonProgress = {}) {
  const currentWeek = seasonProgress.currentWeek || 1;
  const totalWeeks = seasonProgress.totalWeeks || currentWeek;
  const nextWeek = Math.min(totalWeeks, currentWeek + 1);
  return [
    {
      id: `week-${currentWeek}-recap`,
      label: `Week ${currentWeek} Heat Check`,
      description: 'Recap last week\'s results, streaks, and highlight-reel plays with colorful commentary.',
      focus: 'recap',
      nextWeek,
    },
    {
      id: `week-${currentWeek}-storylines`,
      label: `Storylines Heading Into Week ${nextWeek}`,
      description: 'Dig into standings pressure, playoff stakes, and front office moves shaping the league narrative.',
      focus: 'storylines',
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

export default function PressArticlesModal({ open, onClose, league, season, seasonProgress }) {
  const [selectedArticleKey, setSelectedArticleKey] = useState(null);
  const [articlesByWeek, setArticlesByWeek] = useState({});
  const cacheRef = useRef({});
  const inflightRef = useRef(new Set());

  const angles = useMemo(() => buildAngles(seasonProgress), [seasonProgress]);
  const seasonNumber = season?.seasonNumber || league?.seasonNumber || 1;
  const weekKey = useMemo(() => `S${seasonNumber}-W${seasonProgress?.currentWeek || 1}`, [seasonNumber, seasonProgress?.currentWeek]);

  useEffect(() => {
    if (!open) {
      setSelectedArticleKey(null);
      return;
    }
    if (!league || !season) return;
    const existingCache = cacheRef.current[weekKey] || {};
    cacheRef.current[weekKey] = existingCache;
    setArticlesByWeek({ ...cacheRef.current });

    angles.forEach((angle) => {
      const cached = existingCache[angle.id];
      if (cached?.article) return;
      if (inflightRef.current.has(angle.id)) return;
      inflightRef.current.add(angle.id);
      generatePressArticle({ league, season, seasonProgress, angle })
        .then((result) => {
          if (!result) return;
          const payload = {
            ...result,
            generatedAt: new Date().toISOString(),
            angle,
            weekKey,
          };
          cacheRef.current[weekKey] = {
            ...(cacheRef.current[weekKey] || {}),
            [angle.id]: payload,
          };
          setArticlesByWeek((prev) => ({
            ...prev,
            [weekKey]: {
              ...(prev[weekKey] || {}),
              [angle.id]: payload,
            },
          }));
        })
        .finally(() => {
          inflightRef.current.delete(angle.id);
        });
    });
  }, [open, league, season, seasonProgress, angles, weekKey]);

  const sections = useMemo(() => {
    const sectionMap = new Map();
    const knownWeekKeys = new Set([
      ...Object.keys(articlesByWeek || {}),
      weekKey,
    ].filter(Boolean));

    knownWeekKeys.forEach((key) => {
      const stored = articlesByWeek[key] || {};
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
        sectionMap.set(key, { entries: readyEntries, hasPending });
      } else {
        const entries = Object.values(stored).map((item) => ({
          weekKey: key,
          angle: item.angle || { id: item.id, label: item.headline, description: item.preview },
          data: item,
          generating: false,
        }));
        const readyEntries = entries.filter((entry) => entry.data?.article);
        const hasPending = readyEntries.length !== entries.length;
        sectionMap.set(key, { entries: readyEntries, hasPending });
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
  }, [angles, articlesByWeek, weekKey]);

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
                  <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.65)' }}>
                    {section.hasPending
                      ? 'Articles are being drafted for this week.'
                      : 'No articles available for this week yet.'}
                  </div>
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
