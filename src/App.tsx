import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  CircleHelp,
  History,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { Backdrop } from "./components/Backdrop";
import { Blackboard } from "./components/Blackboard";
import { CharacterStage } from "./components/CharacterStage";
import { DialogueBox } from "./components/DialogueBox";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { IconButton } from "./components/IconButton";
import { SettingsModal } from "./components/SettingsModal";
import { ApiEmptyResponseError, ApiTimeoutError, streamDeepSeek } from "./lib/api";
import {
  API_KEY_STORAGE_KEY,
  clearStoredApiKey,
  loadStoredApiKey,
  updateStoredApiKey,
} from "./lib/apiKeyStorage";
import { demoReply } from "./lib/demo";
import { parseScenePayload, sceneToPages } from "./lib/dialogue";
import { EMOTIONS } from "./types";
import type {
  AssistantScene,
  ChatTurn,
  ConnectionMode,
  ModelId,
  PublicServerConfig,
} from "./types";

const HISTORY_KEY = "jingyu-story-history-v1";
const MODEL_KEY = "jingyu-model-v1";

const WELCOME_SCENE: AssistantScene = {
  mood: "neutral",
  segments: [
    { kind: "narration", text: "夜色沉入深海机房，屏幕深处传来一声懒洋洋的尾鳍拍水声。" },
    { kind: "dialogue", text: "终于来了？本鲸鱼等得饭都快凉了。" },
    { kind: "dialogue", text: "接入 DeepSeek API，我们就认真聊；也可以先在演示模式里看看分镜。" },
  ],
  suggestions: ["接入 API", "你好，在吗？", "你是大肥鱼吗"],
  rawText: "夜色沉入深海机房，屏幕深处传来一声懒洋洋的尾鳍拍水声。\n终于来了？本鲸鱼等得饭都快凉了。\n接入 DeepSeek API，我们就认真聊；也可以先在演示模式里看看分镜。",
};

const DEFAULT_SERVER_CONFIG: PublicServerConfig = {
  byokAllowed: false,
  serverKeyConfigured: false,
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

function loadModel(): ModelId {
  try {
    return sessionStorage.getItem(MODEL_KEY) === "deepseek-v4-pro"
      ? "deepseek-v4-pro"
      : "deepseek-v4-flash";
  } catch {
    return "deepseek-v4-flash";
  }
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function loadHistory(): ChatTurn[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Pick<ChatTurn, "id" | "role" | "content" | "createdAt"> =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        typeof item.createdAt === "number" && Number.isFinite(item.createdAt),
    ).slice(-60).map((item, index) => ({
      id: typeof item.id === "string" ? item.id : `restored-${index}`,
      role: item.role,
      content: item.content.slice(0, 8_000),
      createdAt: item.createdAt,
    }));
  } catch {
    return [];
  }
}

function newTurn(role: ChatTurn["role"], content: string, mood?: ChatTurn["mood"]): ChatTurn {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    mood,
    createdAt: Date.now(),
  };
}

function errorScene(message: string, timedOut = false, emptyResponse = false): AssistantScene {
  const line = timedOut
    ? "海缆好像打了个盹。不是本鲸鱼偷懒——至少这次不是。请稍后再试。"
    : emptyResponse
      ? "DeepSeek 已响应，但两次都没有返回正文。请稍后重试，或在设置中切换模型。"
      : `这次回复没有完成：${message}。可以再试一次，或检查连接设置。`;
  return {
    mood: timedOut ? "sleepy" : "sad",
    segments: [
      { kind: "narration", text: timedOut ? "远处的信号灯熄灭了一瞬。" : "数据流忽然散成了细碎的气泡。" },
      { kind: "dialogue", text: line },
    ],
    suggestions: emptyResponse
      ? ["再试一次", "打开连接设置", "切到演示模式"]
      : ["打开连接设置", "再试一次", "切到演示模式"],
    rawText: line,
  };
}

