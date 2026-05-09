import { describe, expect, it } from "vitest";
import { candidatePadsForSlot, describeCandidate } from "../../../src/js/utils/resourceRecommender.js";

const baseAnalysis = ({
    motors = [],
    servos = [],
    freePads = [],
    padTimers = new Map(),
    ledStrips = [],
    serials = [],
    hardwareFixedPads = [],
} = {}) => ({
    motors,
    servos,
    ledStrips,
    serials,
    hardwareFixedPads,
    freePads: new Set(freePads),
    freePadsCount: freePads.length,
    pwmCapableFreePads: freePads.filter((p) => padTimers.has(p)).map((pad) => ({ pad, ...padTimers.get(pad) })),
    freeDmaStreams: [],
    padTimers,
    warnings: [],
    hasCliTopology: true,
});

describe("candidatePadsForSlot", () => {
    it("returns empty array on bad inputs", () => {
        expect(candidatePadsForSlot(null, { resourceType: "motor", index: 0 })).toEqual([]);
        expect(candidatePadsForSlot({}, { resourceType: "thrust", index: 0 })).toEqual([]);
    });

    it("biases to existing pad with source=existing", () => {
        const motors = [
            { index: 0, pad: "B07", timer: 4, channel: 1, complementary: false, dmaController: 1, dmaStream: 4 },
        ];
        const analysis = baseAnalysis({ motors });
        const candidates = candidatePadsForSlot(analysis, { resourceType: "motor", index: 0 }, { currentPad: "B07" });
        expect(candidates[0].pad).toBe("B07");
        expect(candidates[0].source).toBe("existing");
        expect(candidates[0].requiresRelease).toEqual([]);
    });

    it("ranks motor-release / servo-release ahead of free-pwm", () => {
        const motors = [
            { index: 0, pad: "B07", timer: 4, channel: 1, complementary: false, dmaController: 1, dmaStream: 4 },
            { index: 1, pad: "B00", timer: 3, channel: 3, complementary: false, dmaController: 1, dmaStream: 5 },
        ];
        const servos = [
            { index: 0, pad: "C06", timer: 8, channel: 1, complementary: false, dmaController: 2, dmaStream: 2 },
        ];
        const padTimers = new Map([["A08", { timer: 1, channel: 1, complementary: false }]]);
        const analysis = baseAnalysis({ motors, servos, freePads: ["A08"], padTimers });

        // Editing SERVO 1 (index 0) — its own pad C06 is "existing", not
        // a release candidate. Both motor pads + free A08 should follow.
        const candidates = candidatePadsForSlot(analysis, { resourceType: "servo", index: 0 }, { currentPad: "C06" });
        const sources = candidates.map((c) => c.source);
        expect(sources[0]).toBe("existing");
        // Motor-release entries appear in motor-index order, before free-pwm.
        expect(sources.indexOf("motor-release")).toBeLessThan(sources.indexOf("free-pwm"));
        // The current servo's pad is NOT duplicated as servo-release.
        expect(candidates.filter((c) => c.pad === "C06")).toHaveLength(1);
        // Both bound motors are surfaced as releasable candidates.
        const releasable = candidates.filter((c) => c.source === "motor-release").map((c) => c.pad);
        expect(releasable).toContain("B07");
        expect(releasable).toContain("B00");
    });

    it("offers other servo pads as servo-release candidates", () => {
        const servos = [
            { index: 0, pad: "C06", timer: 8, channel: 1, complementary: false, dmaController: null, dmaStream: null },
            { index: 1, pad: "C07", timer: 8, channel: 2, complementary: false, dmaController: null, dmaStream: null },
        ];
        const candidates = candidatePadsForSlot(
            baseAnalysis({ servos }),
            { resourceType: "servo", index: 0 },
            { currentPad: "C06" },
        );
        const c07 = candidates.find((c) => c.pad === "C07");
        expect(c07).toBeDefined();
        expect(c07.source).toBe("servo-release");
        expect(c07.requiresRelease).toEqual(["resource SERVO 2 NONE"]);
    });

    it("flags motor candidates whose motor index is in motorIndicesInUse", () => {
        const motors = [
            { index: 0, pad: "B07", timer: 4, channel: 1, complementary: false, dmaController: 1, dmaStream: 4 },
            { index: 1, pad: "B00", timer: 3, channel: 3, complementary: false, dmaController: 1, dmaStream: 5 },
        ];
        const candidates = candidatePadsForSlot(
            baseAnalysis({ motors }),
            { resourceType: "servo", index: 0 },
            { motorIndicesInUse: [0] },
        );
        const b07 = candidates.find((c) => c.pad === "B07");
        const b00 = candidates.find((c) => c.pad === "B00");
        expect(b07.source).toBe("motor-release");
        expect(b07.conflicts).toContain("motor-in-use");
        expect(b00.source).toBe("motor-release");
        expect(b00.conflicts).not.toContain("motor-in-use");
    });

    it("partitions free-pwm pads by timer conflict with in-use motors", () => {
        const motors = [
            { index: 0, pad: "B07", timer: 3, channel: 1, complementary: false, dmaController: 1, dmaStream: 4 },
        ];
        const padTimers = new Map([
            ["A08", { timer: 1, channel: 1, complementary: false }],
            ["C06", { timer: 3, channel: 2, complementary: false }],
        ]);
        const analysis = baseAnalysis({ motors, freePads: ["A08", "C06"], padTimers });
        const candidates = candidatePadsForSlot(
            analysis,
            { resourceType: "servo", index: 0 },
            { motorIndicesInUse: [0] },
        );
        const a08 = candidates.find((c) => c.pad === "A08");
        const c06 = candidates.find((c) => c.pad === "C06");
        expect(a08.source).toBe("free-pwm");
        expect(a08.sharesTimerWithMotor).toBe(false);
        expect(c06.source).toBe("free-conflict");
        expect(c06.sharesTimerWithMotor).toBe(true);
        expect(candidates.indexOf(a08)).toBeLessThan(candidates.indexOf(c06));
    });

    it("boosts rememberedPad to top when slot is NONE and pad is free", () => {
        const motors = [
            { index: 0, pad: "B07", timer: 4, channel: 1, complementary: false, dmaController: 1, dmaStream: 4 },
        ];
        const padTimers = new Map([["B06", { timer: 3, channel: 2, complementary: false }]]);
        const analysis = baseAnalysis({ motors, freePads: ["B06"], padTimers });
        const candidates = candidatePadsForSlot(
            analysis,
            { resourceType: "motor", index: 1 },
            { rememberedPad: "B06" },
        );
        const b06 = candidates.find((c) => c.pad === "B06");
        expect(b06).toBeDefined();
        expect(b06.source).toBe("remembered");
        expect(candidates[0].pad).toBe("B06");
    });

    it("flags motor candidate with no DMA stream as no-dma-stream conflict", () => {
        const candidates = candidatePadsForSlot(
            baseAnalysis({
                motors: [
                    {
                        index: 0,
                        pad: "B07",
                        timer: 4,
                        channel: 1,
                        complementary: false,
                        dmaController: null,
                        dmaStream: null,
                    },
                ],
            }),
            { resourceType: "motor", index: 0 },
            { currentPad: "B07" },
        );
        expect(candidates[0].conflicts).toContain("no-dma-stream");
    });

    it("never offers a hardware-fixed pad even if currentPad would match", () => {
        const analysis = baseAnalysis({ hardwareFixedPads: [{ pad: "A11", peripheral: "USB", index: null }] });
        const candidates = candidatePadsForSlot(analysis, { resourceType: "servo", index: 0 }, { currentPad: "A11" });
        expect(candidates.find((c) => c.pad === "A11")).toBeUndefined();
    });

    it("opt-in LED_STRIP and UART pads only when allowed", () => {
        const ledStrips = [{ pad: "A00", timer: 5, channel: 1, dmaController: 1, dmaStream: 7 }];
        const serials = [{ index: 6, txPad: "C06", rxPad: "C07" }];
        const analysis = baseAnalysis({ ledStrips, serials });

        const without = candidatePadsForSlot(analysis, { resourceType: "servo", index: 0 }, {});
        expect(without.find((c) => c.pad === "A00")).toBeUndefined();
        expect(without.find((c) => c.pad === "C06")).toBeUndefined();

        const withOptIn = candidatePadsForSlot(
            analysis,
            { resourceType: "servo", index: 0 },
            { allowLedStrip: true, allowUartRelease: [6] },
        );
        const led = withOptIn.find((c) => c.pad === "A00");
        const tx = withOptIn.find((c) => c.pad === "C06");
        expect(led.source).toBe("led-strip");
        expect(tx.source).toBe("uart-release");
        expect(tx.requiresRelease).toEqual(["resource SERIAL_TX 6 NONE"]);
    });
});

