<template>
    <BaseTab tab-name="servos">
        <div class="content_wrapper">
            <div class="tab_title" v-html="$t('tabServos')"></div>
            <div class="cf_doc_version_bt">
                <WikiButton docUrl="servos" />
            </div>

            <div v-if="isSupported" class="flex flex-col gap-4">
                <UiBox :title="$t('servosChangeDirection')">
                    <div class="overflow-x-auto">
                        <div
                            class="grid items-center gap-y-1 min-w-0"
                            :style="{
                                gridTemplateColumns: `6rem repeat(3, minmax(5rem, auto)) repeat(${totalChannels}, 2.5rem) minmax(7rem, auto)`,
                            }"
                        >
                            <!-- Header row -->
                            <div class="text-center text-xs font-bold py-1">{{ $t("servosName") }}</div>
                            <div class="text-center text-xs font-bold py-1">{{ $t("servosMin") }}</div>
                            <div class="text-center text-xs font-bold py-1">{{ $t("servosMid") }}</div>
                            <div class="text-center text-xs font-bold py-1">{{ $t("servosMax") }}</div>
                            <div v-for="ch in 4" :key="'ch' + ch" class="text-center text-xs font-bold py-1">
                                CH{{ ch }}
                            </div>
                            <div
                                v-for="i in auxChannelCount"
                                :key="'aux' + i"
                                class="text-center text-xs font-bold py-1"
                            >
                                A{{ i }}
                            </div>
                            <div class="text-center text-xs font-bold py-1">
                                {{ $t("servosRateAndDirection") }}
                            </div>

                            <!-- Data rows -->
                            <template v-for="(servo, index) in servoConfigs" :key="index">
                                <div class="text-center text-sm py-1">Servo {{ index + 1 }}</div>
                                <UInputNumber
                                    v-model="servo.min"
                                    :min="500"
                                    :max="2500"
                                    :step="1"
                                    size="xs"
                                    orientation="vertical"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                    @change="onServoChange"
                                />
                                <UInputNumber
                                    v-model="servo.middle"
                                    :min="500"
                                    :max="2500"
                                    :step="1"
                                    size="xs"
                                    orientation="vertical"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                    @change="onServoChange"
                                />
                                <UInputNumber
                                    v-model="servo.max"
                                    :min="500"
                                    :max="2500"
                                    :step="1"
                                    size="xs"
                                    orientation="vertical"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                    @change="onServoChange"
                                />
                                <div v-for="ch in totalChannels" :key="'ch' + ch" class="flex justify-center">
                                    <input
                                        type="checkbox"
                                        class="size-4"
                                        :checked="servo.indexOfChannelToForward === ch - 1"
                                        @change="setChannelForward(index, ch - 1, $event)"
                                    />
                                </div>
                                <USelect
                                    v-model="servo.rate"
                                    :items="rateOptions"
                                    class="w-full"
                                    @change="onServoChange"
                                />
                            </template>
                        </div>
                    </div>

                    <div class="flex items-center gap-2 mt-3">
                        <USwitch v-model="liveMode" size="sm" />
                        <span class="text-sm">{{ $t("servosLiveMode") }}</span>
                    </div>
                </UiBox>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    <!-- Servo visualization bars -->
                    <UiBox :title="$t('servosText')">
                        <ul class="grid grid-cols-8 gap-2 mb-1">
                            <li
                                v-for="i in 8"
                                :key="'title' + i"
                                class="text-center text-xs font-bold"
                                :title="$t(`servoNumber${i}`)"
                            >
                                {{ i }}
                            </li>
                        </ul>
                        <ul class="grid grid-cols-8 gap-2">
                            <li
                                v-for="i in 8"
                                :key="'bar' + i"
                                class="relative h-[100px]"
                                :style="{ '--bar-opacity': getBarOpacity(servoData[i - 1] ?? 1500) }"
                            >
                                <div class="absolute inset-x-0 bottom-[45px] z-10 text-center text-[10px] font-bold">
                                    {{ servoData[i - 1] ?? 1500 }}
                                </div>
                                <UProgress
                                    orientation="vertical"
                                    inverted
                                    :model-value="getBarHeight(servoData[i - 1] ?? 1500)"
                                    :max="100"
                                    color="warning"
                                    size="2xl"
                                    :ui="{
                                        root: '!w-full',
                                        base: '!w-full !rounded-md border border-(--ui-border)',
                                        indicator: '!rounded-none !transition-none opacity-(--bar-opacity)',
                                    }"
                                    class="h-full"
                                />
                            </li>
                        </ul>
                    </UiBox>

                    <!-- Resource Assignments -->
                    <UiBox :title="$t('servosResourceAssignments')">
                        <div v-if="!hasResourceData" class="text-sm text-muted">
                            {{ $t("servosResourceNotAvailable") }}
                        </div>
                        <template v-else>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h4 class="text-sm font-bold mb-2">{{ $t("servosMotorResources") }}</h4>
                                    <div
                                        class="grid items-center gap-y-1"
                                        style="grid-template-columns: minmax(4rem, auto) 1fr"
                                    >
                                        <div class="text-center text-xs font-bold py-1">
                                            {{ $t("servosResourceIndex") }}
                                        </div>
                                        <div class="text-center text-xs font-bold py-1">
                                            {{ $t("servosResourcePin") }}
                                        </div>
                                        <template v-for="motor in motorResources" :key="'motor' + motor.index">
                                            <div class="text-center text-sm py-1">
                                                {{ $t("servosResourceMotorLabel") }} {{ motor.index + 1 }}
                                            </div>
                                            <USelectMenu
                                                :model-value="motor.pin"
                                                value-key="value"
                                                :items="resourceItemsForSlot('motor', motor.index, motor.pin)"
                                                size="xs"
                                                class="w-full"
                                                :ui="{ content: 'max-h-72' }"
                                                @update:model-value="
                                                    (val) => onResourcePinChange('motor', motor.index, val)
                                                "
                                            />
                                        </template>
                                    </div>
                                </div>
                                <div>
                                    <h4 class="text-sm font-bold mb-2">{{ $t("servosServoResources") }}</h4>
                                    <div
                                        class="grid items-center gap-y-1"
                                        style="grid-template-columns: minmax(4rem, auto) 1fr"
                                    >
                                        <div class="text-center text-xs font-bold py-1">
                                            {{ $t("servosResourceIndex") }}
                                        </div>
                                        <div class="text-center text-xs font-bold py-1">
                                            {{ $t("servosResourcePin") }}
                                        </div>
                                        <template v-for="servo in servoResources" :key="'servo' + servo.index">
                                            <div class="text-center text-sm py-1">
                                                {{ $t("servosResourceServoLabel") }} {{ servo.index + 1 }}
                                            </div>
                                            <USelectMenu
                                                :model-value="servo.pin"
                                                value-key="value"
                                                :items="resourceItemsForSlot('servo', servo.index, servo.pin)"
                                                size="xs"
                                                class="w-full"
                                                :ui="{ content: 'max-h-72' }"
                                                @update:model-value="
                                                    (val) => onResourcePinChange('servo', servo.index, val)
                                                "
                                            />
                                        </template>
                                    </div>
                                </div>
                            </div>
                            <p class="text-xs text-muted mt-3">{{ $t("servosResourceEditHint") }}</p>

                            <div v-if="resourceWarnings.length > 0" class="mt-3 flex flex-col gap-1.5">
                                <div
                                    v-for="(warning, wi) in resourceWarnings"
                                    :key="'warn' + wi"
                                    class="flex items-start gap-2 text-xs"
                                >
                                    <UBadge
                                        :color="warningColor(warning.severity)"
                                        size="sm"
                                        variant="subtle"
                                        class="shrink-0"
                                    >
                                        {{ $t(`servosResourceWarningSeverity_${warning.severity}`) }}
                                    </UBadge>
                                    <span>{{ warning.message }}</span>
                                </div>
                            </div>

                            <div v-if="resourcesModified" class="mt-3 flex items-center gap-2">
                                <UBadge color="warning" variant="subtle" size="sm">
                                    {{ $t("servosResourcePending", { count: pendingResourceCount }) }}
                                </UBadge>
                                <UButton
                                    size="xs"
                                    variant="ghost"
                                    :label="$t('servosResourceRevert')"
                                    @click="revertResourceChanges"
                                />
                            </div>
                        </template>
                    </UiBox>
                </div>
            </div>
        </div>

        <!-- Save button toolbar -->
        <div v-if="isSupported" class="content_toolbar toolbar_fixed_bottom">
            <div class="flex gap-2">
                <UButton :label="$t('servosButtonSave')" :disabled="!configHasChanged" @click="saveServoConfig" />
            </div>
        </div>
    </BaseTab>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import BaseTab from "./BaseTab.vue";
