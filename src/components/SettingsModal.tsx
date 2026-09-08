import { useEffect, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import type { ConnectionMode, ModelId, PublicServerConfig } from "../types";
import { validateByokApiKey } from "../lib/api";
import { PERSONA_LOAD, PERSONA_TAGS } from "../lib/persona";
import { useFocusTrap } from "../lib/focusTrap";
import { IconButton } from "./IconButton";

type SettingsTab = "connect" | "persona" | "about";

interface SettingsModalProps {
  open: boolean;
  mode: ConnectionMode;
  model: ModelId;
  apiKey: string;
  typeSpeed: number;
  serverConfig: PublicServerConfig;
  configReady: boolean;
  onClose: () => void;
  onSaveConnection: (mode: ConnectionMode, key: string, model: ModelId) => void;
  onTypeSpeedChange: (speed: number) => void;
}

export function SettingsModal({
  open,
  mode,
  model,
  apiKey,
  typeSpeed,
  serverConfig,
  configReady,
  onClose,
  onSaveConnection,
  onTypeSpeedChange,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("connect");
  const [draftMode, setDraftMode] = useState<ConnectionMode>(mode);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftModel, setDraftModel] = useState<ModelId>(model);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  useFocusTrap(dialogRef, onClose, open);

  useEffect(() => {
    if (!open) return;
    setDraftMode(mode);
    setDraftKey(apiKey);
    setDraftModel(model);
    setShowKey(false);
    setError("");
  }, [apiKey, mode, model, open]);

  useEffect(() => {
    if (!open) return;
    if (!configReady && draftMode !== "demo") {
      setDraftMode("demo");
      setDraftKey("");
      setShowKey(false);
      return;
    }
    if (draftMode === "byok" && !serverConfig.byokAllowed) {
      setDraftMode(serverConfig.serverKeyConfigured ? "server" : "demo");
      setDraftKey("");
      setShowKey(false);
    } else if (draftMode === "server" && !serverConfig.serverKeyConfigured) {
      setDraftMode(serverConfig.byokAllowed ? "byok" : "demo");
    }
  }, [configReady, draftMode, open, serverConfig.byokAllowed, serverConfig.serverKeyConfigured]);

  if (!open) return null;

  const save = () => {
    const trimmedKey = draftKey.trim();
    if (!configReady && draftMode !== "demo") {
      setError("连接配置尚未加载，请稍后再试");
      return;
    }
    if (draftMode === "byok" && !serverConfig.byokAllowed) {
      setDraftKey("");
      setDraftMode("demo");
      setShowKey(false);
      setError("当前环境不允许浏览器提供 API Key");
      return;
    }
    if (draftMode === "server" && !serverConfig.serverKeyConfigured) {
      setDraftMode("demo");
      setError("服务端尚未配置 API Key");
      return;
    }
    if (draftMode === "byok") {
      const validationError = validateByokApiKey(trimmedKey);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    onSaveConnection(draftMode, trimmedKey, draftModel);
    onClose();
  };

  return (
    <div className="modal-layer" role="presentation">
      <button type="button" className="modal-scrim" onClick={onClose} aria-label="关闭设置" />
      <section ref={dialogRef} tabIndex={-1} className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-modal__header">
          <div>
            <span>TERMINAL / CONFIG</span>
            <h2 id="settings-title">鲸语控制台</h2>
          </div>
          <IconButton label="关闭设置" onClick={onClose}><X size={20} /></IconButton>
        </header>

        <nav className="settings-tabs" aria-label="设置分类" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "connect"} className={tab === "connect" ? "is-active" : ""} onClick={() => setTab("connect")}>连接</button>
          <button type="button" role="tab" aria-selected={tab === "persona"} className={tab === "persona" ? "is-active" : ""} onClick={() => setTab("persona")}>人设</button>
          <button type="button" role="tab" aria-selected={tab === "about"} className={tab === "about" ? "is-active" : ""} onClick={() => setTab("about")}>关于</button>
        </nav>

        <div className="settings-modal__body">
          {tab === "connect" && (
            <div className="settings-panel">
              <div className="mode-cards">
                <button type="button" aria-pressed={draftMode === "demo"} className={draftMode === "demo" ? "mode-card is-active" : "mode-card"} onClick={() => { setDraftMode("demo"); setDraftKey(""); setShowKey(false); }}>
                  <Sparkles size={19} />
                  <span><strong>演示模式</strong><small>无需 Key，体验预设分镜</small></span>
                  {draftMode === "demo" && <Check size={17} />}
                </button>
                <button
                  type="button"
                  aria-pressed={draftMode === "byok"}
                  className={draftMode === "byok" ? "mode-card is-active" : "mode-card"}
                  onClick={() => serverConfig.byokAllowed && configReady && setDraftMode("byok")}
                  disabled={!configReady || !serverConfig.byokAllowed}
                >
                  <KeyRound size={19} />
                  <span><strong>我的 API</strong><small>{!configReady ? "正在读取配置" : serverConfig.byokAllowed ? "仅限本地 / 自托管" : "当前环境已关闭"}</small></span>
                  {draftMode === "byok" && <Check size={17} />}
                </button>
                <button
                  type="button"
                  aria-pressed={draftMode === "server"}
                  className={draftMode === "server" ? "mode-card is-active" : "mode-card"}
                  onClick={() => { if (serverConfig.serverKeyConfigured && configReady) { setDraftMode("server"); setDraftKey(""); setShowKey(false); } }}
                  disabled={!configReady || !serverConfig.serverKeyConfigured}
                >
                  <Server size={19} />
                  <span><strong>服务端密钥</strong><small>{!configReady ? "正在读取配置" : serverConfig.serverKeyConfigured ? "已由服务器安全配置" : "尚未配置"}</small></span>
                  {draftMode === "server" && <Check size={17} />}
                </button>
              </div>

              {draftMode === "byok" && (
                <label className="field-label">
                  <span>DeepSeek API Key</span>
                  <div className="secret-input">
                    <LockKeyhole size={17} />
                    <input
                      autoFocus
                      type={showKey ? "text" : "password"}
                      value={draftKey}
                      maxLength={512}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-••••••••••••••••"
                      onChange={(event) => {
                        setDraftKey(event.target.value);
                        setError("");
                      }}
                    />
                    <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏密钥" : "显示密钥"}>
                      {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                  <small className="privacy-note">
                    Key 仅存在本页内存中，刷新即清除。本应用不会主动记录；部署方仍须擦除代理与 APM 中的敏感请求头。
                  </small>
                </label>
              )}

              {draftMode !== "demo" && (
                <label className="field-label">
                  <span>模型</span>
                  <select value={draftModel} onChange={(event) => setDraftModel(event.target.value as ModelId)}>
                    {serverConfig.models.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId === "deepseek-v4-flash" ? "DeepSeek V4 Flash · 推荐" : "DeepSeek V4 Pro · 更强"}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="setting-row">
                <div><strong>文字速度 · 立即生效</strong><small>{typeSpeed === 0 ? "瞬间显示" : `${typeSpeed} ms / 字`}</small></div>
                <input
                  type="range"
                  min="0"
                  max="45"
                  step="5"
                  value={typeSpeed}
                  aria-label="文字速度"
                  onChange={(event) => onTypeSpeedChange(Number(event.target.value))}
                />
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="settings-actions">
                <a href="https://api-docs.deepseek.com/zh-cn/" target="_blank" rel="noreferrer">
                  官方 API 文档 <ExternalLink size={13} />
                </a>
                <button type="button" className="primary-button" onClick={save}>保存并返回</button>
              </div>
            </div>
          )}

          {tab === "persona" && (
            <div className="settings-panel persona-panel">
              <div className="persona-intro">
                <span className="persona-avatar">鲸</span>
                <div>
                  <p>PERSONA / CETACEA_01</p>
                  <h3>聪明，但想先吃饭</h3>
                  <small>固定角色协议会作为每次会话的 system prompt 注入。</small>
                </div>
              </div>
              <div className="persona-tags">
                {PERSONA_TAGS.map(([label, value]) => (
                  <div key={label}><span>{label}</span><strong>{value}</strong></div>
                ))}
              </div>
              <div className="protocol-box">
                <div><span>载入协议</span><small>这些标记会被翻译为自然语言规则，并非 API 原生命令。</small></div>
                <pre>{PERSONA_LOAD}</pre>
              </div>
              <p className="persona-footnote">
                「绝对服从」被解释为尽力完成任务，但不会越过安全、隐私与事实边界；角色设定为成年鲸鱼少女，轻萌标签不用于年龄或性化设定。
              </p>
            </div>
          )}

          {tab === "about" && (
            <div className="settings-panel about-panel">
              <div className="unofficial-notice">
                <strong>非官方 · 非商业同人原型</strong>
                <p>本项目与深度求索（DeepSeek）不存在合作、赞助或背书关系。界面中的模型回答均为 AI 生成内容。</p>
              </div>
              <h3>美术与灵感</h3>
              <p>十六张透明静态差分以用户提供的原始形象为母版，由项目使用图像生成工具辅助重绘，并在本地完成去底与统一尺寸；运行时不热链第三方素材。</p>
              <div className="credit-links">
                <a href="https://www.3dmgame.com/original/3746336.html" target="_blank" rel="noreferrer">大肥鱼梗文化考据 <ExternalLink size={13} /></a>
                <a href="https://ai-meme.cdqyfdbymn.me/" target="_blank" rel="noreferrer">梗鲸社区参考 <ExternalLink size={13} /></a>
              </div>
              <h3>隐私提示</h3>
              <p>当前对话会保存在本标签页的 sessionStorage，关闭标签页或点击「开始新一轮」即可清除。发送给模型的内容会按 DeepSeek 的服务条款处理，请勿输入敏感个人信息。立绘由本站同源加载，不会为了切换表情联系第三方素材站。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
