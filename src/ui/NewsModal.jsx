import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { getTeamIdentity } from '../engine/data/teamLibrary';
import { generatePlayerNewsContent } from '../utils/newsContent';

function formatTimestamp(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (err) {
    return '';
  }
}

function headlineType(type) {
  if (!type) return 'Update';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveTeamName(teamId) {
  if (!teamId) return null;
  const identity = getTeamIdentity(teamId);
  if (!identity) return teamId;
  return identity.displayName || identity.name || teamId;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function blendWithWhite(color, amount = 0.35) {
  if (!color || typeof color !== 'string') return null;
  const normalized = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const ratio = clamp01(amount);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const mix = (value) => Math.round(value + (255 - value) * ratio);
  const toHex = (value) => mix(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function resolveTeamAccentColor(entry) {
  if (!entry) return null;
  const teamIds = [entry.teamId, entry.partnerTeam, entry.otherTeam, entry.otherId, entry.opponentId];
  const colorCandidates = [];
  teamIds.filter(Boolean).forEach((teamId) => {
    const identity = getTeamIdentity(teamId);
    if (!identity?.colors) return;
    if (identity.colors.primary) colorCandidates.push(identity.colors.primary);
    if (identity.colors.secondary) colorCandidates.push(identity.colors.secondary);
  });
  if (typeof entry.primaryColor === 'string') colorCandidates.push(entry.primaryColor);
  if (Array.isArray(entry.colors)) {
    entry.colors.forEach((value) => {
      if (typeof value === 'string') colorCandidates.push(value);
    });
  }
  // Avoid duplicate heavy loops by returning first valid softened color.
  for (let index = 0; index < colorCandidates.length; index += 1) {
    const softened = blendWithWhite(colorCandidates[index], 0.32);
    if (softened) return softened;
  }
  return null;
}

function resolveHeadlineColor(entry) {
  const accent = resolveTeamAccentColor(entry);
  if (accent) return accent;
  const type = String(entry?.type || '').toLowerCase();
  if (type === 'injury' || type === 'suspension') return '#ff6b6b';
  if (type === 'signing') return '#6fb6ff';
  if (type === 'spotlight' || type === 'headline') return '#ffe27a';
  const detail = String(entry?.detail || '');
  if (/\bout\s+\d+\s+game/i.test(detail) || /\bsuspended\b/i.test(detail)) {
    return '#ff6b6b';
  }
  return '#f0fff0';
}

export default function NewsModal({ open, onClose, league, season }) {
  const [selectedId, setSelectedId] = useState(null);
  const [articleMap, setArticleMap] = useState({});
  const inflightRef = useRef(new Set());

  const items = useMemo(() => {
    if (!league?.newsFeed) return [];
    return league.newsFeed
      .filter((entry) => entry?.type !== 'press')
      .map((entry) => {
      const seasonNumber = entry.seasonNumber ?? season?.seasonNumber ?? league?.seasonNumber ?? null;
      const type = headlineType(entry.type);
      const teamName = resolveTeamName(entry.teamId);
      const partnerName = resolveTeamName(entry.partnerTeam);
      const context = [
        seasonNumber ? `Season ${seasonNumber}` : null,
        teamName,
        partnerName ? `↔ ${partnerName}` : null,
      ].filter(Boolean).join(' • ');
      return {
        id: entry.id || `${entry.type}-${entry.text}`,
        type,
        context,
        text: entry.text,
        detail: entry.detail,
        createdAt: formatTimestamp(entry.createdAt),
        raw: entry,
      };
      });
  }, [league, season]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      return;
    }
    items.forEach((item) => {
      const existing = item.raw?.aiContent || articleMap[item.id];
      if (existing?.article) return;
      if (inflightRef.current.has(item.id)) return;
      inflightRef.current.add(item.id);
      generatePlayerNewsContent({ league, season, entry: item.raw })
        .then((result) => {
          if (!result) return;
          setArticleMap((prev) => ({ ...prev, [item.id]: result }));
          if (item.raw) {
            item.raw.aiContent = result;
          }
        })
        .finally(() => {
          inflightRef.current.delete(item.id);
        });
    });
  }, [open, items, league, season, articleMap]);

  const handleCloseArticle = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleOpenArticle = useCallback((item) => {
    setSelectedId(item?.id || null);
  }, []);

  const displayItems = useMemo(() => {
    return items.map((item) => {
      const aiContent = item.raw?.aiContent || articleMap[item.id] || null;
      const generating = inflightRef.current.has(item.id) && !aiContent;
      return {
        ...item,
        aiContent,
        generating,
        headlineColor: resolveHeadlineColor(item.raw),
      };
    });
  }, [items, articleMap]);

  const activeArticle = useMemo(() => {
    if (!selectedId) return null;
    return displayItems.find((item) => item.id === selectedId) || null;
  }, [displayItems, selectedId]);

  const renderArticleBody = useCallback((bodyText, fallbackText) => {
    const text = bodyText || fallbackText || '';
    if (!text) {
      return (
        <p style={{ margin: 0, fontSize: 14, color: '#f0fff0' }}>
          Article content is still loading.
        </p>
      );
    }
    const segments = text.split(/\n+/).map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) {
      const sentences = text.split(/(?<=[.!?])\s+/).map((segment) => segment.trim()).filter(Boolean);
      return sentences.map((sentence, idx) => (
        <p key={idx} style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: '#f0fff0' }}>
          {sentence}
        </p>
      ));
    }
    return segments.map((segment, idx) => (
      <p key={idx} style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: '#f0fff0' }}>
        {segment}
      </p>
    ));
  }, []);
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="League News"
        width="min(96vw, 720px)"
      >
        {displayItems.length === 0 ? (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            No transactions, injuries, or headlines have been recorded yet.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {displayItems.map((item) => {
              const headline = item.aiContent?.headline || item.text;
              const preview = item.aiContent?.preview || item.detail || 'Click to read the full story.';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenArticle(item)}
                  style={{
                    border: '1px solid rgba(26,92,26,0.4)',
                    borderRadius: 12,
                    background: 'rgba(4,28,4,0.92)',
                    padding: '12px 16px',
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
                    <div style={{ fontWeight: 700, color: '#e0ffd7', fontSize: 15, letterSpacing: 0.4 }}>
                      {item.type}
                    </div>
                    {item.createdAt && (
                      <div style={{ fontSize: 11, color: 'rgba(205,232,205,0.7)' }}>{item.createdAt}</div>
                    )}
                  </header>
                  {item.context && (
                    <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.75)' }}>{item.context}</div>
                  )}
                  <div
                    style={{
                      fontSize: 15,
                      color: item.headlineColor || '#f0fff0',
                      fontWeight: 700,
                      letterSpacing: 0.2,
                    }}
                  >
                    {headline}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(205,232,205,0.85)', lineHeight: 1.45 }}>
                    {preview}
                  </div>
                  {item.generating && (
                    <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.65)', fontStyle: 'italic' }}>
                      Generating article with ChatGPT…
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={!!activeArticle}
        onClose={handleCloseArticle}
        title={activeArticle?.aiContent?.headline || activeArticle?.text || 'League News Story'}
        width="min(94vw, 640px)"
      >
        {!activeArticle ? (
          <div style={{ color: '#cde8cd', fontSize: 14 }}>
            Select a headline to read the full story.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeArticle.context && (
              <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.75)' }}>{activeArticle.context}</div>
            )}
            {activeArticle.aiContent?.tone && (
              <div style={{ fontSize: 12, color: 'rgba(205,232,205,0.6)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Tone: {activeArticle.aiContent.tone}
              </div>
            )}
            {renderArticleBody(activeArticle.aiContent?.article, activeArticle.detail || activeArticle.text)}
          </div>
        )}
      </Modal>
    </>
  );
}
