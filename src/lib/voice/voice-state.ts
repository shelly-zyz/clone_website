export type VoiceCaptureState = "off" | "starting" | "listening" | "processing" | "error" | "unsupported";

export type VoiceState = {
  enabled: boolean;
  capture: VoiceCaptureState;
  muted: boolean;
  interimTranscript: string;
  lastTranscript: string;
  error: string | null;
  bargeInSequence: number;
};

export type VoiceEvent =
  | { type: "enable"; supported: boolean }
  | { type: "started" }
  | { type: "interim-transcript"; transcript: string }
  | { type: "final-transcript"; transcript: string }
  | { type: "processing-complete" }
  | { type: "recognition-error"; error: string }
  | { type: "toggle-muted" }
  | { type: "stop" };

export type VoiceDashboardCommand =
  | { type: "select-province"; province: string }
  | { type: "close-panel" };

export type VoiceUtterance =
  | { kind: "query"; question: string }
  | { kind: "dashboard-command"; command: VoiceDashboardCommand };

export const initialVoiceState: VoiceState = {
  enabled: false,
  capture: "off",
  muted: true,
  interimTranscript: "",
  lastTranscript: "",
  error: null,
  bargeInSequence: 0,
};

export function reduceVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === "toggle-muted") return { ...state, muted: !state.muted };
  if (event.type === "stop") return { ...state, enabled: false, capture: "off", interimTranscript: "", error: null };
  if (event.type === "enable") {
    if (!event.supported) return { ...state, enabled: false, capture: "unsupported", error: "当前浏览器不支持语音识别，请继续使用文字问数。" };
    return { ...state, enabled: true, capture: "starting", interimTranscript: "", error: null };
  }
  if (!state.enabled) return state;
  if (event.type === "started") return { ...state, capture: "listening", error: null };
  if (event.type === "interim-transcript") {
    return { ...state, capture: "listening", interimTranscript: event.transcript, bargeInSequence: state.bargeInSequence + 1 };
  }
  if (event.type === "final-transcript") {
    return { ...state, capture: "processing", interimTranscript: "", lastTranscript: event.transcript, bargeInSequence: state.bargeInSequence + 1 };
  }
  if (event.type === "processing-complete") return { ...state, capture: "listening", interimTranscript: "" };
  return { ...state, enabled: false, capture: "error", interimTranscript: "", error: recognitionErrorMessage(event.error) };
}

export function classifyVoiceUtterance(rawTranscript: string): VoiceUtterance {
  const question = rawTranscript.trim();
  const normalized = question.replace(/[，。！？,.!?\s]/g, "");
  if (/^(关闭|退出)(能源)?问数(面板)?$/.test(normalized)) {
    return { kind: "dashboard-command", command: { type: "close-panel" } };
  }
  const province = normalized.match(/^(?:请)?(?:切换|选择|查看|定位|跳转)(?:到)?(全国|新疆|内蒙古|四川|山东|广东)(?:省|市|自治区)?(?:范围|地图)?$/)?.[1];
  if (province) {
    return { kind: "dashboard-command", command: { type: "select-province", province } };
  }
  return { kind: "query", question };
}

export function voiceCaptureLabel(capture: VoiceCaptureState) {
  if (capture === "starting") return "正在请求麦克风";
  if (capture === "listening") return "正在监听，可随时插话";
  if (capture === "processing") return "正在交给 EnergyDataAgent";
  if (capture === "unsupported") return "浏览器不支持语音识别";
  if (capture === "error") return "语音识别已停止";
  return "麦克风已关闭";
}

function recognitionErrorMessage(code: string) {
  if (code === "not-allowed" || code === "service-not-allowed") return "麦克风权限未获允许；可授权后重试，文字问数不受影响。";
  if (code === "audio-capture") return "未检测到可用麦克风；文字问数不受影响。";
  if (code === "network") return "语音识别网络服务不可用；可重试或继续使用文字问数。";
  if (code === "no-speech") return "没有识别到语音；可重新开启麦克风重试。";
  return `语音识别失败（${code || "unknown"}）；可重试或继续使用文字问数。`;
}
