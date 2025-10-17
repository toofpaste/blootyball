import { readCompressedJson, removeCompressed, writeCompressedJson } from './compressedStore';

const VERSION = 'v1';
const SEASON_PREFIX = `bb_press_${VERSION}::season-`;

function seasonIndexKey(seasonNumber) {
  return `${SEASON_PREFIX}${seasonNumber}::index`;
}

function seasonWeekKey(seasonNumber, weekKey) {
  return `${SEASON_PREFIX}${seasonNumber}::${weekKey}`;
}

function parseWeekOrder(weekKey) {
  if (!weekKey) return 0;
  const match = /W(\d+)/i.exec(weekKey);
  if (!match) return 0;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : 0;
}

async function updateSeasonIndex(seasonNumber, updater) {
  const key = seasonIndexKey(seasonNumber);
  const existing = await readCompressedJson(key);
  const current = Array.isArray(existing) ? existing.slice() : [];
  const next = updater(current);
  await writeCompressedJson(key, next);
  return next;
}

export async function loadPressWeek({ seasonNumber, weekKey }) {
  if (!seasonNumber || !weekKey) return {};
  const payload = await readCompressedJson(seasonWeekKey(seasonNumber, weekKey));
  return payload && typeof payload === 'object' ? payload : {};
}

export async function savePressWeek({ seasonNumber, weekKey, data }) {
  if (!seasonNumber || !weekKey) return null;
  const safeData = data && typeof data === 'object' ? data : {};
  await writeCompressedJson(seasonWeekKey(seasonNumber, weekKey), safeData);
  await updateSeasonIndex(seasonNumber, (current) => {
    const set = new Set(current);
    set.add(weekKey);
    return Array.from(set).sort((a, b) => parseWeekOrder(a) - parseWeekOrder(b));
  });
  return true;
}

export async function prunePressWeeks({ seasonNumber, keepKeys = [], maxStoredWeeks = 12 }) {
  if (!seasonNumber) return null;
  const keepSet = new Set(keepKeys.filter(Boolean));
  const currentIndex = await updateSeasonIndex(seasonNumber, (current) => current);
  const combined = Array.from(new Set([...(currentIndex || []), ...keepSet]));
  combined.sort((a, b) => parseWeekOrder(a) - parseWeekOrder(b));

  const allowed = new Set();
  keepSet.forEach((key) => allowed.add(key));
  for (let i = combined.length - 1; i >= 0 && allowed.size < maxStoredWeeks; i -= 1) {
    allowed.add(combined[i]);
  }

  const removals = combined.filter((key) => !allowed.has(key));
  await Promise.all(removals.map((key) => removeCompressed(seasonWeekKey(seasonNumber, key))));

  const nextIndex = combined.filter((key) => allowed.has(key));
  await writeCompressedJson(seasonIndexKey(seasonNumber), nextIndex);
  return nextIndex;
}

export async function listStoredWeeks(seasonNumber) {
  if (!seasonNumber) return [];
  const index = await readCompressedJson(seasonIndexKey(seasonNumber));
  return Array.isArray(index) ? index.slice() : [];
}
