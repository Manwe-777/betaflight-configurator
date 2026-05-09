import { describe, expect, it } from "vitest";
import { parseResourceShow, parseTimerShow, parseTimerDump, parseDmaShow } from "../../../src/js/utils/cliOneShot.js";

describe("parseResourceShow", () => {
    it("parses classic PAD: NAME INDEX layout", () => {
        const input = ["B07: MOTOR 1", "B00: MOTOR 2", "C06: SERVO 1", "A08: FREE", "C04: GYRO_CS"];
        expect(parseResourceShow(input)).toEqual([
            { pad: "B07", peripheral: "MOTOR", index: 1 },
            { pad: "B00", peripheral: "MOTOR", index: 2 },
            { pad: "C06", peripheral: "SERVO", index: 1 },
            { pad: "A08", peripheral: "FREE", index: null },
            { pad: "C04", peripheral: "GYRO_CS", index: null },
        ]);
    });

    it("parses dump-style 'resource NAME INDEX PAD' layout and skips NONE", () => {
        const input = ["resource MOTOR 1 B07", "resource SERVO 1 C06", "resource MOTOR 5 NONE"];
        expect(parseResourceShow(input)).toEqual([
            { pad: "B07", peripheral: "MOTOR", index: 1 },
            { pad: "C06", peripheral: "SERVO", index: 1 },
        ]);
    });

    it("accepts a multi-line raw string", () => {
        const raw = "B07: MOTOR 1\nC06: SERVO 1";
        expect(parseResourceShow(raw)).toHaveLength(2);
    });

    it("ignores lines that match neither shape", () => {
        const input = ["", "Resource list:", "header text", "B07: MOTOR 1"];
        expect(parseResourceShow(input)).toEqual([{ pad: "B07", peripheral: "MOTOR", index: 1 }]);
    });
});

describe("parseTimerShow", () => {
    it("parses hierarchical TIM/CH blocks with complementary channels", () => {
        const input = ["TIM4:", "    CH1 : MOTOR 2", "    CH2 : MOTOR 1", "TIM2: FREE", "TIM1:", "    CH3N: SERVO 1"];
        expect(parseTimerShow(input)).toEqual([
            { timer: 4, channel: 1, complementary: false, peripheral: "MOTOR", index: 2 },
            { timer: 4, channel: 2, complementary: false, peripheral: "MOTOR", index: 1 },
            { timer: 2, channel: null, complementary: false, peripheral: "FREE", index: null },
            { timer: 1, channel: 3, complementary: true, peripheral: "SERVO", index: 1 },
        ]);
    });
});

describe("parseTimerDump", () => {
    it("parses '# pin XX: TIMn CHn (AFn)' comment lines from bare timer dump", () => {
        const input = [
            "timer B07 AF2",
            "# pin B07: TIM4 CH2 (AF2)",
            "timer A02 NONE",
            "# pin A02: NONE",
            "timer C09 AF3",
            "# pin C09: TIM3 CH4N (AF3)",
        ];
        expect(parseTimerDump(input)).toEqual([
            { pad: "B07", timer: 4, channel: 2, complementary: false, af: 2 },
            { pad: "A02", timer: null, channel: null, complementary: false, af: null },
            { pad: "C09", timer: 3, channel: 4, complementary: true, af: 3 },
        ]);
    });

    it("ignores non-pin comment lines", () => {
        const input = ["# pin B07: TIM4 CH2 (AF2)", "# some other comment", "Header text"];
        expect(parseTimerDump(input)).toHaveLength(1);
    });
});

describe("parseDmaShow", () => {
    it("parses Stream and Stream+Channel rows; preserves FREE entries", () => {
        const input = [
            "DMA1 Stream 4: MOTOR 1",
            "DMA2 Stream 6 Channel 5: USART6_TX",
            "DMA1 Stream 0: FREE",
            "DMA2 Stream 2: TIMUP 8",
        ];
        expect(parseDmaShow(input)).toEqual([
            { controller: 1, stream: 4, channel: null, peripheral: "MOTOR", index: 1 },
            { controller: 2, stream: 6, channel: 5, peripheral: "USART6_TX", index: null },
            { controller: 1, stream: 0, channel: null, peripheral: "FREE", index: null },
            { controller: 2, stream: 2, channel: null, peripheral: "TIMUP", index: 8 },
        ]);
    });
});
