// Persist per-board motor/servo pin hints in ConfigStorage (localStorage)
// so released slots can be restored after closing the Configurator — a
// practical substitute until the app ships target-specific default maps
// (see Bskimp's PR #4881 discussion).
//
// Not firmware truth: hints are merged with live MSP/CLI in the UI. FC
// pins when a slot is NONE are not written into `last*` maps; old values
// are retained so the dropdown can still offer "restore".

import FC from "../fc.js";
import { get, set } from "../ConfigStorage.js";

const STORAGE_KEY = "resourceAssignmentHints";

function readBag() {
    const block = get(STORAGE_KEY);
    const data = block[STORAGE_KEY];
    return data && typeof data === "object" ? data : {};
}

/**
 * Stable key for the connected board (best-effort; UID avoids most clones).
 *
 * @returns {string}
 */
export function resourceHintsBoardKey() {
    const c = FC.CONFIG || {};
    const uid = Array.isArray(c.uid) ? c.uid.join("-") : "";
    return [c.manufacturerId || "na", c.boardName || c.targetName || "board", c.boardIdentifier || "", uid || "nouid"]
        .join("|")
        .replace(/\s+/g, "_");
}

/**
 * @param {string} boardKey
 * @returns {{ motor: Record<string,string>, servo: Record<string,string>, motorBaseline: Record<string,string>, servoBaseline: Record<string,string>, updatedAt?: number }}
 */
export function readResourceHints(boardKey) {
    const bag = readBag();
    const row = bag[boardKey];
    if (!row || typeof row !== "object") {
        return { motor: {}, servo: {}, motorBaseline: {}, servoBaseline: {} };
    }
    return {
        motor: { ...(row.motor || {}) },
        servo: { ...(row.servo || {}) },
        motorBaseline: { ...(row.motorBaseline || {}) },
        servoBaseline: { ...(row.servoBaseline || {}) },
        updatedAt: row.updatedAt,
    };
}

/**
 * @param {string} boardKey
 * @param {object} patch
 * @param {Record<string,string>} [patch.motor]
 * @param {Record<string,string>} [patch.servo]
 * @param {Record<string,string>} [patch.motorBaseline]
 * @param {Record<string,string>} [patch.servoBaseline]
 */
export function writeResourceHints(boardKey, patch) {
    const bag = { ...readBag() };
    const prev = readResourceHints(boardKey);
    bag[boardKey] = {
        ...prev,
        ...patch,
        updatedAt: Date.now(),
    };
    set({ [STORAGE_KEY]: bag });
}

/**
 * @param {string} boardKey
 * @param {{ pin: string, index: number }[]} motors
 * @param {{ pin: string, index: number }[]} servos
 */
export function persistResourceSlotHints(boardKey, motors, servos) {
    const prev = readResourceHints(boardKey);
    const motor = { ...prev.motor };
    const servo = { ...prev.servo };

    for (const m of motors) {
        if (m.pin && m.pin !== "NONE") {
            motor[String(m.index)] = m.pin;
        }
    }
    for (const s of servos) {
        if (s.pin && s.pin !== "NONE") {
            servo[String(s.index)] = s.pin;
        }
    }

    let { motorBaseline, servoBaseline } = prev;
    const baselineEmpty = Object.keys(motorBaseline).length === 0 && Object.keys(servoBaseline).length === 0;
    if (baselineEmpty) {
        motorBaseline = {};
        servoBaseline = {};
        for (const m of motors) {
            if (m.pin && m.pin !== "NONE") {
                motorBaseline[String(m.index)] = m.pin;
            }
        }
        for (const s of servos) {
            if (s.pin && s.pin !== "NONE") {
                servoBaseline[String(s.index)] = s.pin;
            }
        }
    }

    writeResourceHints(boardKey, { motor, servo, motorBaseline, servoBaseline });
}
