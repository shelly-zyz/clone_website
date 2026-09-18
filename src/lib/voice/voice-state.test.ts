import assert from "node:assert/strict";
import test from "node:test";
// Node's type-stripping test runner requires explicit TypeScript extensions.
// @ts-expect-error TS5097 is intentionally isolated to this direct Node test import.
import { classifyVoiceUtterance, initialVoiceState, reduceVoiceState } from "./voice-state.ts";

test("voice capture and speech output are off by default", () => {
  assert.equal(initialVoiceState.capture, "off");
  assert.equal(initialVoiceState.enabled, false);
  assert.equal(initialVoiceState.muted, true);
});

test("microphone lifecycle exposes starting, listening, processing, and off states", () => {
  const starting = reduceVoiceState(initialVoiceState, { type: "enable", supported: true });
  const listening = reduceVoiceState(starting, { type: "started" });
  const processing = reduceVoiceState(listening, { type: "final-transcript", transcript: "广东有多少已映射光伏设施" });
  const stopped = reduceVoiceState(processing, { type: "stop" });
  assert.equal(starting.capture, "starting");
  assert.equal(listening.capture, "listening");
  assert.equal(processing.capture, "processing");
  assert.equal(processing.lastTranscript, "广东有多少已映射光伏设施");
  assert.equal(stopped.capture, "off");
  assert.equal(stopped.enabled, false);
});

test("microphone off ignores recognition events and unsupported browsers stay off", () => {
  assert.deepEqual(reduceVoiceState(initialVoiceState, { type: "interim-transcript", transcript: "不应记录" }), initialVoiceState);
  const unsupported = reduceVoiceState(initialVoiceState, { type: "enable", supported: false });
  assert.equal(unsupported.capture, "unsupported");
  assert.equal(unsupported.enabled, false);
});

test("interim speech signals barge-in and recognition errors are recoverable", () => {
  const listening = reduceVoiceState(reduceVoiceState(initialVoiceState, { type: "enable", supported: true }), { type: "started" });
  const interrupted = reduceVoiceState(listening, { type: "interim-transcript", transcript: "等等" });
  const failed = reduceVoiceState(interrupted, { type: "recognition-error", error: "network" });
  const retrying = reduceVoiceState(failed, { type: "enable", supported: true });
  assert.equal(interrupted.bargeInSequence, 1);
  assert.equal(interrupted.interimTranscript, "等等");
  assert.equal(failed.capture, "error");
  assert.equal(failed.enabled, false);
  assert.match(failed.error ?? "", /网络/);
  assert.equal(retrying.capture, "starting");
  assert.equal(retrying.error, null);
});

test("recognized questions remain unchanged for the EnergyDataAgent path", () => {
  assert.deepEqual(classifyVoiceUtterance("广东有多少已映射光伏设施？"), {
    kind: "query",
    question: "广东有多少已映射光伏设施？",
  });
});

test("simple province and close commands are classified separately", () => {
  assert.deepEqual(classifyVoiceUtterance("切换到广东"), { kind: "dashboard-command", command: { type: "select-province", province: "广东" } });
  assert.deepEqual(classifyVoiceUtterance("关闭问数面板"), { kind: "dashboard-command", command: { type: "close-panel" } });
});

test("analytical questions containing a province and 查看 remain questions", () => {
  const question = "查看广东有多少光伏设施";
  assert.deepEqual(classifyVoiceUtterance(question), { kind: "query", question });
});
