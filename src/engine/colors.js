// src/engine/colors.js

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const PRIORITY_KEYS = ['primary', 'secondary', 'accent', 'alternate', 'alt', 'tertiary', 'quaternary', 'light', 'dark'];

function normalizeHex(color) {
    if (typeof color !== 'string') return null;
    const trimmed = color.trim();
    if (!HEX_RE.test(trimmed)) return null;
    let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (hex.length === 3) {
        hex = hex.split('').map(ch => ch + ch).join('');
    }
    return `#${hex.toUpperCase()}`;
}

function hexToRgb(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const value = normalized.slice(1);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return { r, g, b };
}

function rgbToHex({ r, g, b }) {
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        switch (max) {
            case rn:
                h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
                break;
            case gn:
                h = ((bn - rn) / delta + 2) * 60;
                break;
            case bn:
                h = ((rn - gn) / delta + 4) * 60;
                break;
            default:
                h = 0;
        }
    }

    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

    return { h, s, l };
}

function hslToRgb(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(1, s));
    const light = Math.max(0, Math.min(1, l));

    if (sat === 0) {
        const value = Math.round(light * 255);
        return { r: value, g: value, b: value };
    }

    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light - c / 2;

    let r1 = 0, g1 = 0, b1 = 0;
    if (hue < 60) {
        r1 = c; g1 = x; b1 = 0;
    } else if (hue < 120) {
        r1 = x; g1 = c; b1 = 0;
    } else if (hue < 180) {
        r1 = 0; g1 = c; b1 = x;
    } else if (hue < 240) {
        r1 = 0; g1 = x; b1 = c;
    } else if (hue < 300) {
        r1 = x; g1 = 0; b1 = c;
    } else {
        r1 = c; g1 = 0; b1 = x;
    }

    return {
        r: (r1 + m) * 255,
        g: (g1 + m) * 255,
        b: (b1 + m) * 255,
    };
}

function isHueGreen(h) {
    return Number.isFinite(h) && h >= 75 && h <= 165;
}

function isGreenishHex(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return false;
    const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (s < 0.15) return false;
    return isHueGreen(h);
}

function shiftHueAwayFromGreen(h) {
    if (!Number.isFinite(h)) return 210;
    return h < 120 ? 40 : 210;
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function collectColorStrings(colorsLike) {
    if (!colorsLike) return [];
    if (typeof colorsLike === 'string') return [colorsLike];
    if (Array.isArray(colorsLike)) return colorsLike.filter(c => typeof c === 'string');
    if (typeof colorsLike === 'object') {
        const result = [];
        PRIORITY_KEYS.forEach((key) => {
            const value = colorsLike[key];
            if (typeof value === 'string') result.push(value);
        });
        Object.values(colorsLike).forEach((value) => {
            if (typeof value === 'string' && !result.includes(value)) result.push(value);
        });
        return result;
    }
    return [];
}

function pickMetaColors(group, slot) {
    if (!group) return null;
    const values = Array.isArray(group) ? group : Object.values(group);
    for (const entry of values) {
        if (!entry || !entry.meta || !entry.meta.colors) continue;
        if (slot && entry.meta.teamSlot && entry.meta.teamSlot !== slot) continue;
        return entry.meta.colors;
    }
    return null;
}

export function sanitizeTeamColor(color, fallback = '#888888') {
    const fallbackNormalized = fallback == null ? null : (normalizeHex(fallback) || '#888888');
    const normalized = normalizeHex(color);
    if (!normalized) {
        return fallbackNormalized || '#888888';
    }

    const rgb = hexToRgb(normalized);
    if (!rgb) return fallbackNormalized || '#888888';
    let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    if (s >= 0.15 && isHueGreen(h)) {
        h = shiftHueAwayFromGreen(h);
        s = Math.max(s, 0.4);
        l = clamp01(l);
        if (l < 0.25) l = 0.32;
        if (l > 0.75) l = 0.65;
    }

    const sanitized = rgbToHex(hslToRgb(h, s, l));
    if (isGreenishHex(sanitized)) {
        return fallbackNormalized || '#888888';
    }
    return sanitized;
}

export function resolveTeamColor(colorsLike, fallback = '#888888') {
    const fallbackColor = sanitizeTeamColor(fallback, '#888888');
    const candidates = collectColorStrings(colorsLike);

    for (const raw of candidates) {
        const normalized = normalizeHex(raw);
        if (!normalized) continue;
        if (!isGreenishHex(normalized)) {
            return normalized;
        }
    }

    for (const raw of candidates) {
        const sanitized = sanitizeTeamColor(raw, null);
        if (sanitized) return sanitized;
    }

    return fallbackColor;
}

export function resolveSlotColors(state, slot, side = 'offense') {
    if (!state) return null;
    const matchup = state.matchup || state.lastCompletedGame?.matchup || null;

    const identityColors = matchup?.identities?.[slot]?.colors;
    if (identityColors) return identityColors;

    const slotToTeam = matchup?.slotToTeam || {};
    const teamId = slotToTeam?.[slot];
    if (teamId && state.season?.teams?.[teamId]?.info?.colors) {
        return state.season.teams[teamId].info.colors;
    }

    const formationGroup = side === 'offense' ? state.play?.formation?.off : state.play?.formation?.def;
    const formationColors = pickMetaColors(formationGroup, slot);
    if (formationColors) return formationColors;

    const rosterGroup = side === 'offense' ? state.roster?.off : state.roster?.def;
    const rosterColors = pickMetaColors(rosterGroup, slot);
    if (rosterColors) return rosterColors;

    const teamsGroup = state.teams?.[slot];
    if (teamsGroup) {
        const group = side === 'offense' ? teamsGroup.off : teamsGroup.def;
        const teamColors = pickMetaColors(group, slot);
        if (teamColors) return teamColors;
    }

    return null;
}

export function isTeamColorGreen(color) {
    const normalized = normalizeHex(color);
    if (!normalized) return false;
    return isGreenishHex(normalized);
}

export function normalizeColorInput(color) {
    return normalizeHex(color);
}

export function getMetaColor(group, slot) {
    return pickMetaColors(group, slot);
}

export function blendTeamColors(colorA, colorB, weight = 0.5, fallback = '#888888') {
    const mixA = hexToRgb(colorA);
    const mixB = hexToRgb(colorB);

    if (!mixA && !mixB) {
        return sanitizeTeamColor(fallback, fallback);
    }

    if (!mixA) {
        return sanitizeTeamColor(colorB || fallback, fallback);
    }

    if (!mixB) {
        return sanitizeTeamColor(colorA || fallback, fallback);
    }

    const ratio = clamp01(weight ?? 0.5);
    const inv = 1 - ratio;

    const blended = {
        r: mixA.r * ratio + mixB.r * inv,
        g: mixA.g * ratio + mixB.g * inv,
        b: mixA.b * ratio + mixB.b * inv,
    };

    return sanitizeTeamColor(rgbToHex(blended), fallback);
}