export default function App() {
  const [initialStoredApiKey] = useState<string | null>(() => loadStoredApiKey());
  const [serverConfig, setServerConfig] = useState(DEFAULT_SERVER_CONFIG);
  const [configReady, setConfigReady] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("demo");
  const [apiKey, setApiKey] = useState(initialStoredApiKey ?? "");
  const [storedApiKey, setStoredApiKey] = useState(initialStoredApiKey);
  const [model, setModel] = useState<ModelId>(loadModel);
  const [history, setHistory] = useState<ChatTurn[]>(loadHistory);
  const [scene, setScene] = useState<AssistantScene>(WELCOME_SCENE);
  const [pageIndex, setPageIndex] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [streamLength, setStreamLength] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoPlay, setAutoPlay] = useState(false);
  const [typeSpeed, setTypeSpeed] = useState(20);
  const [characterSpeaking, setCharacterSpeaking] = useState(false);
  const [apiVerified, setApiVerified] = useState(false);
  const [toast, setToast] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const connectionTouchedRef = useRef(false);
  const retryMessageRef = useRef("");
  const [sessionId] = useState(createSessionId);

  const pages = useMemo(() => sceneToPages(scene), [scene]);
  const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const activeBlackboard = useMemo(() => {
    if (waiting) return undefined;
    for (let index = Math.min(pageIndex, pages.length - 1); index >= 0; index -= 1) {
      if (pages[index]?.blackboard) return pages[index].blackboard;
    }
    return undefined;
  }, [pageIndex, pages, waiting]);
  const stageMood = waiting ? "thinking" : activePage?.mood ?? scene.mood;
  const overlayOpen = settingsOpen || historyOpen;
  const apiKeyRemembered = storedApiKey !== null;

  const openSettings = useCallback(() => {
    setHistoryOpen(false);
    setSettingsOpen(true);
  }, []);

  const openHistory = useCallback(() => {
    setSettingsOpen(false);
    setHistoryOpen(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { headers: { Accept: "application/json" }, signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((config: Partial<PublicServerConfig>) => {
        const safeConfig: PublicServerConfig = {
          byokAllowed: config.byokAllowed === true,
          serverKeyConfigured: config.serverKeyConfigured === true,
          models: Array.isArray(config.models)
            ? config.models.filter((item): item is ModelId => item === "deepseek-v4-flash" || item === "deepseek-v4-pro")
            : [],
        };
        setServerConfig(safeConfig);
        if (safeConfig.models.length) {
          setModel((current) => safeConfig.models.includes(current) ? current : safeConfig.models[0]);
        }
        setConnectionMode((current) => {
          if (current === "byok" && !safeConfig.byokAllowed) {
            return safeConfig.serverKeyConfigured ? "server" : "demo";
          }
          if (current === "server" && !safeConfig.serverKeyConfigured) {
            return safeConfig.byokAllowed ? "byok" : "demo";
          }
          if (!connectionTouchedRef.current) {
            if (safeConfig.serverKeyConfigured) return "server";
            if (safeConfig.byokAllowed && initialStoredApiKey) return "byok";
          }
          return current;
        });
        setConfigReady(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setServerConfig(DEFAULT_SERVER_CONFIG);
        setConnectionMode("demo");
        setConfigReady(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const syncStoredApiKey = (event: StorageEvent) => {
      if (event.key !== null && event.key !== API_KEY_STORAGE_KEY) return;
      if (event.key === null && !apiKeyRemembered) return;
      const nextStoredApiKey = loadStoredApiKey();
      if (connectionMode === "byok") {
        abortRef.current?.abort("configuration");
        setApiVerified(false);
      }
      connectionTouchedRef.current = true;
      setStoredApiKey(nextStoredApiKey);
      setApiKey(nextStoredApiKey ?? "");
      if (nextStoredApiKey === null) {
        setConnectionMode((current) => current === "byok" ? "demo" : current);
        setToast("已同步另一标签页的本地 Key 清除操作");
      } else {
        setToast("已同步另一标签页更新的 API Key");
      }
    };
    window.addEventListener("storage", syncStoredApiKey);
    return () => window.removeEventListener("storage", syncStoredApiKey);
  }, [apiKeyRemembered, connectionMode]);

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-60)));
    } catch {
      // Storage may be disabled or full; the in-memory conversation still works.
    }
  }, [history]);

  useEffect(() => {
    try {
      sessionStorage.setItem(MODEL_KEY, model);
    } catch {
      // Model persistence is optional.
    }
  }, [model]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        overlayOpen || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
        target?.closest("button, a, input, textarea, select, [contenteditable='true'], [tabindex]")
      ) return;
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        openHistory();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openHistory, overlayOpen]);

  const playSound = useCallback((kind: "advance" | "send") => {
    if (!soundEnabled) return;
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      const context = audioRef.current || new AudioContextConstructor();
      audioRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(kind === "send" ? 620 : 420, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "send" ? 880 : 520, context.currentTime + 0.055);
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
    } catch {
      // Audio is decorative and may be blocked by browser policy.
    }
  }, [soundEnabled]);

  const showScene = useCallback((nextScene: AssistantScene) => {
    setScene(nextScene);
    setPageIndex(0);
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || waiting) return;

    if (/^(接入|打开).*(API|连接|设置)/i.test(trimmed)) {
      openSettings();
      return;
    }
    if (/切到演示模式/.test(trimmed)) {
      connectionTouchedRef.current = true;
      setConnectionMode("demo");
      if (!apiKeyRemembered) setApiKey("");
      setApiVerified(false);
      setToast("已切换到演示模式");
      return;
    }
    if (
      (connectionMode === "byok" && (!configReady || !serverConfig.byokAllowed)) ||
      (connectionMode === "server" && (!configReady || !serverConfig.serverKeyConfigured))
    ) {
      setToast("连接配置不可用，请重新选择");
      openSettings();
      return;
    }

    const userTurn = newTurn("user", trimmed);
    retryMessageRef.current = "";
    const pendingHistory = [...history, userTurn].slice(-60);
    setHistory(pendingHistory);
    setWaiting(true);
    setStreamLength(0);

    const controller = new AbortController();
    abortRef.current = controller;
    const clientTimeout = window.setTimeout(() => controller.abort("timeout"), 95_000);

    try {
      const nextScene = connectionMode === "demo"
        ? await demoReply(trimmed, controller.signal)
        : parseScenePayload(await streamDeepSeek({
          apiKey: connectionMode === "byok" ? apiKey : "",
          authMode: connectionMode,
          sessionId,
          model,
          messages: pendingHistory,
          signal: controller.signal,
          onDelta: (content) => setStreamLength(content.length),
        }));

      if (controller.signal.aborted) {
        setHistory((current) => current.filter((turn) => turn.id !== userTurn.id));
        if (controller.signal.reason === "user") setToast("已停止生成");
        return;
      }
      showScene(nextScene);
      setHistory((current) => [...current, newTurn("assistant", nextScene.rawText, nextScene.mood)].slice(-60));
      if (connectionMode !== "demo") setApiVerified(true);
    } catch (error) {
      const abortedByClient = controller.signal.aborted;
      const cancelReason = controller.signal.reason;
      const canceled = cancelReason === "user" || cancelReason === "configuration" || cancelReason === "clear";
      if (canceled) {
        setHistory((current) => current.filter((turn) => turn.id !== userTurn.id));
        if (cancelReason === "user") setToast("已停止生成");
        return;
      }
      retryMessageRef.current = trimmed;
      setHistory((current) => current.filter((turn) => turn.id !== userTurn.id));
      const messageText = error instanceof Error ? error.message : "未知错误";
      const timedOut = error instanceof ApiTimeoutError || (abortedByClient && cancelReason === "timeout");
      const emptyResponse = error instanceof ApiEmptyResponseError;
      const nextScene = errorScene(messageText, timedOut, emptyResponse);
      showScene(nextScene);
      if (!emptyResponse) setApiVerified(false);
    } finally {
      window.clearTimeout(clientTimeout);
      if (abortRef.current === controller) abortRef.current = null;
      setWaiting(false);
      setStreamLength(0);
    }
  }, [apiKey, apiKeyRemembered, configReady, connectionMode, history, model, openSettings, serverConfig.byokAllowed, serverConfig.serverKeyConfigured, sessionId, showScene, waiting]);

  const handleChoice = (choice: string) => {
    if (/接入 API|打开连接设置/.test(choice)) {
      openSettings();
      return;
    }
    if (choice === "再试一次" && retryMessageRef.current) {
      void sendMessage(retryMessageRef.current);
      return;
    }
    void sendMessage(choice);
  };

  const clearHistory = () => {
    abortRef.current?.abort("clear");
    retryMessageRef.current = "";
    setHistory([]);
    showScene(WELCOME_SCENE);
    setHistoryOpen(false);
    setToast("新的一轮开始了");
  };

  const connectionLabel = connectionMode === "demo"
    ? "演示模式"
    : apiVerified
      ? "API 在线"
      : connectionMode === "server"
        ? "服务端待命"
        : "本地密钥待命";

  return (
    <div className="game-shell" data-mood={stageMood}>
      <Backdrop />

      <header className="game-header" inert={overlayOpen ? true : undefined}>
        <button type="button" className="brand" onClick={() => showScene(WELCOME_SCENE)} aria-label="返回序章">
          <span className="brand__mark"><Waves size={24} strokeWidth={1.6} /></span>
          <span className="brand__words"><strong>鲸语</strong><small>WHALE / LOGUE</small></span>
        </button>
        <div className="chapter-label">
          <small>CHAPTER 01</small>
          <span>深海机房的来客</span>
        </div>
        <div className="header-spacer" />
        <button
          type="button"
          className={`connection-pill connection-pill--${connectionMode}`}
          onClick={openSettings}
          aria-label={`连接设置：${connectionLabel}`}
        >
          <i />
          <span>{connectionLabel}</span>
          <small>{connectionMode === "demo" ? "LOCAL" : model.replace("deepseek-", "")}</small>
        </button>
        <div className="header-actions">
          <IconButton label="新对话" onClick={clearHistory}><RotateCcw size={18} /></IconButton>
          <IconButton label="对话回想" onClick={openHistory}><History size={18} /></IconButton>
          <IconButton label={soundEnabled ? "关闭音效" : "开启音效"} onClick={() => setSoundEnabled((value) => !value)}>
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </IconButton>
          <IconButton label="设置" onClick={openSettings}><Settings size={18} /></IconButton>
        </div>
      </header>

      <main
        className={`game-stage${activeBlackboard ? " game-stage--blackboard" : ""}`}
        inert={overlayOpen ? true : undefined}
      >
        <div className="location-card">
          <span>LOCATION / 01</span>
          <strong>深海机房 · 夜</strong>
          <small>SEA LEVEL − 8,192 M</small>
        </div>

        <div className="side-note side-note--left">
          <BookOpenText size={14} />
          <span>点击文本框继续</span>
        </div>
        <div className="side-note side-note--right">
          <CircleHelp size={14} />
          <span>H · 对话回想</span>
        </div>

        <CharacterStage
          mood={stageMood}
          busy={waiting}
          page={activePage}
          speaking={characterSpeaking}
          interactionEnabled={!overlayOpen}
          typeSpeed={typeSpeed}
          blackboard={activeBlackboard}
        />
        <Blackboard content={activeBlackboard} />

        <DialogueBox
          page={activePage}
          pageIndex={pageIndex}
          pageTotal={pages.length}
          suggestions={scene.suggestions}
          waiting={waiting}
          streamLength={streamLength}
          typeSpeed={typeSpeed}
          autoPlay={autoPlay}
          interactionEnabled={!overlayOpen}
          onSpeakingChange={setCharacterSpeaking}
          onAutoPlayChange={setAutoPlay}
          onAdvance={() => setPageIndex((index) => Math.min(index + 1, pages.length - 1))}
          onSubmit={(message) => void sendMessage(message)}
          onChoice={handleChoice}
          onStop={() => abortRef.current?.abort("user")}
          onSound={playSound}
        />
      </main>

      <footer className="game-footer" inert={overlayOpen ? true : undefined}>
        <span><i /> AI 生成内容</span>
        <span>非官方同人原型 · 本地静态差分</span>
        <span className="game-footer__art">ART / STATIC ×{EMOTIONS.length}</span>
      </footer>

      {settingsOpen && (
        <SettingsModal
          open
          mode={connectionMode}
          model={model}
          apiKey={apiKey}
          rememberApiKey={apiKeyRemembered}
          typeSpeed={typeSpeed}
          serverConfig={serverConfig}
          configReady={configReady}
          onClose={() => setSettingsOpen(false)}
          onSaveConnection={(nextMode, nextKey, nextModel, shouldRememberApiKey) => {
            abortRef.current?.abort("configuration");
            connectionTouchedRef.current = true;
            const storageUpdate = updateStoredApiKey(
              nextKey,
              shouldRememberApiKey,
              storedApiKey,
            );
            const nextStoredApiKey = storageUpdate.persistedApiKey;
            let storageNotice = "";
            if (storageUpdate.status === "write_failed") {
              storageNotice = storageUpdate.staleValueMayRemain
                ? "新 Key 未写入，旧 Key 可能仍保存在本地；请一键忘记或清理站点数据"
                : "连接已保存，但此浏览器无法记住 Key";
            } else if (storageUpdate.status === "clear_failed") {
              storageNotice = "无法确认删除，旧 Key 可能仍保存在本地；请清理浏览器站点数据";
            }
            const appliedKey = storageUpdate.staleValueMayRemain && nextStoredApiKey !== null
              ? nextStoredApiKey
              : nextKey;
            setConnectionMode(nextMode);
            setApiKey(nextMode === "byok" || nextStoredApiKey !== null ? appliedKey : "");
            setStoredApiKey(nextStoredApiKey);
            setModel(nextModel);
            setApiVerified(false);
            setToast(storageNotice || (nextMode === "demo" ? "演示模式已就绪" : "连接配置已保存"));
          }}
          onForgetApiKey={() => {
            if (connectionMode === "byok") {
              abortRef.current?.abort("configuration");
              setConnectionMode("demo");
              setApiVerified(false);
            }
            connectionTouchedRef.current = true;
            const removed = clearStoredApiKey();
            setApiKey(removed ? "" : storedApiKey ?? "");
            if (removed) setStoredApiKey(null);
            setToast(removed
              ? "已从这台设备忘记 API Key"
              : "无法确认删除，旧 Key 可能仍保存在本地；请清理浏览器站点数据");
            return removed;
          }}
          onTypeSpeedChange={setTypeSpeed}
        />
      )}

      {historyOpen && (
        <HistoryDrawer
          open
          turns={history}
          onClose={() => setHistoryOpen(false)}
          onClear={clearHistory}
          onCopyResult={(success) => setToast(success ? "回想已复制" : "复制失败，请手动选择文本")}
        />
      )}

      <div className={`toast${toast ? " is-visible" : ""}`} role="status">{toast}</div>
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
