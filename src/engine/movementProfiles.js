import { clamp } from './helpers';

const ROLE_GROUPS = {
    QB: 'BACKFIELD',
    RB: 'BACKFIELD',
    FB: 'BACKFIELD',
    WR1: 'PERIMETER',
    WR2: 'PERIMETER',
    WR3: 'PERIMETER',
    WR4: 'PERIMETER',
    TE: 'HYBRID',
    LT: 'TRENCH',
    LG: 'TRENCH',
    C: 'TRENCH',
    RG: 'TRENCH',
    RT: 'TRENCH',
    LE: 'TRENCH',
    DT: 'TRENCH',
    RTk: 'TRENCH',
    RE: 'TRENCH',
    LB1: 'HYBRID',
    LB2: 'HYBRID',
    LB3: 'HYBRID',
    CB1: 'PERIMETER',
    CB2: 'PERIMETER',
    NB: 'PERIMETER',
    S1: 'PERIMETER',
    S2: 'PERIMETER',
    K: 'SPECIAL',
    P: 'SPECIAL',
};

const PROFILE_TEMPLATES = {
    TRENCH: {
        headingLag: 0.82,
        agilityCurve: 0.14,
        blendMin: 0.6,
        blendMax: 0.92,
        distanceHorizon: 7.6,
        accelRamp: 2.4,
        arrivalBrake: 7.2,
        arrivalCap: 0.56,
        captureRadius: 3.6,
        settleDamping: 8.0,
        rampScale: 0.82,
        agilityBias: 0.78,
        agilityMin: 0.52,
        agilityMax: 1.1,
        speedCeiling: 0.96,
        distanceBlendBase: 0.55,
        distanceBlendGain: 0.45,
    },
    BACKFIELD: {
        headingLag: 0.58,
        agilityCurve: 0.18,
        blendMin: 0.45,
        blendMax: 0.86,
        distanceHorizon: 3.8,
        accelRamp: 1.4,
        arrivalBrake: 3.8,
        arrivalCap: 0.92,
        captureRadius: 1.4,
        settleDamping: 5.4,
        rampScale: 1.02,
        agilityBias: 1.02,
        agilityMin: 0.62,
        agilityMax: 1.3,
        speedCeiling: 1.04,
        distanceBlendBase: 0.45,
        distanceBlendGain: 0.55,
    },
    PERIMETER: {
        headingLag: 0.48,
        agilityCurve: 0.22,
        blendMin: 0.36,
        blendMax: 0.82,
        distanceHorizon: 3.4,
        accelRamp: 1.2,
        arrivalBrake: 3.2,
        arrivalCap: 0.94,
        captureRadius: 1.0,
        settleDamping: 4.8,
        rampScale: 1.1,
        agilityBias: 1.12,
        agilityMin: 0.64,
        agilityMax: 1.38,
        speedCeiling: 1.08,
        distanceBlendBase: 0.44,
        distanceBlendGain: 0.6,
    },
    HYBRID: {
        headingLag: 0.64,
        agilityCurve: 0.17,
        blendMin: 0.48,
        blendMax: 0.88,
        distanceHorizon: 4.2,
        accelRamp: 1.6,
        arrivalBrake: 4.6,
        arrivalCap: 0.82,
        captureRadius: 2.0,
        settleDamping: 6.2,
        rampScale: 0.95,
        agilityBias: 0.96,
        agilityMin: 0.58,
        agilityMax: 1.24,
        speedCeiling: 1.0,
        distanceBlendBase: 0.48,
        distanceBlendGain: 0.52,
    },
    SPECIAL: {
        headingLag: 0.6,
        agilityCurve: 0.16,
        blendMin: 0.5,
        blendMax: 0.88,
        distanceHorizon: 4.0,
        accelRamp: 1.6,
        arrivalBrake: 4.0,
        arrivalCap: 0.82,
        captureRadius: 1.8,
        settleDamping: 6.0,
        rampScale: 0.96,
        agilityBias: 0.94,
        agilityMin: 0.58,
        agilityMax: 1.22,
        speedCeiling: 1.0,
        distanceBlendBase: 0.46,
        distanceBlendGain: 0.54,
    },
    DEFAULT: {
        headingLag: 0.62,
        agilityCurve: 0.18,
        blendMin: 0.48,
        blendMax: 0.88,
        distanceHorizon: 4.2,
        accelRamp: 1.6,
        arrivalBrake: 4.4,
        arrivalCap: 0.82,
        captureRadius: 1.8,
        settleDamping: 6.0,
        rampScale: 0.94,
        agilityBias: 0.98,
        agilityMin: 0.6,
        agilityMax: 1.26,
        speedCeiling: 1.0,
        distanceBlendBase: 0.46,
        distanceBlendGain: 0.54,
    },
};