import WikiButton from "@/components/elements/WikiButton.vue";
import UiBox from "@/components/elements/UiBox.vue";
import { useTranslation } from "i18next-vue";
import GUI from "@/js/gui";
import FC from "@/js/fc";
import MSP from "@/js/msp";
import MSPCodes from "@/js/msp/MSPCodes";
import { mspHelper } from "@/js/msp/MSPHelper";
import { gui_log } from "@/js/gui_log";
import { i18n } from "@/js/localization";
import { useInterval } from "@/composables/useInterval";
import { useTimeout } from "@/composables/useTimeout";
import { readCli, parseResourceShow, parseTimerShow, parseTimerDump, parseDmaShow } from "@/js/utils/cliOneShot";
import { analyzeResources } from "@/js/utils/resourceAnalyzer";
import { candidatePadsForSlot, describeCandidate } from "@/js/utils/resourceRecommender";
import { resourceHintsBoardKey, readResourceHints, persistResourceSlotHints } from "@/js/utils/resourceSlotMemoryStore";

const { t } = useTranslation();

const isSupported = ref(false);
const liveMode = ref(false);
const servoConfigs = reactive([]);
const servoData = reactive([]);
const originalConfigs = ref("");

// Resource assignment state
const motorResources = reactive([]);
const servoResources = reactive([]);
const hasResourceData = ref(false);
const initialPins = ref([]);

