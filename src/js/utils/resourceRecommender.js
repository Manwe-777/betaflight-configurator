// Per-slot pad ranking for the Servos-tab Resource Assignments
// dropdowns. Pure function that turns an analyzer result into a list of
// candidate pads with a `source` annotation the UI uses to colour-code
// the option.
//
// Ranking order — kept intuitive for users who think in silkscreen
// labels ("M2", "S1") rather than ioTags:
//
//   1. existing       — current pad if it's still safe (zero-churn)
//   2. motor-release  — pad currently bound to a MOTOR; rebinding here
//                       releases that motor. `requiresRelease` carries
//                       the `resource MOTOR N NONE` line.
//   3. servo-release  — pad currently bound to another SERVO; rebinding
//                       releases that servo (`resource SERVO N NONE`).
//   4. free-pwm       — currently FREE pad that has a PWM-capable timer
//   5. free-conflict  — same as free-pwm but its timer is shared with an
//                       in-use motor (still selectable, flagged)
//   6. led-strip      — LED_STRIP pad (only when `allowLedStrip`)
//   7. uart-release   — UART TX/RX pad (only when `allowUartRelease`)
//
// When the slot is currently NONE the analyzer drops that motor/servo
// from its tables, so the pad that used to occupy it can vanish from
// ranked swaps. Callers pass `rememberedPad` / `sessionBaselinePad` to
// bump those pads near the top with an explicit label ("last used on
// this motor" / "when this tab loaded") — matching Bskimp's panel-
// default UX without requiring shipped board JSON.
//
// Hardware-fixed pads (USB, SPI, I2C, ...) are always blocked. Other
// motor/servo pads are NEVER auto-blocked — they show up as release
// candidates with a clear "currently MOTOR/SERVO X (will be released)"
// label, so the pilot can make an informed swap. Pass
// `motorIndicesInUse` to flag motor candidates that are mixer-driving
// real outputs (rendered with a stronger warning chip in the UI).

const SOURCE_RANK = {
    existing: 0,
    remembered: 0.5,
    "session-baseline": 0.52,
    "motor-release": 1,
    "servo-release": 2,
    "free-pwm": 3,
    "free-conflict": 4,
    "led-strip": 5,
    "uart-release": 6,
};

function inUseMotorTimers(motors, motorIndicesInUse) {
    const timers = new Set();
    for (const m of motors) {
        if (motorIndicesInUse.has(m.index) && m.timer != null) {
            timers.add(m.timer);
        }
    }
    return timers;
}

// Hard-claim only the things the user CAN'T legally rebind: hardware-
// fixed pads (USB, SPI, I2C, ...) and LED_STRIP/UART pads they haven't
// opted in to release. Other motor/servo pads aren't claimed here; they
// surface as release candidates instead.
function findPadOccupant(analysis, pad) {
    for (const m of analysis.motors ?? []) {
        if (m.pad === pad) {
            return { kind: "motor", index: m.index, record: m };
        }
    }
    for (const s of analysis.servos ?? []) {
        if (s.pad === pad) {
            return { kind: "servo", index: s.index, record: s };
        }
    }
    const fps = analysis.freePads;
    if (fps instanceof Set && fps.has(pad)) {
        return { kind: "free" };
    }
    const pwmFree = (analysis.pwmCapableFreePads ?? []).some((p) => p.pad === pad);
    if (pwmFree) {
        return { kind: "free" };
    }
    return { kind: "unknown" };
}

