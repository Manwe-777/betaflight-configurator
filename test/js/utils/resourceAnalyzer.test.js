import { describe, expect, it } from "vitest";
import { analyzeResources } from "../../../src/js/utils/resourceAnalyzer.js";

const motor = (overrides) => ({
    index: 0,
    ioTag: 0x28,
    pin: "B07",
    timer: 4,
    channel: 1,
    complementary: false,
    dmaController: 1,
    dmaStream: 4,
    ...overrides,
});

const servo = (overrides) => ({
    index: 0,
    ioTag: 0x36,
    pin: "C06",
    timer: 8,
    channel: 1,
    complementary: false,
    dmaController: 2,
    dmaStream: 2,
    ...overrides,
});

describe("analyzeResources", () => {
    it("returns empty-shape report when given nothing", () => {
        const r = analyzeResources();
        expect(r.motors).toEqual([]);
        expect(r.servos).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.hasCliTopology).toBe(false);
    });

    it("filters out motor/servo entries with no ioTag or NONE pin", () => {
        const r = analyzeResources({
            motorResources: [motor({ index: 0 }), motor({ index: 1, ioTag: 0, pin: "NONE" })],
            servoResources: [servo({ index: 0, pin: "NONE" })],
        });
        expect(r.motors).toHaveLength(1);
        expect(r.motors[0].pad).toBe("B07");
        expect(r.servos).toHaveLength(0);
    });

    it("emits servo_on_motor_timer when a servo shares timer with a motor", () => {
        const r = analyzeResources({
            motorResources: [motor({ timer: 3 })],
            servoResources: [servo({ timer: 3, pin: "C06" })],
        });
        const codes = r.warnings.map((w) => w.code);
        expect(codes).toContain("servo_on_motor_timer");
        const w = r.warnings.find((x) => x.code === "servo_on_motor_timer");
        expect(w.severity).toBe("error");
        expect(w.resource).toEqual({ type: "servo", index: 0 });
    });

    it("emits motor_no_dma when a motor has a timer but no DMA controller", () => {
        const r = analyzeResources({
            motorResources: [motor({ dmaController: null, dmaStream: null })],
        });
        const codes = r.warnings.map((w) => w.code);
        expect(codes).toContain("motor_no_dma");
    });

    it("does not emit motor_no_dma when motor has no timer (release/none-state)", () => {
        const r = analyzeResources({
            motorResources: [motor({ timer: null, channel: null, dmaController: null, dmaStream: null })],
        });
        const codes = r.warnings.map((w) => w.code);
        expect(codes).not.toContain("motor_no_dma");
    });

    it("emits dma_tight only when CLI topology says so (< 3 free streams)", () => {
        const dmaShow = [
            { controller: 1, stream: 0, channel: null, peripheral: "FREE", index: null },
            { controller: 1, stream: 1, channel: null, peripheral: "FREE", index: null },
        ];
        const r = analyzeResources({
            motorResources: [motor()],
            dmaShow,
        });
        const codes = r.warnings.map((w) => w.code);
        expect(codes).toContain("dma_tight");
    });

    it("does NOT emit dma_tight when CLI topology is absent (avoid false positives on extended-MSP-only)", () => {
        const r = analyzeResources({
            motorResources: [motor()],
        });
        const codes = r.warnings.map((w) => w.code);
        expect(codes).not.toContain("dma_tight");
    });

    it("captures hardware-fixed pads and free pad set from resource show", () => {
        const r = analyzeResources({
            resourceShow: [
                { pad: "B07", peripheral: "MOTOR", index: 1 },
                { pad: "A11", peripheral: "USB", index: null },
                { pad: "C04", peripheral: "GYRO_CS", index: null },
                { pad: "A08", peripheral: "FREE", index: null },
                { pad: "C09", peripheral: "FREE", index: null },
            ],
        });
        expect(r.hardwareFixedPads.map((f) => f.pad).sort()).toEqual(["A11", "C04"]);
        expect(r.freePads.has("A08")).toBe(true);
        expect(r.freePadsCount).toBe(2);
        expect(r.hasCliTopology).toBe(true);
    });
});