// CLI-derived board topology (parsed `resource show`/`timer show`/`dma show`).
// Empty arrays when CLI introspection isn't available; the analyzer handles
// the degraded case by relying on the extended MSP payload alone.
const cliResourceShow = ref([]);
const cliTimerShow = ref([]);
const cliTimerDump = ref([]);
const cliDmaShow = ref([]);

// Staged resource edits keyed by `${type}:${index}` ("motor:0"). Values are
// the new ioTag (0 = NONE). No MSP write fires until the user hits Save.
// This avoids the optimistic-UI desync flagged by CodeRabbit and the
// half-reconfigured-FC failure mode raised by Bskimp.
const pendingResourceChanges = reactive(new Map());

// Per-board last/baseline pin maps (Configurator localStorage). Survives
// app restarts so a motor released to NONE can still offer its old pad.
const resourceSlotHints = ref({
    motor: {},
    servo: {},
    motorBaseline: {},
    servoBaseline: {},
});

function syncResourceSlotHintsFromState() {
    if (!FC.CONFIG?.apiVersion) {
        return;
    }
    const bk = resourceHintsBoardKey();
    persistResourceSlotHints(bk, motorResources, servoResources);
    resourceSlotHints.value = readResourceHints(bk);
}

const { addInterval } = useInterval();
const { addTimeout } = useTimeout();

const totalChannels = computed(() => FC.RC?.active_channels || 8);
const auxChannelCount = computed(() => Math.max(0, totalChannels.value - 4));

const pendingResourceCount = computed(() => pendingResourceChanges.size);
const resourcesModified = computed(() => pendingResourceChanges.size > 0);

const configHasChanged = computed(
    () => originalConfigs.value !== JSON.stringify(servoConfigs) || resourcesModified.value,
);

const rateOptions = computed(() => {
    const opts = [];
    for (let i = 100; i > -101; i--) {
        opts.push({ value: i, label: `${t("servosRate")} ${i}%` });
    }
    return opts;
});

// Snapshot the analyzer view of the current state so candidate lookups
// (one per dropdown render) reuse a single computation.
const analysis = computed(() =>
    analyzeResources({
        motorResources,
        servoResources,
        resourceShow: cliResourceShow.value,
        timerShow: cliTimerShow.value,
        timerDump: cliTimerDump.value,
        dmaShow: cliDmaShow.value,
    }),
);

const resourceWarnings = computed(() => analysis.value.warnings);

// Map a recommender source onto a Nuxt UI badge/chip color so the
// dropdown is colour-coded the same way Bskimp's wing-fork shows them
// (zero-churn = neutral, motor-release = warning, free-pwm = success,
// free-conflict / no-DMA = error).
function colorForSource(source, conflicts = []) {
    if (conflicts.includes("motor-in-use")) {
        return "error";
    }
    if (conflicts.includes("no-dma-stream")) {
        return "error";
    }
    switch (source) {
        case "existing":
            return "primary";
        case "motor-release":
            return "warning";
        case "servo-release":
            return "warning";
        case "free-pwm":
            return "success";
        case "free-conflict":
            return "error";
        case "led-strip":
            return "warning";
        case "uart-release":
            return "warning";
        case "remembered":
            return "info";
        case "session-baseline":
            return "neutral";
        default:
            return "neutral";
    }
}

