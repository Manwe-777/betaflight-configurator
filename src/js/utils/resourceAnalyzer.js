// Pure analyzer for the Servos-tab Resource Assignments UI.
//
// Joins three data sources:
//
//   1. MSP2_MOTOR_SERVO_RESOURCE  -> current motor/servo bindings + per-
//      resource {timer, channel, dmaController, dmaStream}. Authoritative
//      when the firmware speaks the extended payload.
//
//   2. parseResourceShow output   -> live `resource show` snapshot, used
//      to discover which pads are FREE / SERIAL_TX / LED_STRIP / etc.
//      and to surface hardware-fixed pads (USB, SPI_*, I2C_*, ...) that
//      MUST NOT be offered as remap candidates.
//
//   3. parseTimerShow + parseDmaShow -> per-pad timer + DMA topology so
//      pads not currently bound to a motor/servo (`pwmCapableFreePads`)
//      can still be ranked with their TIM/CH info in the dropdown.
//
// All sources are optional. With only #1 the analyzer still returns a
// usable view (motors/servos with timer info from the extended MSP, no
// freePadsCount, empty warnings); with all three it can answer every
// question the recommender needs to produce a colour-coded dropdown.
//
// Output is a frozen-shape report consumed by `resourceRecommender.js`.

// Pads whose role is physical / board-wired and must NEVER be auto-
// remapped. Anything else is fair game for the recommender.
const HARDWARE_FIXED_PERIPHERALS = new Set([
    "USB",
    "SPI_SCK",
    "SPI_SDI",
    "SPI_SDO",
    "I2C_SCL",
    "I2C_SDA",
    "ADC_BATT",
    "ADC_CURR",
    "ADC_RSSI",
    "SDCARD_CS",
    "GYRO_CS",
    "OSD_CS",
    "BEEPER",
    "LED",
    "PINIO",
    "PREINIT",
    "CAMERA_CONTROL",
]);

function periphIndexKey(peripheral, index) {
    return `${peripheral}:${index ?? ""}`;
}

function buildTimerLookup(timerShow) {
    const m = new Map();
    for (const e of timerShow ?? []) {
        if (e.channel === null || e.peripheral === "FREE") {
            continue;
        }
        m.set(periphIndexKey(e.peripheral, e.index), {
            timer: e.timer,
            channel: e.channel,
            complementary: !!e.complementary,
        });
    }
    return m;
}

function buildDmaLookup(dmaShow) {
    const m = new Map();
    for (const e of dmaShow ?? []) {
        if (e.peripheral === "FREE" || e.peripheral === "TIMUP") {
            continue;
        }
        m.set(periphIndexKey(e.peripheral, e.index), {
            controller: e.controller,
            stream: e.stream,
        });
    }
    return m;
}

function deriveWarnings({ motors, servos, freeDmaStreams }) {
    const warnings = [];

    for (const m of motors) {
        if (m.dmaController == null && m.timer != null) {
            warnings.push({
                severity: "warn",
                code: "motor_no_dma",
                resource: { type: "motor", index: m.index },
                message:
                    `MOTOR ${m.index + 1} on ${m.pad} has no DMA stream — ` + `bidir DSHOT may fall back to bit-bang.`,
            });
        }
    }

    const motorTimers = new Set(motors.map((m) => m.timer).filter((t) => t != null));
    for (const s of servos) {
        if (s.timer != null && motorTimers.has(s.timer)) {
            warnings.push({
                severity: "error",
                code: "servo_on_motor_timer",
                resource: { type: "servo", index: s.index },
                message:
                    `SERVO ${s.index + 1} on ${s.pad} shares TIM${s.timer} with a motor — ` +
                    `servo PWM frequency will fight DSHOT timing.`,
            });
        }
    }

    if (freeDmaStreams != null && freeDmaStreams.length < 3) {
        warnings.push({
            severity: "info",
            code: "dma_tight",
            message:
                `Only ${freeDmaStreams.length} free DMA stream` +
                `${freeDmaStreams.length === 1 ? "" : "s"} remaining — ` +
                `future peripherals may fail to allocate.`,
        });
    }

    return warnings;
}

/**
 * Produce an analysis record from the three data sources.
 *
 * @param {object} input
 * @param {Array<{index: number, ioTag: number, pin: string, timer: number|null,
 *   channel: number|null, complementary: boolean, dmaController: number|null,
 *   dmaStream: number|null}>} [input.motorResources] from FC.MOTOR_RESOURCES
 * @param {Array<...same shape...>} [input.servoResources] from FC.SERVO_RESOURCES
 * @param {Array} [input.resourceShow] parsed `resource show` (see cliOneShot.parseResourceShow)
 * @param {Array} [input.timerShow]    parsed `timer show`
 * @param {Array} [input.dmaShow]      parsed `dma show`
 * @param {Array} [input.timerDump]    parsed bare `timer` dump (every
 *   pad's TIM/CH/AF). When present, FREE pads from `resource show` get
 *   surfaced as PWM-capable candidates by joining on pad name.
 *
 * @returns {{
 *   motors: Array<{index, pad, ioTag, timer, channel, complementary, dmaController, dmaStream}>,
 *   servos: Array<...same shape...>,
 *   ledStrips: Array<{pad, timer, channel, dmaController, dmaStream}>,
 *   serials:   Array<{index, txPad, rxPad}>,
 *   hardwareFixedPads: Array<{pad, peripheral, index}>,
 *   freePads: Set<string>,
 *   freePadsCount: number,
 *   pwmCapableFreePads: Array<{pad, timer, channel, complementary}>,
 *   freeDmaStreams: Array<{controller, stream}>,
 *   padTimers: Map<string, {timer, channel, complementary}>,
 *   warnings: Array<{severity, code, message, resource?: {type, index}}>,
 *   hasCliTopology: boolean
 * }}
 */
