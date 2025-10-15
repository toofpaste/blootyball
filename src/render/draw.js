// src/render/draw.js
import {
    COLORS, FIELD_PIX_W, FIELD_PIX_H,
    ENDZONE_YARDS, PLAYING_YARDS_H,
    PX_PER_YARD, FIELD_YARDS_W,
    TEAM_RED, TEAM_BLK,
} from '../engine/constants';

import { yardsToPixY } from '../engine/helpers';
import { getBallPix } from '../engine/ball';
import { resolveTeamColor, resolveSlotColors } from '../engine/colors';

const QB_VISION_COLORS = {
    PRIMARY: '#ffd54f',
    THROW: '#ffb74d',
    THROW_AWAY: '#b0bec5',
    CHECKDOWN: '#4fc3f7',
    PROGRESS: '#80cbc4',
    SCRAMBLE: '#ff8a80',
    HOLD: '#d7ccc8',
    SCAN: '#f5f5f5',
};

export function draw(canvas, state) {
    if (!canvas || !state || !state.play || !state.play.formation) return;
    const ctx = canvas.getContext('2d');

    // Set up crisp scaling using DPR
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    // Reset and clear in device pixels
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Scale to DPR, then rotate portrait content into landscape
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(0, canvas.height / dpr);
    ctx.rotate(-Math.PI / 2);

    // Now draw everything in portrait coordinates (FIELD_PIX_W x FIELD_PIX_H)
    drawContent(ctx, state);

    ctx.restore();
}

/* ---------- portrait-space content (unchanged logic) ---------- */
function drawContent(ctx, state) {
    drawField(ctx, state);

    // --- LOS & Line To Gain (dashed) ---
    // Robustly compute: LOS = current drive.losYards
    // LTG = min(LOS + max(1, toGo), goal line at 100)
    const losYards = Math.max(0, Math.min(100, (state?.drive?.losYards ?? 25)));
    const rawToGo = Math.max(1, (state?.drive?.toGo ?? 10));
    const cappedToGo = Math.min(rawToGo, 100 - losYards);

    const losY = yardsToPixY(ENDZONE_YARDS + losYards);
    const ltgY = yardsToPixY(ENDZONE_YARDS + losYards + cappedToGo);

    // Colors: LOS = blue, First Down = yellow
    ctx.lineWidth = 2;
    // LOS (blue)
    ctx.strokeStyle = '#3da5ff';
    dashLine(ctx, 0, losY, FIELD_PIX_W, losY, [10, 8]);
    // First down (yellow)
    ctx.strokeStyle = '#ffd400';
    dashLine(ctx, 0, ltgY, FIELD_PIX_W, ltgY, [10, 8]);


    // Players
    const isFieldGoal = state.play?.phase === 'FIELD_GOAL' && state.play?.specialTeams?.visual;
    if (isFieldGoal) {
        drawFieldGoalScene(ctx, state);
    } else {
        const { off = {}, def = {} } = state.play.formation || {};
        const safePlayers = (obj) => Object.values(obj || []).filter(
            (p) => p && p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)
        );
        const offenseSlot = state.possession === TEAM_BLK ? TEAM_BLK : TEAM_RED;
        const defenseSlot = offenseSlot === TEAM_RED ? TEAM_BLK : TEAM_RED;
        const offenseColor = getTeamDisplayColor(state, offenseSlot, 'offense');
        const defenseColor = getTeamDisplayColor(state, defenseSlot, 'defense');
        const playElapsed = typeof state.play?.elapsed === 'number' ? state.play.elapsed : null;
        const qbVision = state.play?.qbVision || null;
        safePlayers(def).forEach(p => drawPlayer(ctx, p, defenseColor));
        safePlayers(off).forEach(p => drawPlayer(ctx, p, offenseColor, { qbVision, playElapsed }));

        // Ball
        try {
            const bp = getBallPix(state);
            if (bp && Number.isFinite(bp.x) && Number.isFinite(bp.y)) drawBall(ctx, bp, state.play.ball);
        } catch { }
    }

    // HUD (top-left of portrait space -> left side of landscape)
    ctx.fillStyle = COLORS.text;
    ctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx.fillText(`${state.play.resultText || ''}`, 12, 24);
}

function getTeamDisplayColor(state, slot, side) {
    const fallback = slot === TEAM_RED ? COLORS.red : COLORS.black;
    const source = resolveSlotColors(state, slot, side);
    return resolveTeamColor(source, fallback);
}