function buildRememberedEntry({
    analysis,
    pad,
    target,
    memoryNote,
    padTimers,
    motorTimers,
    motorIndicesInUse,
    claimed,
    lookupTimer,
}) {
    if (!pad || claimed.has(pad)) {
        return null;
    }
    const occ = findPadOccupant(analysis, pad);
    const fb = lookupTimer(pad) ?? {};
    const share = fb.timer != null && motorTimers.has(fb.timer);

    if (occ.kind === "free" || occ.kind === "unknown") {
        return {
            pad,
            timer: fb.timer ?? null,
            channel: fb.channel ?? null,
            complementary: !!fb.complementary,
            dmaController: null,
            dmaStream: null,
            source: memoryNote,
            memoryNote,
            requiresRelease: [],
            sharesTimerWithMotor: share,
        };
    }
    if (occ.kind === "motor") {
        const m = occ.record;
        return {
            pad: m.pad,
            timer: m.timer ?? fb.timer ?? null,
            channel: m.channel ?? fb.channel ?? null,
            complementary: !!m.complementary,
            dmaController: m.dmaController ?? null,
            dmaStream: m.dmaStream ?? null,
            source: memoryNote,
            memoryNote,
            motorIndex: m.index,
            requiresRelease: [`resource MOTOR ${m.index + 1} NONE`],
            sharesTimerWithMotor: m.timer != null && motorTimers.has(m.timer),
        };
    }
    const s = occ.record;
    return {
        pad: s.pad,
        timer: s.timer ?? fb.timer ?? null,
        channel: s.channel ?? fb.channel ?? null,
        complementary: !!s.complementary,
        dmaController: s.dmaController ?? null,
        dmaStream: s.dmaStream ?? null,
        source: memoryNote,
        memoryNote,
        servoIndex: s.index,
        requiresRelease: [`resource SERVO ${s.index + 1} NONE`],
        sharesTimerWithMotor: s.timer != null && motorTimers.has(s.timer),
    };
}

function buildClaimedPadSet(analysis, options) {
    const allowLedStrip = options.allowLedStrip === true;
    const allowUartRelease = Array.isArray(options.allowUartRelease) ? options.allowUartRelease : [];

    const claimed = new Set();
    for (const f of analysis.hardwareFixedPads ?? []) {
        claimed.add(f.pad);
    }
    if (!allowLedStrip) {
        for (const ls of analysis.ledStrips ?? []) {
            claimed.add(ls.pad);
        }
    }
    for (const srl of analysis.serials ?? []) {
        if (allowUartRelease.includes(srl.index)) {
            continue;
        }
        if (srl.txPad) {
            claimed.add(srl.txPad);
        }
        if (srl.rxPad) {
            claimed.add(srl.rxPad);
        }
    }
    return claimed;
}

function applySlotMemoryBoost(results, memoryOpts, annotate, ctx) {
    const { currentPad, rememberedPad, sessionBaselinePad } = memoryOpts;
    const { analysis, claimed, lookupTimer, motorTimers, motorIndicesInUse, padTimers } = ctx;
    const busy = currentPad && currentPad !== "NONE";

    const boost = [];
    if (!busy && rememberedPad && rememberedPad !== "NONE") {
        boost.push({ pad: rememberedPad, memoryNote: "remembered" });
    }
    if (!busy && sessionBaselinePad && sessionBaselinePad !== "NONE" && sessionBaselinePad !== rememberedPad) {
        boost.push({ pad: sessionBaselinePad, memoryNote: "session-baseline" });
    }

    for (const { pad, memoryNote } of boost) {
        const idx = results.findIndex((c) => c.pad === pad);
        if (idx >= 0) {
            const prev = results[idx];
            results[idx] = annotate({
                ...prev,
                source: memoryNote,
                memoryNote,
            });
        } else {
            const entry = buildRememberedEntry({
                analysis,
                pad,
                memoryNote,
                padTimers,
                motorTimers,
                motorIndicesInUse,
                claimed,
                lookupTimer,
            });
            if (entry) {
                results.push(annotate(entry));
            }
        }
    }

    results.sort((a, b) => a.sourceRank - b.sourceRank || String(a.pad).localeCompare(String(b.pad)));
    return results;
}

