// One-shot CLI helpers for the resource-aware UI: Promise wrapper around
// MSP.send_cli_command + parsers for the three introspection commands
// the resource analyzer leans on (`resource show`, `timer show`,
// `dma show`).
//
// READ-ONLY. Write operations (`resource X N PIN`, `save`, `reboot`)
// continue to flow through the existing CliEngine / MSPHelper paths so
// `save` / `reboot` mid-MSP-framed-CLI edge cases stay isolated.
//
// Format references in the parsers are taken from a Betaflight 4.6
// session on SPEEDYBEEF405WING; the `resource show` / `timer show` /
// `dma show` text formats have been stable across BF 4.x.

import MSP from "../msp";

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_QUIESCENCE_MS = 250;

/**
 * Run a single CLI command and resolve with `{ lines, raw }`.
 *
 * Quiescence settling: BF 4.5 and earlier emit END_OF_TEXT mid-response
 * for long commands (`resource show` on an 8-motor target gets chunked),
 * which fires `MSP.send_cli_command`'s callback before the full output
 * has arrived. We accumulate across callbacks and resolve once nothing
 * new arrives for `quiescenceMs`. Newer firmware emits a single
 * END_OF_TEXT at the end so this collapses to one callback.
 *
 * @param {string} command CLI command (no trailing newline)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=3000]   hard ceiling
 * @param {number} [opts.quiescenceMs=250] settle window after last chunk
 * @returns {Promise<{lines: string[], raw: string}>}
 */