function drawFieldGoalScene(ctx, state) {
    const special = state.play?.specialTeams;
    const visual = special?.visual;
    if (!visual) return;
    const offenseSlot = state.possession === TEAM_BLK ? TEAM_BLK : TEAM_RED;
    const defenseSlot = offenseSlot === TEAM_RED ? TEAM_BLK : TEAM_RED;
    const offenseColor = getTeamDisplayColor(state, offenseSlot, 'offense');
    const defenseColor = getTeamDisplayColor(state, defenseSlot, 'defense');

    const drawGroup = (arr, color) => {
        (arr || []).forEach((p) => {
            if (!p?.renderPos) return;
            const fakePlayer = { role: p.role, pos: p.renderPos };
            drawPlayer(ctx, fakePlayer, color);
        });
    };

    if (visual.line) drawGroup(visual.line, offenseColor);
    if (visual.protectors) drawGroup(visual.protectors, offenseColor);
    if (visual.snapper?.renderPos) {
        drawPlayer(ctx, { role: 'C', pos: visual.snapper.renderPos }, offenseColor);
    }
    if (visual.holder?.renderPos) {
        drawPlayer(ctx, { role: 'QB', pos: visual.holder.renderPos }, offenseColor);
    }
    if (visual.kicker?.renderPos) {
        drawPlayer(ctx, { role: 'K', pos: visual.kicker.renderPos }, offenseColor);
    }
    if (visual.rushers) drawGroup(visual.rushers, defenseColor);

    if (visual.ball?.pos) {
        drawBall(ctx, visual.ball.pos, { flight: { height: visual.ball.height }, shadowPos: visual.ball.shadow });
    }

    if (visual.phase === 'RESULT' && special?.outcome?.success) {
        highlightUprights(ctx, visual.uprights, visual.goalHighlight ?? 1);
    }
}

/* ------------ Field rendering with hashes & numbers ------------ */
function drawField(ctx, state) {
    const homeIdentity = getTeamVisualIdentity(state, TEAM_RED);

    ctx.fillStyle = COLORS.fieldGreen;
    ctx.fillRect(0, 0, FIELD_PIX_W, FIELD_PIX_H);

    // Endzones
    const ezPix = yardsToPixY(ENDZONE_YARDS);
    ctx.fillStyle = '#075e22';
    ctx.fillRect(0, 0, FIELD_PIX_W, ezPix);
    ctx.fillRect(0, FIELD_PIX_H - ezPix, FIELD_PIX_W, ezPix);

    // Main yard lines every 5 yards; heavier every 10
    ctx.lineWidth = 1.2;
    for (let yds = ENDZONE_YARDS; yds <= ENDZONE_YARDS + PLAYING_YARDS_H; yds += 5) {
        const y = yardsToPixY(yds);
        ctx.strokeStyle = COLORS.lineWhite;
        ctx.globalAlpha = (yds % 10 === 0) ? 0.9 : 0.35;
        line(ctx, 0, y, FIELD_PIX_W, y);
    }
    ctx.globalAlpha = 1;

    // NFL hashes: 70'9" from each sideline (≈23.5833 yd)
    const hashLeftYards = 23.5833;
    const hashRightYards = FIELD_YARDS_W - 23.5833; // 53.3 - 23.5833
    const hashLeftX = hashLeftYards * PX_PER_YARD;
    const hashRightX = hashRightYards * PX_PER_YARD;

    ctx.strokeStyle = COLORS.hash;
    ctx.lineWidth = 1;
    for (let yds = ENDZONE_YARDS + 1; yds < ENDZONE_YARDS + PLAYING_YARDS_H; yds += 1) {
        const y = yardsToPixY(yds);
        line(ctx, hashLeftX - 4, y, hashLeftX + 4, y);
        line(ctx, hashRightX - 4, y, hashRightX + 4, y);
    }

    // Sideline tick marks every yard (short)
    const sidelineInset = 6;
    for (let yds = ENDZONE_YARDS + 1; yds < ENDZONE_YARDS + PLAYING_YARDS_H; yds += 1) {
        const y = yardsToPixY(yds);
        line(ctx, sidelineInset, y, sidelineInset + 6, y);
        line(ctx, FIELD_PIX_W - sidelineInset - 6, y, FIELD_PIX_W - sidelineInset, y);
    }

    // Yard numbers (10,20,...,50,...,10) near both sidelines
    ctx.font = '24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textBaseline = 'middle';

    const leftNumX = 24;
    const rightNumX = FIELD_PIX_W - 24;

    const seq = [10, 20, 30, 40, 50, 40, 30, 20, 10];
    const numbersColor = homeIdentity?.color || COLORS.lineWhite;
    const numberOutline = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < seq.length; i++) {
        const ydsFromTopGL = ENDZONE_YARDS + (i + 1) * 10;
        const y = yardsToPixY(ydsFromTopGL);
        drawNumber(ctx, leftNumX, y - 10, seq[i], 'left', numbersColor, numberOutline);
        drawNumber(ctx, rightNumX, y + 10, seq[i], 'right', numbersColor, numberOutline);
    }

    const activeTag = state?.matchup?.tag || state?.lastCompletedGame?.matchup?.tag || null;
    if (activeTag === 'playoff-championship') {
        drawBluperBowlCenterpiece(ctx);
    }

    if (homeIdentity?.shortName) {
        const labelColor = homeIdentity?.color;
        drawEndzoneLabel(ctx, ezPix / 2, homeIdentity.shortName, labelColor, true);
        drawEndzoneLabel(ctx, FIELD_PIX_H - ezPix / 2, homeIdentity.shortName, labelColor, false);
    }

    drawGoalPost(ctx, yardsToPixY(ENDZONE_YARDS), -1);
    drawGoalPost(ctx, yardsToPixY(ENDZONE_YARDS + PLAYING_YARDS_H), 1);
}