function warningColor(severity) {
    switch (severity) {
        case "error":
            return "error";
        case "warn":
            return "warning";
        case "info":
        default:
            return "info";
    }
}

// Build the items list for one motor/servo dropdown. Always includes
// NONE plus the analyzer-ranked candidates; the current pad is grouped
// at the top, then a separator, then the rest grouped by source.
function resourceItemsForSlot(resourceType, index, currentPin) {
    // We don't try to detect "motor mixer-in-use" from the configurator
    // alone — that requires mixer + motor-count plumbing the resource UI
    // doesn't currently have. Pass an empty `motorIndicesInUse` so every
    // bound motor pad shows up as a swap candidate; the user gets the
    // full pool with "currently MOTOR N (will be released)" labels and
    // makes an informed choice. Future work can pre-populate this from
    // FC.MOTOR_CONFIG / FC.MIXER_CONFIG to dim mixer-driven motors.
    const h = resourceSlotHints.value;
    const key = String(index);
    const slotIsClear = !currentPin || currentPin === "NONE";
    let rememberedFromStore = null;
    if (slotIsClear) {
        rememberedFromStore = resourceType === "motor" ? h.motor[key] : h.servo[key];
    }
    let baselinePadRaw = null;
    if (slotIsClear) {
        baselinePadRaw = resourceType === "motor" ? h.motorBaseline[key] : h.servoBaseline[key];
    }
    const rememberedPad = rememberedFromStore && rememberedFromStore !== "NONE" ? rememberedFromStore : null;
    const baselinePad =
        baselinePadRaw && baselinePadRaw !== "NONE" && baselinePadRaw !== rememberedPad ? baselinePadRaw : null;

    const candidates = candidatePadsForSlot(
        analysis.value,
        { resourceType, index },
        {
            currentPad: currentPin && currentPin !== "NONE" ? currentPin : null,
            rememberedPad,
            sessionBaselinePad: baselinePad,
        },
    );

    const items = [
        {
            value: "NONE",
            label: "NONE",
            description: t("servosResourceNoneHint"),
            chip: { color: "neutral" },
        },
    ];

    let lastSource = null;
    for (const c of candidates) {
        if (lastSource && lastSource !== c.source) {
            items.push({ type: "separator" });
        }
        lastSource = c.source;
        const release = c.requiresRelease.length > 0 ? c.requiresRelease.join("; ") : null;
        items.push({
            value: c.pad,
            label: c.pad,
            description: describeCandidate(c).replace(`${c.pad} — `, "").replace(c.pad, "").trim(),
            chip: { color: colorForSource(c.source, c.conflicts) },
            release,
        });
    }
    return items;
}

// Bar height as percentage (0-100) for UProgress
function getBarHeight(value) {
    const clamped = Math.min(Math.max(value - 1000, 0), 1000);
    return (clamped / 1000) * 100;
}

// Bar opacity string for CSS variable
function getBarOpacity(value) {
    const alpha = Math.min(Math.max((value - 1000) / 1000, 0), 1);
    return alpha.toFixed(2);
}

function setChannelForward(servoIndex, channelIndex, event) {
    if (event.target.checked) {
        servoConfigs[servoIndex].indexOfChannelToForward = channelIndex;
    } else {
        servoConfigs[servoIndex].indexOfChannelToForward = 255;
    }
    onServoChange();
}

function onServoChange() {
    if (liveMode.value) {
        addTimeout("servos_update", () => updateServos(false), 10);
    }
}

function updateServos(saveToEeprom) {
    const SERVO_MIN = 500;
    const SERVO_MAX = 2500;

    for (let i = 0; i < servoConfigs.length; i++) {
        const src = servoConfigs[i];
        const cfg = FC.SERVO_CONFIG[i];

        const min = Math.min(Math.max(src.min ?? SERVO_MIN, SERVO_MIN), SERVO_MAX);
        const middle = Math.min(Math.max(src.middle ?? SERVO_MIN, SERVO_MIN), SERVO_MAX);
        const max = Math.min(Math.max(src.max ?? SERVO_MAX, SERVO_MIN), SERVO_MAX);

        cfg.min = min;
        cfg.middle = middle;
        cfg.max = max;
        cfg.rate = src.rate;
        cfg.indexOfChannelToForward = src.indexOfChannelToForward ?? 255;

        src.min = min;
        src.middle = middle;
        src.max = max;
    }

    mspHelper.sendServoConfigurations(() => {
        if (saveToEeprom) {
            mspHelper.writeConfiguration(false, () => {
                gui_log(i18n.getMessage("servosEepromSave"));
                originalConfigs.value = JSON.stringify(servoConfigs);
            });
        }
    });
}