export function readCli(command, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const quiescenceMs = opts.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;

    return new Promise((resolve, reject) => {
        let settled = false;
        const accumulated = [];
        let quiescenceTimer = null;

        const finish = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(hardTimer);
            if (quiescenceTimer) {
                clearTimeout(quiescenceTimer);
            }
            if (err) {
                reject(err);
                return;
            }
            resolve({
                lines: accumulated.map((l) => l.replace(/\s+$/, "")),
                raw: accumulated.join("\n"),
            });
        };

        const hardTimer = setTimeout(() => {
            finish(new Error(`CLI command "${command}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        MSP.send_cli_command(command, (lines) => {
            if (settled) {
                return;
            }
            if (Array.isArray(lines)) {
                for (const l of lines) {
                    accumulated.push(l);
                }
            }
            if (quiescenceTimer) {
                clearTimeout(quiescenceTimer);
            }
            quiescenceTimer = setTimeout(() => finish(null), quiescenceMs);
        });
    });
}

/**
 * Run multiple CLI commands sequentially. Stops on first failure.
 *
 * @param {string[]} commands
 * @param {object} [opts] forwarded to readCli
 * @returns {Promise<Array<{command: string, lines: string[], raw: string}>>}
 */
export async function readCliBatch(commands, opts = {}) {
    const results = [];
    for (const cmd of commands) {
        const out = await readCli(cmd, opts);
        results.push({ command: cmd, ...out });
    }
    return results;
}

// ─── parsers ──────────────────────────────────────────────────────────

// "FREE", "NAME", or "NAME INDEX" body shared by `resource show` and
// `timer show`. NAME is upper-case letters/underscores: GYRO_CS, SPI_SDI,
// LED_STRIP, USB, MOTOR, SERVO, SERIAL_TX, ADC_BATT, ...
function parsePeripheralBody(body) {
    const trimmed = body.trim();
    if (!trimmed || trimmed === "FREE") {
        return { peripheral: "FREE", index: null };
    }
    const m = /^([A-Z][A-Z0-9_]*)(?:\s+(\d+))?$/.exec(trimmed);
    if (!m) {
        return null;
    }
    return {
        peripheral: m[1],
        index: m[2] ? Number(m[2]) : null,
    };
}

/**
 * Parse `resource show`. Handles both BF output formats:
 *
 *   1. "PAD: NAME INDEX"             e.g. "B07: MOTOR 1"
 *      Classic layout, used on stock BF.
 *
 *   2. "resource NAME INDEX PAD"     e.g. "resource MOTOR 1 B07"
 *      Dump-style, also matches `diff all` / `dump` verbatim.
 *
 * `resource NAME INDEX NONE` is treated as a released binding and
 * filtered out so downstream analysis sees only live claims.
 *
 * @param {string[]|string} input
 * @returns {Array<{pad: string, peripheral: string, index: number|null}>}
 */
export function parseResourceShow(input) {
    const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const m = /^\s*([A-Z]\d{2})\s*:\s*(.+?)\s*$/i.exec(line);
        if (m) {
            const body = parsePeripheralBody(m[2]);
            if (!body) {
                continue;
            }
            out.push({ pad: m[1].toUpperCase(), ...body });
            continue;
        }
        const dm = /^\s*resource\s+([A-Z][A-Z0-9_]*)\s+(\d+)\s+([A-Z]\d{2}|NONE)\s*$/i.exec(line);
        if (dm) {
            const pad = dm[3].toUpperCase();
            if (pad === "NONE") {
                continue;
            }
            out.push({
                pad,
                peripheral: dm[1].toUpperCase(),
                index: Number(dm[2]),
            });
        }
    }
    return out;
}

/**
 * Parse `timer show` — hierarchical TIMn / CHn block format:
 *
 *   TIM4:
 *       CH1 : MOTOR 2
 *       CH2 : MOTOR 1
 *   TIM2: FREE
 *
 * "TIMn: FREE" stands alone (no children). "TIMn:" without a body
 * is followed by indented "CHn[N] : peripheral" lines until the next
 * TIM line or end of input.
 *
 * @param {string[]|string} input
 * @returns {Array<{timer: number, channel: number|null, complementary: boolean,
 *   peripheral: string, index: number|null}>}
 */
export function parseTimerShow(input) {
    const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
    const out = [];
    let currentTimer = null;
    for (const line of lines) {
        const timerHeader = /^\s*TIM(\d+)\s*:\s*(.*?)\s*$/i.exec(line);
        if (timerHeader) {
            currentTimer = Number(timerHeader[1]);
            const body = timerHeader[2];
            if (body.length > 0) {
                const parsed = parsePeripheralBody(body);
                if (parsed) {
                    out.push({ timer: currentTimer, channel: null, complementary: false, ...parsed });
                    currentTimer = null;
                }
            }
            continue;
        }
        const chMatch = /^\s+CH(\d+)(N?)\s*:\s*(.+?)\s*$/i.exec(line);
        if (chMatch && currentTimer !== null) {
            const parsed = parsePeripheralBody(chMatch[3]);
            if (!parsed) {
                continue;
            }
            out.push({
                timer: currentTimer,
                channel: Number(chMatch[1]),
                complementary: chMatch[2].toUpperCase() === "N",
                ...parsed,
            });
        }
    }
    return out;
}

/**
 * Parse the bare `timer` (no args) dump.
 *
 * For every pad with a configured timer, BF prints two lines:
 *
 *   timer B07 AF2
 *   # pin B07: TIM4 CH2 (AF2)
 *
 * For pads with no timer it prints just:
 *
 *   timer A02 NONE
 *   # pin A02: NONE
 *
 * We key on the `# pin` comment lines because they carry the resolved
 * TIM/CH/AF triple. Lets the analyzer enumerate every PWM-capable pad
 * on the board, including ones that are currently FREE (the recommender
 * needs this to surface free-pwm candidates).
 *
 * @param {string[]|string} input
 * @returns {Array<{pad: string, timer: number|null, channel: number|null,
 *   complementary: boolean, af: number|null}>}
 */
export function parseTimerDump(input) {
    const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const m = /^\s*#\s*pin\s+([A-Z]\d{2})\s*:\s*(NONE|TIM(\d+)\s+CH(\d+)(N?)(?:\s*\(AF(\d+)\))?)\s*$/i.exec(line);
        if (!m) {
            continue;
        }
        const pad = m[1].toUpperCase();
        if (m[2].toUpperCase() === "NONE") {
            out.push({ pad, timer: null, channel: null, complementary: false, af: null });
            continue;
        }
        out.push({
            pad,
            timer: Number(m[3]),
            channel: Number(m[4]),
            complementary: m[5].toUpperCase() === "N",
            af: m[6] ? Number(m[6]) : null,
        });
    }
    return out;
}

/**
 * Parse `dma show` — flat lines describing per-channel allocations.
 *
 * Two row shapes seen in BF 4.x:
 *
 *   "DMA1 Stream 4: MOTOR 1"
 *   "DMA2 Stream 6: USART6_TX"
 *   "DMA1 Stream 0: FREE"
 *
 *   "DMA2 Stream 6 Channel 5: USART6_TX"  (newer/H7 variants)
 *
 * @param {string[]|string} input
 * @returns {Array<{controller: number, stream: number, channel: number|null,
 *   peripheral: string, index: number|null}>}
 */
export function parseDmaShow(input) {
    const lines = Array.isArray(input) ? input : input.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const m = /^\s*DMA(\d)\s+Stream\s+(\d)(?:\s+Channel\s+(\d+))?\s*:\s*(.+?)\s*$/i.exec(line);
        if (!m) {
            continue;
        }
        const peripheralStr = m[4].trim();
        let peripheral;
        let index = null;
        if (peripheralStr === "FREE") {
            peripheral = "FREE";
        } else {
            // Peripheral can be "MOTOR 1", "USART6_TX", "TIMUP 4", "LED_STRIP", ...
            const pm = /^([A-Z][A-Z0-9_]*)(?:\s+(\d+))?$/.exec(peripheralStr);
            if (!pm) {
                continue;
            }
            peripheral = pm[1];
            index = pm[2] ? Number(pm[2]) : null;
        }
        out.push({
            controller: Number(m[1]),
            stream: Number(m[2]),
            channel: m[3] ? Number(m[3]) : null,
            peripheral,
            index,
        });
    }
    return out;
}