function drawNumber(ctx, x, y, num, align, fillColor, strokeColor) {
    const text = String(num);
    ctx.textAlign = align === 'right' ? 'right' : 'left';
    if (strokeColor) {
        ctx.save();
        ctx.lineWidth = 4;
        ctx.strokeStyle = strokeColor;
        ctx.strokeText(text, x, y);
        ctx.restore();
    }
    ctx.fillStyle = fillColor || COLORS.lineWhite;
    ctx.fillText(text, x, y);
}

function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function dashLine(ctx, x1, y1, x2, y2, dash = [6, 4]) { ctx.save(); ctx.setLineDash(dash); line(ctx, x1, y1, x2, y2); ctx.restore(); }

function drawGoalPost(ctx, goalLineY, dir = 1) {
    const centerX = FIELD_PIX_W / 2;
    const crossbarHalf = 38;
    const uprightHeight = 70;
    const offset = 8 * dir;
    const uprightEnd = goalLineY + offset + uprightHeight * dir;

    ctx.save();
    ctx.strokeStyle = '#f8e27d';
    ctx.lineWidth = 3;
    line(ctx, centerX, goalLineY, centerX, goalLineY + offset);
    line(ctx, centerX - crossbarHalf, goalLineY + offset, centerX + crossbarHalf, goalLineY + offset);
    line(ctx, centerX - crossbarHalf, goalLineY + offset, centerX - crossbarHalf, uprightEnd);
    line(ctx, centerX + crossbarHalf, goalLineY + offset, centerX + crossbarHalf, uprightEnd);
    ctx.restore();
}