export function analyzeResources({
    motorResources = [],
    servoResources = [],
    resourceShow = [],
    timerShow = [],
    dmaShow = [],
    timerDump = [],
} = {}) {
    const hasCliTopology =
        resourceShow.length > 0 || timerShow.length > 0 || dmaShow.length > 0 || timerDump.length > 0;

    const motors = motorResources
        .filter((r) => r.ioTag && r.pin && r.pin !== "NONE")
        .map((r) => ({
            index: r.index,
            pad: r.pin,
            ioTag: r.ioTag,
            timer: r.timer ?? null,
            channel: r.channel ?? null,
            complementary: !!r.complementary,
            dmaController: r.dmaController ?? null,
            dmaStream: r.dmaStream ?? null,
        }));

    const servos = servoResources
        .filter((r) => r.ioTag && r.pin && r.pin !== "NONE")
        .map((r) => ({
            index: r.index,
            pad: r.pin,
            ioTag: r.ioTag,
            timer: r.timer ?? null,
            channel: r.channel ?? null,
            complementary: !!r.complementary,
            dmaController: r.dmaController ?? null,
            dmaStream: r.dmaStream ?? null,
        }));

    motors.sort((a, b) => a.index - b.index);
    servos.sort((a, b) => a.index - b.index);

    const padTimers = new Map();
    const timerByKey = buildTimerLookup(timerShow);
    const dmaByKey = buildDmaLookup(dmaShow);
    const ledStrips = [];
    const hardwareFixedPads = [];
    const serialTx = new Map();
    const serialRx = new Map();
    const freePads = new Set();

    for (const entry of resourceShow) {
        const p = entry.peripheral;
        if (p === "FREE") {
            freePads.add(entry.pad);
            continue;
        }
        const timerHit = timerByKey.get(periphIndexKey(p, entry.index)) || null;
        if (timerHit) {
            padTimers.set(entry.pad, {
                timer: timerHit.timer,
                channel: timerHit.channel,
                complementary: timerHit.complementary,
            });
        }
        const dmaHit = dmaByKey.get(periphIndexKey(p, entry.index)) || null;
        if (p === "LED_STRIP") {
            ledStrips.push({
                pad: entry.pad,
                timer: timerHit?.timer ?? null,
                channel: timerHit?.channel ?? null,
                dmaController: dmaHit?.controller ?? null,
                dmaStream: dmaHit?.stream ?? null,
            });
        } else if (p === "SERIAL_TX") {
            if (entry.index !== null) {
                serialTx.set(entry.index, entry.pad);
            }
        } else if (p === "SERIAL_RX") {
            if (entry.index !== null) {
                serialRx.set(entry.index, entry.pad);
            }
        } else if (HARDWARE_FIXED_PERIPHERALS.has(p)) {
            hardwareFixedPads.push({ pad: entry.pad, peripheral: p, index: entry.index });
        }
    }

    // Seed padTimers from the bare `timer` dump (when supplied) — this
    // is the authoritative pad → (TIM, CH) map and includes pads that
    // are currently FREE in `resource show`. Without this, free PWM
    // pads can't surface as recommender candidates.
    for (const t of timerDump) {
        if (t.timer != null && t.channel != null) {
            padTimers.set(t.pad, {
                timer: t.timer,
                channel: t.channel,
                complementary: !!t.complementary,
            });
        }
    }

    // PWM-capable currently-free pads — every FREE pad from resource
    // show that has timer info (either via timerDump above or backfilled
    // from MOTOR/SERVO claims with the same pad).
    const pwmCapableFreePads = [];
    for (const pad of freePads) {
        const t = padTimers.get(pad);
        if (t) {
            pwmCapableFreePads.push({
                pad,
                timer: t.timer,
                channel: t.channel,
                complementary: t.complementary,
            });
        }
    }

    const serialIndices = new Set([...serialTx.keys(), ...serialRx.keys()]);
    const serials = Array.from(serialIndices)
        .map((index) => ({
            index,
            txPad: serialTx.get(index) ?? null,
            rxPad: serialRx.get(index) ?? null,
        }))
        .sort((a, b) => a.index - b.index);

    const freeDmaStreams = (dmaShow ?? [])
        .filter((e) => e.peripheral === "FREE")
        .map((e) => ({ controller: e.controller, stream: e.stream }));

    const warnings = deriveWarnings({
        motors,
        servos,
        freeDmaStreams: hasCliTopology ? freeDmaStreams : null,
    });

    return {
        motors,
        servos,
        ledStrips,
        serials,
        hardwareFixedPads,
        freePads,
        freePadsCount: freePads.size,
        pwmCapableFreePads,
        freeDmaStreams,
        padTimers,
        warnings,
        hasCliTopology,
    };
}

export const _internal = { HARDWARE_FIXED_PERIPHERALS };