/**
 * Rank candidate pads for a single MOTOR or SERVO slot.
 *
 * @param {object} analysis output of `analyzeResources`
 * @param {object} target
 * @param {"motor"|"servo"} target.resourceType
 * @param {number} target.index 0-based slot index inside its resource type
 * @param {object} [options]
 * @param {string|null} [options.currentPad] pad this slot is currently
 *   bound to. Gets a zero-churn bias.
 * @param {number[]} [options.motorIndicesInUse=[]] motor indices that
 *   are mixer-driving real outputs. Pads belonging to these motors are
 *   still listed (so the user CAN consciously break a motor) but flagged
 *   with a `motor-in-use` conflict for stronger UI warning. Defaults to
 *   `[]` because the configurator doesn't know the mixer's required
 *   motor count without extra plumbing — let the user decide.
 * @param {boolean} [options.allowLedStrip=false] permit LED_STRIP pad as
 *   a candidate (caller releases LED_STRIP after binding).
 * @param {number[]} [options.allowUartRelease=[]] UART indices whose
 *   TX/RX pads are eligible (caller releases the UART after binding).
 * @param {string|null} [options.rememberedPad] last non-NONE pad for
 *   this slot (session + Configurator localStorage); boosted when the
 *   slot is currently NONE so the pilot can restore without the CLI.
 * @param {string|null} [options.sessionBaselinePad] pin map captured at
 *   first FC read this connect (also persisted per-board).
 *
 * @returns {Array<{pad: string, label: string, timer: number|null,
 *   channel: number|null, complementary: boolean,
 *   dmaController: number|null, dmaStream: number|null, source: string,
 *   sourceRank: number, requiresRelease: string[],
 *   sharesTimerWithMotor: boolean, conflicts: string[]}>}
 */