function highlightUprights(ctx, uprights, intensity = 1) {
    if (!uprights || intensity <= 0) return;
    ctx.save();
    const alpha = 0.85 * intensity;
    ctx.strokeStyle = `rgba(255, 232, 128, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = `rgba(255, 220, 90, ${0.55 * intensity})`;
    ctx.shadowBlur = 18 * intensity;
    ctx.beginPath();
    ctx.moveTo(uprights.centerX - uprights.halfWidth, uprights.crossbarY);
    ctx.lineTo(uprights.centerX + uprights.halfWidth, uprights.crossbarY);
    ctx.stroke();
    ctx.restore();
}

/* ----------------- Entities ----------------- */
function drawPlayer(ctx, p, color, opts = {}) {
    if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) return;

    const r = 8;

    // Player body + shadow (uses the current rotated canvas — no extra transforms needed)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(p.pos.x + 1.5, p.pos.y + 2.5, r + 1, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (opts.qbVision && p.role === 'QB') {
        drawQbVisionIndicator(ctx, p, opts.qbVision, opts.playElapsed);
    }

    // Label: rotate +90° around the player to counter the global -90°,
    // then draw centered *below* the player (in landscape coordinates).
    const label = shortRole(p.role);

    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    ctx.rotate(Math.PI / 2);                 // cancel global rotation for text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '9px ui-sans-serif, system-ui';

    const dy = r + 10;                        // label offset below the circle
    // Stroke for contrast
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(label, 0, dy);
    // Fill
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 0, dy);

    ctx.restore();
}

function drawQbVisionIndicator(ctx, player, vision, playElapsed = null) {
    if (!vision || !player?.pos) return;
    const look = vision.lookAt;
    if (!look || !Number.isFinite(look.x) || !Number.isFinite(look.y)) return;

    const dx = look.x - player.pos.x;
    const dy = look.y - player.pos.y;
    const dist = Math.hypot(dx, dy);
    if (!Number.isFinite(dist) || dist < 2) return;

    const angle = Math.atan2(dy, dx);
    const baseRadius = 10;
    const arrowLength = Math.min(14, Math.max(7, dist * 0.12));
    const tipRadius = baseRadius + arrowLength;
    const color = QB_VISION_COLORS[vision.intent] || QB_VISION_COLORS.SCAN;

    let alpha = vision.intent === 'THROW' ? 0.95 : 0.82;
    if (typeof playElapsed === 'number' && typeof vision.updatedAt === 'number') {
        const age = Math.max(0, playElapsed - vision.updatedAt);
        if (age > 4.5) return;
        const fade = Math.max(0.25, 1 - age / 4.5);
        alpha *= fade;
    }

    ctx.save();
    ctx.translate(player.pos.x, player.pos.y);
    ctx.rotate(angle);

    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, -Math.PI / 2.3, Math.PI / 2.3);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(baseRadius - 3, -3.6);
    ctx.lineTo(baseRadius, -3.6);
    ctx.lineTo(tipRadius, 0);
    ctx.lineTo(baseRadius, 3.6);
    ctx.lineTo(baseRadius - 3, 3.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function shortRole(r) {
    const map = {
        QB: 'QB', RB: 'RB', WR1: 'W1', WR2: 'W2', WR3: 'W3', TE: 'TE',
        LT: 'LT', LG: 'LG', C: 'C', RG: 'RG', RT: 'RT',
        LE: 'LE', DT: 'DT', RTk: 'NT', RE: 'RE',
        LB1: 'LB', LB2: 'LB', CB1: 'C1', CB2: 'C2', S1: 'S1', S2: 'S2', NB: 'NB', K: 'K'
    };
    return map[r] || (r || '?');
}
function drawBall(ctx, pos, ballState) {
    const height = Math.max(0, ballState?.flight?.height ?? 0);
    const shadow = ballState?.shadowPos || pos;

    // Shadow for depth perception
    ctx.save();
    const shadowAlpha = 0.25 + Math.min(height / 120, 0.2);
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(shadow.x + 1.8, shadow.y + 2.6, 6.2, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Actual ball with slight vertical offset based on height
    const offsetY = height * 0.08;
    const radiusMajor = 4.4 + Math.min(2.6, height / 14);
    const radiusMinor = radiusMajor * 0.72;

    ctx.save();
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - offsetY, radiusMajor, radiusMinor, Math.PI / 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f5e6d3';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(pos.x - radiusMajor * 0.6, pos.y - offsetY);
    ctx.lineTo(pos.x + radiusMajor * 0.6, pos.y - offsetY);
    ctx.stroke();
    ctx.restore();
}

function drawEndzoneLabel(ctx, centerY, text, color, rotate180 = false) {
    if (!text) return;
    const upper = String(text).toUpperCase();
    const fontSize = upper.length > 10 ? 28 : 34;
    ctx.save();
    ctx.translate(FIELD_PIX_W / 2, centerY);
    if (rotate180) ctx.rotate(Math.PI);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontSize}px "Arial Narrow", "Oswald", sans-serif`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(upper, 0, 0);
    ctx.fillStyle = color || '#f0f0f0';
    ctx.fillText(upper, 0, 0);
    ctx.restore();
}

function drawBluperBowlCenterpiece(ctx) {
    ctx.save();
    ctx.translate(FIELD_PIX_W / 2, FIELD_PIX_H / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 52px "Arial Black", "Oswald", sans-serif';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeText('BLUPERBOWL', 0, 0);
    ctx.fillStyle = '#d7b957';
    ctx.fillText('BLUPERBOWL', 0, 0);
    ctx.restore();
}

function getTeamVisualIdentity(state, slot) {
    if (!state) return null;
    const matchup = state.matchup || state.lastCompletedGame?.matchup || null;
    const identities = matchup?.identities || {};
    const slotIdentity = identities[slot] || null;
    const slotToTeam = matchup?.slotToTeam || {};
    const teamId = slotToTeam?.[slot];
    const seasonInfo = teamId ? state.season?.teams?.[teamId]?.info : null;
    const info = slotIdentity || seasonInfo || null;
    const displayName = info?.displayName || info?.name || teamId || slot;
    const abbr = info?.abbr || displayName;
    const colors = info?.colors || resolveSlotColors(state, slot, 'offense') || resolveSlotColors(state, slot, 'defense');
    const fallback = slot === TEAM_RED ? COLORS.red : COLORS.black;
    const color = resolveTeamColor(colors, fallback);
    return {
        displayName,
        shortName: (abbr || displayName || '').toString().trim() || null,
        color,
    };
}