describe("describeCandidate", () => {
    it("formats existing zero-churn pad with timer/channel", () => {
        expect(
            describeCandidate({
                pad: "B07",
                timer: 4,
                channel: 1,
                complementary: false,
                dmaController: 1,
                dmaStream: 4,
                source: "existing",
                requiresRelease: [],
                sharesTimerWithMotor: false,
                conflicts: [],
            }),
        ).toBe("B07 — TIM4 CH1");
    });

    it("formats motor-release with the released MOTOR number", () => {
        expect(
            describeCandidate({
                pad: "B00",
                timer: 3,
                channel: 3,
                complementary: false,
                dmaController: 1,
                dmaStream: 5,
                source: "motor-release",
                requiresRelease: ["resource MOTOR 2 NONE"],
                sharesTimerWithMotor: false,
                conflicts: [],
            }),
        ).toBe("B00 — TIM3 CH3 — currently MOTOR 2 (will be released)");
    });

    it("warns more strongly when releasing a motor that is in use", () => {
        const text = describeCandidate({
            pad: "B07",
            timer: 4,
            channel: 1,
            complementary: false,
            dmaController: 1,
            dmaStream: 4,
            source: "motor-release",
            requiresRelease: ["resource MOTOR 1 NONE"],
            sharesTimerWithMotor: false,
            conflicts: ["motor-in-use"],
        });
        expect(text).toContain("in use");
        expect(text).toContain("will break the motor");
    });

    it("formats servo-release context", () => {
        const text = describeCandidate({
            pad: "C07",
            timer: 8,
            channel: 2,
            complementary: false,
            dmaController: 2,
            dmaStream: 3,
            source: "servo-release",
            requiresRelease: ["resource SERVO 2 NONE"],
            sharesTimerWithMotor: false,
            conflicts: [],
        });
        expect(text).toBe("C07 — TIM8 CH2 — currently SERVO 2 (will be released)");
    });

    it("appends 'no DMA' tag for motor candidates without a DMA stream", () => {
        const text = describeCandidate({
            pad: "B07",
            timer: 4,
            channel: 1,
            complementary: false,
            dmaController: null,
            dmaStream: null,
            source: "existing",
            requiresRelease: [],
            sharesTimerWithMotor: false,
            conflicts: ["no-dma-stream"],
        });
        expect(text).toContain("no DMA");
    });
});