export function candidatePadsForSlot(analysis, target, options = {}) {
    if (!analysis || !target || (target.resourceType !== "motor" && target.resourceType !== "servo")) {
        return [];
    }

    const motorIndicesInUse = new Set(Array.isArray(options.motorIndicesInUse) ? options.motorIndicesInUse : []);
    const currentPad = options.currentPad ?? null;
    const rememberedPad = options.rememberedPad ?? null;
    const sessionBaselinePad = options.sessionBaselinePad ?? null;
    const allowLedStrip = options.allowLedStrip === true;
    const allowUartRelease = Array.isArray(options.allowUartRelease) ? options.allowUartRelease : [];

    const claimed = buildClaimedPadSet(analysis, options);
    const motorTimers = inUseMotorTimers(analysis.motors ?? [], motorIndicesInUse);
    const padTimers = analysis.padTimers instanceof Map ? analysis.padTimers : new Map();

    const seen = new Set();
    const results = [];

    const lookupTimer = (pad) => padTimers.get(pad) ?? null;
    const annotate = (entry) => {
        const conflicts = [];
        if (entry.sharesTimerWithMotor) {
            conflicts.push("timer-shared-with-motor");
        }
        if (target.resourceType === "motor" && entry.dmaController == null && entry.timer != null) {
            conflicts.push("no-dma-stream");
        }
        if (entry.motorIndex != null && motorIndicesInUse.has(entry.motorIndex)) {
            conflicts.push("motor-in-use");
        }
        return {
            ...entry,
            sourceRank: SOURCE_RANK[entry.source] ?? 99,
            conflicts,
            slotResourceType: target.resourceType,
        };
    };
    const push = (entry) => {
        if (seen.has(entry.pad)) {
            return;
        }
        seen.add(entry.pad);
        results.push(annotate(entry));
    };

    // 1) Existing binding — zero-churn.
    if (currentPad && !claimed.has(currentPad)) {
        const own =
            target.resourceType === "motor"
                ? (analysis.motors ?? []).find((m) => m.index === target.index)
                : (analysis.servos ?? []).find((s) => s.index === target.index);
        const fallback = lookupTimer(currentPad);
        push({
            pad: currentPad,
            timer: own?.timer ?? fallback?.timer ?? null,
            channel: own?.channel ?? fallback?.channel ?? null,
            complementary: own?.complementary ?? fallback?.complementary ?? false,
            dmaController: own?.dmaController ?? null,
            dmaStream: own?.dmaStream ?? null,
            source: "existing",
            requiresRelease: [],
            sharesTimerWithMotor: own?.timer != null && motorTimers.has(own.timer),
        });
    }

    // 2) Motor-release candidates — every other bound motor pad. Skip
    //    the slot we're editing (its current binding is already in
    //    "existing" above, or NONE). Silkscreen-friendly motor-index
    //    ordering inherited from analyzer's sort.
    for (const m of analysis.motors ?? []) {
        if (target.resourceType === "motor" && m.index === target.index) {
            continue;
        }
        if (claimed.has(m.pad)) {
            continue;
        }
        const fallback = lookupTimer(m.pad);
        push({
            pad: m.pad,
            timer: m.timer ?? fallback?.timer ?? null,
            channel: m.channel ?? fallback?.channel ?? null,
            complementary: m.complementary,
            dmaController: m.dmaController,
            dmaStream: m.dmaStream,
            source: "motor-release",
            motorIndex: m.index,
            requiresRelease: [`resource MOTOR ${m.index + 1} NONE`],
            sharesTimerWithMotor: m.timer != null && motorTimers.has(m.timer),
        });
    }

    // 2.5) Servo-release candidates — every other bound servo pad. Same
    //      pattern as motor-release: pad becomes a swap candidate with a
    //      `requiresRelease` line so the caller knows what to free up.
    for (const s of analysis.servos ?? []) {
        if (target.resourceType === "servo" && s.index === target.index) {
            continue;
        }
        if (claimed.has(s.pad)) {
            continue;
        }
        const fallback = lookupTimer(s.pad);
        push({
            pad: s.pad,
            timer: s.timer ?? fallback?.timer ?? null,
            channel: s.channel ?? fallback?.channel ?? null,
            complementary: s.complementary,
            dmaController: s.dmaController,
            dmaStream: s.dmaStream,
            source: "servo-release",
            servoIndex: s.index,
            requiresRelease: [`resource SERVO ${s.index + 1} NONE`],
            sharesTimerWithMotor: s.timer != null && motorTimers.has(s.timer),
        });
    }

    // 3 + 4) Free PWM-capable pads, partitioned by motor-timer conflict.
    const freePwm = Array.isArray(analysis.pwmCapableFreePads) ? analysis.pwmCapableFreePads : [];
    const freeNonConflict = [];
    const freeConflict = [];
    for (const p of freePwm) {
        if (claimed.has(p.pad)) {
            continue;
        }
        if (p.timer != null && motorTimers.has(p.timer)) {
            freeConflict.push(p);
        } else {
            freeNonConflict.push(p);
        }
    }
    for (const p of freeNonConflict) {
        push({
            pad: p.pad,
            timer: p.timer ?? null,
            channel: p.channel ?? null,
            complementary: !!p.complementary,
            dmaController: null,
            dmaStream: null,
            source: "free-pwm",
            requiresRelease: [],
            sharesTimerWithMotor: false,
        });
    }
    for (const p of freeConflict) {
        push({
            pad: p.pad,
            timer: p.timer ?? null,
            channel: p.channel ?? null,
            complementary: !!p.complementary,
            dmaController: null,
            dmaStream: null,
            source: "free-conflict",
            requiresRelease: [],
            sharesTimerWithMotor: true,
        });
    }

    // 5) LED_STRIP pad (opt-in).
    if (allowLedStrip) {
        for (const ls of analysis.ledStrips ?? []) {
            if (claimed.has(ls.pad)) {
                continue;
            }
            const fallback = lookupTimer(ls.pad);
            push({
                pad: ls.pad,
                timer: ls.timer ?? fallback?.timer ?? null,
                channel: ls.channel ?? fallback?.channel ?? null,
                complementary: false,
                dmaController: ls.dmaController ?? null,
                dmaStream: ls.dmaStream ?? null,
                source: "led-strip",
                requiresRelease: ["resource LED_STRIP 1 NONE"],
                sharesTimerWithMotor: ls.timer != null && motorTimers.has(ls.timer),
            });
        }
    }

    // 6) UART TX/RX pads (opt-in per UART).
    for (const uartIndex of allowUartRelease) {
        const spare = (analysis.serials ?? []).find((u) => u.index === uartIndex);
        if (!spare) {
            continue;
        }
        if (spare.txPad && !claimed.has(spare.txPad)) {
            const fallback = lookupTimer(spare.txPad);
            push({
                pad: spare.txPad,
                timer: fallback?.timer ?? null,
                channel: fallback?.channel ?? null,
                complementary: false,
                dmaController: null,
                dmaStream: null,
                source: "uart-release",
                requiresRelease: [`resource SERIAL_TX ${uartIndex} NONE`],
                sharesTimerWithMotor: false,
            });
        }
        if (spare.rxPad && !claimed.has(spare.rxPad)) {
            const fallback = lookupTimer(spare.rxPad);
            push({
                pad: spare.rxPad,
                timer: fallback?.timer ?? null,
                channel: fallback?.channel ?? null,
                complementary: false,
                dmaController: null,
                dmaStream: null,
                source: "uart-release",
                requiresRelease: [`resource SERIAL_RX ${uartIndex} NONE`],
                sharesTimerWithMotor: false,
            });
        }
    }

    return applySlotMemoryBoost(results, { currentPad, rememberedPad, sessionBaselinePad }, annotate, {
        analysis,
        claimed,
        lookupTimer,
        motorTimers,
        motorIndicesInUse,
        padTimers,
    });
}

