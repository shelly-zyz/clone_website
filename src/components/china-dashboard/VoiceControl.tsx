"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  classifyVoiceUtterance,
  initialVoiceState,
  reduceVoiceState,
  voiceCaptureLabel,
  type VoiceDashboardCommand,
} from "@/lib/voice/voice-state";
import styles from "./china-dashboard.module.css";

type RecognitionResultLike = { isFinal: boolean; 0?: { transcript?: string } };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResultLike> };
type RecognitionErrorLike = { error?: string };
type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionConstructor = new () => RecognitionLike;

export function VoiceControl({
  agentConfigured,
  spokenResponse,
  onQuestion,
  onDashboardCommand,
}: {
  agentConfigured: boolean;
  spokenResponse: string | null;
  onQuestion: (question: string) => Promise<void>;
  onDashboardCommand: (command: VoiceDashboardCommand) => void;
}) {
  const [state, dispatch] = useReducer(reduceVoiceState, initialVoiceState);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const enabledRef = useRef(false);
  const onQuestionRef = useRef(onQuestion);
  const onDashboardCommandRef = useRef(onDashboardCommand);

  useEffect(() => {
    onQuestionRef.current = onQuestion;
    onDashboardCommandRef.current = onDashboardCommand;
  }, [onDashboardCommand, onQuestion]);

  useEffect(() => {
    if (!spokenResponse || state.muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenResponse);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }, [spokenResponse, state.muted]);

  useEffect(() => () => {
    enabledRef.current = false;
    recognitionRef.current?.abort();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const stopCapture = () => {
    enabledRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    dispatch({ type: "stop" });
  };

  const startCapture = () => {
    if (state.enabled) {
      stopCapture();
      return;
    }
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    dispatch({ type: "enable", supported: Boolean(Recognition) });
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.maxAlternatives = 1;
    recognition.onstart = () => dispatch({ type: "started" });
    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        if (result.isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      if (interimTranscript || finalTranscript) window.speechSynthesis.cancel();
      if (interimTranscript) dispatch({ type: "interim-transcript", transcript: interimTranscript });
      if (!finalTranscript) return;
      dispatch({ type: "final-transcript", transcript: finalTranscript });
      const utterance = classifyVoiceUtterance(finalTranscript);
      if (utterance.kind === "dashboard-command") {
        onDashboardCommandRef.current(utterance.command);
        dispatch({ type: "processing-complete" });
        return;
      }
      void onQuestionRef.current(utterance.question).finally(() => dispatch({ type: "processing-complete" }));
    };
    recognition.onerror = (event) => {
      enabledRef.current = false;
      recognitionRef.current = null;
      dispatch({ type: "recognition-error", error: event.error ?? "unknown" });
    };
    recognition.onend = () => {
      if (!enabledRef.current) return;
      enabledRef.current = false;
      recognitionRef.current = null;
      dispatch({ type: "stop" });
    };
    recognitionRef.current = recognition;
    enabledRef.current = true;
    try {
      recognition.start();
    } catch {
      enabledRef.current = false;
      recognitionRef.current = null;
      dispatch({ type: "recognition-error", error: "start-failed" });
    }
  };

  const toggleMute = () => {
    if (!state.muted) window.speechSynthesis.cancel();
    dispatch({ type: "toggle-muted" });
  };

  return (
    <section className={styles.voiceControl} aria-label="语音控制">
      <div className={styles.voiceActions}>
        <button type="button" aria-pressed={state.enabled} disabled={!agentConfigured} onClick={startCapture}>
          <span aria-hidden="true">{state.enabled ? "■" : "●"}</span>
          {state.enabled ? "关闭麦克风" : "开启麦克风"}
        </button>
        <button type="button" aria-pressed={state.muted} onClick={toggleMute}>
          <span aria-hidden="true">{state.muted ? "▱" : "◖"}</span>
          {state.muted ? "AI播报已静音" : "AI播报开启"}
        </button>
      </div>
      <div className={styles.voiceStatus} data-state={state.capture}>
        <i />
        <span>{agentConfigured ? voiceCaptureLabel(state.capture) : "配置智能体后可开启语音"}</span>
      </div>
      {state.interimTranscript ? <p className={styles.voiceTranscript}>正在识别：{state.interimTranscript}</p> : null}
      {state.lastTranscript ? <p className={styles.voiceTranscript}>最近语音：{state.lastTranscript}</p> : null}
      {state.error ? <p className={styles.voiceError}>{state.error}</p> : null}
      <p className={styles.voicePrivacy}>默认不采集。开启后由浏览器语音服务生成文字；本站只把识别文字送入同一受控EnergyIR接口，不保存原始音频。插话会立即停止旧播报。</p>
    </section>
  );
}