// Flush every staged resource pin change in sequence; resolves once the
// last MSP set has been ack'd. Sequential (not parallel) so MSP queue
// ordering is deterministic and one failure short-circuits the rest.
function flushPendingResourceChanges() {
    // The underlying mspHelper.setMotorServoResource fires its callback
    // only on success in this codebase, so the promise either fulfils
    // or hangs on FC timeout — we accept that here and let the existing
    // MSP-level timeout surface the error.
    return new Promise((resolve) => {
        const entries = Array.from(pendingResourceChanges.entries());
        if (entries.length === 0) {
            resolve();
            return;
        }
        const next = (i) => {
            if (i >= entries.length) {
                resolve();
                return;
            }
            const [key, ioTag] = entries[i];
            const [type, idxStr] = key.split(":");
            const resourceType = type === "motor" ? 0 : 1;
            const idx = Number(idxStr);
            mspHelper.setMotorServoResource(resourceType, idx, ioTag, () => {
                next(i + 1);
            });
        };
        next(0);
    });
}

function saveServoConfig() {
    const hadResourceChanges = pendingResourceChanges.size > 0;
    flushPendingResourceChanges()
        .then(() => {
            updateServos(true);
            if (hadResourceChanges) {
                pendingResourceChanges.clear();
                gui_log(i18n.getMessage("servosResourceSaved"));
            }
        })
        .catch((err) => {
            console.error("Failed to apply resource changes", err);
            gui_log(i18n.getMessage("servosResourceSaveFailed"));
        });
}

function revertResourceChanges() {
    pendingResourceChanges.clear();
    // Re-seed local pin/ioTag state from the last loaded FC payload so
    // dropdowns visually snap back to the firmware's current values.
    if (FC.MOTOR_RESOURCES) {
        for (let i = 0; i < motorResources.length && i < FC.MOTOR_RESOURCES.length; i++) {
            motorResources[i] = { ...FC.MOTOR_RESOURCES[i] };
        }
    }
    if (FC.SERVO_RESOURCES) {
        for (let i = 0; i < servoResources.length && i < FC.SERVO_RESOURCES.length; i++) {
            servoResources[i] = { ...FC.SERVO_RESOURCES[i] };
        }
    }
    syncResourceSlotHintsFromState();
}

function getServoData() {
    MSP.send_message(MSPCodes.MSP_SERVO, false, false, () => {
        for (let i = 0; i < FC.SERVO_DATA.length; i++) {
            servoData[i] = FC.SERVO_DATA[i];
        }
    });
}

function loadResourceData() {
    const pins = new Set();

    motorResources.length = 0;
    if (FC.MOTOR_RESOURCES && FC.MOTOR_RESOURCES.length > 0) {
        for (const resource of FC.MOTOR_RESOURCES) {
            motorResources.push({ ...resource });
            if (resource.pin && resource.pin !== "NONE") {
                pins.add(resource.pin);
            }
        }
    }

    servoResources.length = 0;
    if (FC.SERVO_RESOURCES && FC.SERVO_RESOURCES.length > 0) {
        for (const resource of FC.SERVO_RESOURCES) {
            servoResources.push({ ...resource });
            if (resource.pin && resource.pin !== "NONE") {
                pins.add(resource.pin);
            }
        }
    }

    initialPins.value = Array.from(pins).sort();
    hasResourceData.value = motorResources.length > 0 || servoResources.length > 0;
    pendingResourceChanges.clear();
    syncResourceSlotHintsFromState();
}

// Best-effort CLI introspection. MSP.send_cli_command works regardless
// of whether the user has visited the CLI tab — it wraps the command in
// the dedicated MSP frame the firmware always accepts. Failures
// (timeout, older firmware without `dma show`) are swallowed and the
// analyzer falls back to the extended-MSP-only view.
async function loadCliTopology() {
    try {
        const resourceOut = await readCli("resource show", { quiescenceMs: 300 });
        cliResourceShow.value = parseResourceShow(resourceOut.lines);
        const timerShowOut = await readCli("timer show", { quiescenceMs: 300 });
        cliTimerShow.value = parseTimerShow(timerShowOut.lines);
        // Bare `timer` dump enumerates every pad's TIM/CH, including
        // currently-FREE pads that `timer show` doesn't surface — this
        // is what lets `free-pwm` candidates appear in the dropdown.
        const timerDumpOut = await readCli("timer", { quiescenceMs: 500 });
        cliTimerDump.value = parseTimerDump(timerDumpOut.lines);
        const dmaOut = await readCli("dma show", { quiescenceMs: 300 });
        cliDmaShow.value = parseDmaShow(dmaOut.lines);
    } catch (err) {
        console.log("ServosTab: CLI topology read failed (non-fatal)", err);
    }
}