/**
 * Build a UI-friendly label for a candidate entry.
 *
 * Format: "{pad} — TIM{n} CH{ch}[N] [— {context}]"
 * where {context} is e.g. "currently MOTOR 1 (will be released)" or
 * "shares TIM3 with MOTOR 2".
 *
 * @param {object} candidate output of candidatePadsForSlot()[i]
 * @returns {string}
 */
export function describeCandidate(candidate) {
    const parts = [candidate.pad];
    if (candidate.timer != null && candidate.channel != null) {
        const ch = `CH${candidate.channel}${candidate.complementary ? "N" : ""}`;
        parts.push(`TIM${candidate.timer} ${ch}`);
    }
    let context = null;
    switch (candidate.source) {
        case "existing":
            break;
        case "motor-release": {
            const which = candidate.requiresRelease[0]?.match(/MOTOR\s+(\d+)/);
            const inUse = candidate.conflicts?.includes("motor-in-use");
            context = inUse
                ? `currently MOTOR ${which?.[1] ?? "?"} (in use — will break the motor)`
                : `currently MOTOR ${which?.[1] ?? "?"} (will be released)`;
            break;
        }
        case "servo-release": {
            const which = candidate.requiresRelease[0]?.match(/SERVO\s+(\d+)/);
            context = `currently SERVO ${which?.[1] ?? "?"} (will be released)`;
            break;
        }
        case "free-pwm":
            context = "free";
            break;
        case "free-conflict":
            context = "free, shares timer with motor";
            break;
        case "led-strip":
            context = "currently LED_STRIP (will be released)";
            break;
        case "uart-release": {
            const m = candidate.requiresRelease[0]?.match(/SERIAL_(TX|RX)\s+(\d+)/);
            context = `currently UART${m?.[2] ?? "?"} ${m?.[1] ?? ""} (will be released)`;
            break;
        }
        case "remembered":
            context = "last non-NONE pin for this slot (Configurator memory)";
            break;
        case "session-baseline":
            context = "baseline map when this board was first read in Configurator";
            break;
        default:
            break;
    }
    if (candidate.memoryNote === "remembered" && candidate.source !== "remembered") {
        const slot = candidate.slotResourceType === "servo" ? "SERVO" : "MOTOR";
        const extra = context ? ` — ${context}` : "";
        context = `Last ${slot} pin (saved in Configurator)${extra}`;
    } else if (candidate.memoryNote === "session-baseline" && candidate.source !== "session-baseline") {
        const extra = context ? ` — ${context}` : "";
        context = `Captured baseline${extra}`;
    }
    if (context) {
        parts.push(context);
    }
    if (candidate.dmaController == null && candidate.timer != null) {
        parts.push("no DMA");
    }
    return parts.join(" — ");
}