const BEHAVIOR_OVERRIDES = {
    DEFAULT: {},
    ROUTE: {
        headingLag: 0.42,
        distanceHorizon: 3.0,
        accelRamp: 1.05,
        arrivalBrake: 3.4,
        arrivalCap: 0.98,
        captureRadius: 0.8,
        settleDamping: 5.0,
        rampScale: 1.12,
        speedCeiling: 1.1,
    },
    SCRAMBLE: {
        headingLag: 0.5,
        distanceHorizon: 3.2,
        accelRamp: 1.2,
        arrivalBrake: 3.2,
        arrivalCap: 0.9,
        captureRadius: 1.2,
        settleDamping: 5.2,
        rampScale: 1.0,
        speedCeiling: 1.05,
    },
    BLOCK: {
        headingLag: 0.8,
        distanceHorizon: 8.6,
        accelRamp: 2.6,
        arrivalBrake: 8.4,
        arrivalCap: 0.52,
        captureRadius: 4.2,
        settleDamping: 8.6,
        rampScale: 0.82,
        speedCeiling: 0.94,
    },
    RUNFIT: {
        headingLag: 0.6,
        distanceHorizon: 4.6,
        accelRamp: 1.6,
        arrivalBrake: 4.6,
        arrivalCap: 0.82,
        captureRadius: 2.4,
        settleDamping: 6.4,
        rampScale: 0.92,
        speedCeiling: 1.02,
    },
    PURSUIT: {
        headingLag: 0.5,
        distanceHorizon: 4.4,
        accelRamp: 1.4,
        arrivalBrake: 3.0,
        arrivalCap: 1.06,
        captureRadius: 1.4,
        settleDamping: 5.2,
        rampScale: 1.16,
        speedCeiling: 1.12,
        leadSeconds: 0.18,
    },
    MIRROR: {
        headingLag: 0.52,
        distanceHorizon: 3.4,
        accelRamp: 1.4,
        arrivalBrake: 3.0,
        arrivalCap: 0.9,
        captureRadius: 1.2,
        settleDamping: 5.4,
        rampScale: 1.02,
        speedCeiling: 1.02,
    },
    ZONE: {
        headingLag: 0.62,
        distanceHorizon: 5.2,
        accelRamp: 1.8,
        arrivalBrake: 4.8,
        arrivalCap: 0.78,
        captureRadius: 2.6,
        settleDamping: 6.6,
        rampScale: 0.9,
        speedCeiling: 0.98,
    },
    CARRY: {
        headingLag: 0.52,
        distanceHorizon: 3.6,
        accelRamp: 1.4,
        arrivalBrake: 3.2,
        arrivalCap: 0.96,
        captureRadius: 1.2,
        settleDamping: 5.0,
        rampScale: 1.08,
        speedCeiling: 1.08,
    },
    QB_DROP: {
        headingLag: 0.7,
        distanceHorizon: 4.6,
        accelRamp: 1.8,
        arrivalBrake: 4.2,
        arrivalCap: 0.82,
        captureRadius: 1.4,
        settleDamping: 5.8,
        rampScale: 0.96,
        speedCeiling: 0.98,
    },
};

const BEHAVIOR_KEYS = new Set(Object.keys(BEHAVIOR_OVERRIDES));

function groupFor(player) {
    const role = player?.role || player?.label;
    if (!role) return 'DEFAULT';
    return ROLE_GROUPS[role] || PROFILE_TEMPLATES[role]?.group || 'DEFAULT';
}

function templateFor(player) {
    const key = groupFor(player);
    return PROFILE_TEMPLATES[key] || PROFILE_TEMPLATES.DEFAULT;
}

function mergeParams(base, override = {}, extra = {}) {
    const merged = { ...base, ...override };
    const manual = extra.behaviorOverrides || {};
    Object.keys(manual).forEach((k) => {
        const value = manual[k];
        if (value == null) return;
        merged[k] = value;
    });
    if (typeof extra.speedMultiplier === 'number') {
        merged.speedMultiplier = extra.speedMultiplier;
    }
    merged.headingLag = clamp(merged.headingLag, 0.3, 0.92);
    merged.blendMin = clamp(merged.blendMin ?? 0.4, 0.3, 0.85);
    merged.blendMax = clamp(merged.blendMax ?? 0.9, merged.blendMin + 0.05, 0.95);
    merged.distanceHorizon = clamp(merged.distanceHorizon ?? 4, 1.2, 10);
    merged.accelRamp = clamp(merged.accelRamp ?? 1.6, 0.8, 3.2);
    merged.arrivalBrake = clamp(merged.arrivalBrake ?? 4, 2.0, 10);
    merged.arrivalCap = clamp(merged.arrivalCap ?? 0.9, 0.4, 1.2);
    merged.captureRadius = clamp(merged.captureRadius ?? 1.0, 0.4, 5.0);
    merged.settleDamping = clamp(merged.settleDamping ?? 6.0, 3.0, 10.0);
    merged.rampScale = clamp(merged.rampScale ?? 1.0, 0.7, 1.4);
    merged.agilityBias = clamp(merged.agilityBias ?? 1.0, 0.6, 1.4);
    merged.agilityMin = clamp(merged.agilityMin ?? 0.6, 0.4, 1.0);
    merged.agilityMax = clamp(merged.agilityMax ?? 1.3, merged.agilityMin + 0.2, 1.6);
    merged.speedCeiling = clamp(merged.speedCeiling ?? 1.0, 0.8, 1.25);
    merged.distanceBlendBase = clamp(merged.distanceBlendBase ?? 0.5, 0.2, 0.8);
    merged.distanceBlendGain = clamp(merged.distanceBlendGain ?? 0.5, 0.2, 0.8);
    merged.leadSeconds = clamp(merged.leadSeconds ?? 0, 0, 0.4);
    return merged;
}

export function resolveMovementProfile(player) {
    return { ...templateFor(player) };
}

export function resolveBehaviorTuning(player, behavior = 'DEFAULT', extra = {}) {
    const base = templateFor(player);
    const key = typeof behavior === 'string' && BEHAVIOR_KEYS.has(behavior) ? behavior : 'DEFAULT';
    const override = BEHAVIOR_OVERRIDES[key] || {};
    return mergeParams(base, override, extra);
}