async function loadServoData() {
    if (!FC.CONFIG?.apiVersion) {
        isSupported.value = false;
        GUI.content_ready();
        return;
    }

    try {
        await MSP.promise(MSPCodes.MSP_SERVO_CONFIGURATIONS);
        await MSP.promise(MSPCodes.MSP_SERVO_MIX_RULES);
        await MSP.promise(MSPCodes.MSP_RC);
        await MSP.promise(MSPCodes.MSP_BOXNAMES);

        try {
            await MSP.promise(MSPCodes.MSP2_MOTOR_SERVO_RESOURCE);
            loadResourceData();
            // CLI topology read is opt-in: enable it only when MSP says
            // the firmware speaks the extended payload (firmware older
            // than the per-resource timer/DMA fields tends to be older
            // than reliable `dma show` parsing too).
            const hasExtendedPayload =
                motorResources.some((r) => r.timer != null || r.dmaController != null) ||
                servoResources.some((r) => r.timer != null || r.dmaController != null);
            if (hasExtendedPayload) {
                // Don't await — let the dropdowns render with extended-
                // MSP-only data while CLI topology fills in.
                loadCliTopology();
            }
        } catch {
            console.log("Resource data not available (firmware may not support MSP2_MOTOR_SERVO_RESOURCE)");
            hasResourceData.value = false;
        }

        initializeUI();
    } catch (e) {
        console.error("Failed to load servo configs", e);
        isSupported.value = false;
        GUI.content_ready();
    }
}

function onResourcePinChange(resourceType, index, newPin) {
    const resources = resourceType === "motor" ? motorResources : servoResources;
    const ioTag = newPin === "NONE" ? 0 : mspHelper.pinToIoTag(newPin);
    const existing = resources[index];
    if (!existing) {
        return;
    }

    // Update local state so the dropdown stays in sync visually, but
    // don't push to FC yet — staged for the Save button.
    resources[index] = {
        ...existing,
        pin: newPin,
        ioTag,
        // Clear cached timer/DMA — recommender will fall back to padTimers
        // until the next FC re-read on Save+reboot.
        timer: existing.pin === newPin ? existing.timer : null,
        channel: existing.pin === newPin ? existing.channel : null,
        complementary: existing.pin === newPin ? existing.complementary : false,
        dmaController: existing.pin === newPin ? existing.dmaController : null,
        dmaStream: existing.pin === newPin ? existing.dmaStream : null,
    };

    const key = `${resourceType}:${index}`;
    const original = resourceType === "motor" ? FC.MOTOR_RESOURCES?.[index] : FC.SERVO_RESOURCES?.[index];
    if (original && original.ioTag === ioTag) {
        // User reverted to the firmware's current value — drop the staged change.
        pendingResourceChanges.delete(key);
    } else {
        pendingResourceChanges.set(key, ioTag);
    }

    syncResourceSlotHintsFromState();
}

function initializeUI() {
    if (!FC.SERVO_CONFIG || FC.SERVO_CONFIG.length === 0) {
        isSupported.value = false;
        GUI.content_ready();
        return;
    }

    isSupported.value = true;

    servoConfigs.length = 0;
    for (let i = 0; i < 8; i++) {
        if (FC.SERVO_CONFIG[i]) {
            servoConfigs.push({
                min: FC.SERVO_CONFIG[i].min,
                middle: FC.SERVO_CONFIG[i].middle,
                max: FC.SERVO_CONFIG[i].max,
                rate: FC.SERVO_CONFIG[i].rate,
                indexOfChannelToForward: FC.SERVO_CONFIG[i].indexOfChannelToForward,
            });
        }
    }

    originalConfigs.value = JSON.stringify(servoConfigs);

    addInterval("servo_data_pull", getServoData, 50);
    addInterval("status_pull", () => MSP.send_message(MSPCodes.MSP_STATUS), 250, true);

    GUI.content_ready();
}

onMounted(() => {
    loadServoData();
});
</script>
