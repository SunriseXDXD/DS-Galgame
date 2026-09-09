import { useRef } from "react";
import { Copy, RotateCcw, X } from "lucide-react";
import type { ChatTurn } from "../types";
import { useFocusTrap } from "../lib/focusTrap";
import { IconButton } from "./IconButton";

interface HistoryDrawerProps {
  open: boolean;
  turns: ChatTurn[];
  onClose: () => void;
  onClear: () => void;
  onCopyResult: (success: boolean) => void;
}

export function HistoryDrawer({ open, turns, onClose, onClear, onCopyResult }: HistoryDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, onClose, open);

  const copyAll = async () => {
    const text = turns
      .map((turn) => `${turn.role === "user" ? "你" : "大肥鱼"}：\n${turn.content}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text || "本轮还没有对话");
      onCopyResult(true);
    } catch {
      onCopyResult(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`drawer-scrim${open ? " is-open" : ""}`}
        onClick={onClose}
        aria-label="关闭对话回想"
        aria-hidden="true"
        tabIndex={-1}
      />
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={`history-drawer${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header>
          <div>
            <span>MEMORY LOG</span>
            <h2 id="history-title">对话回想</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton>
        </header>

        <div className="history-drawer__actions">
          <button type="button" onClick={copyAll} disabled={!turns.length}>
            <Copy size={14} />复制全文
          </button>
          <button type="button" onClick={onClear} disabled={!turns.length}>
            <RotateCcw size={14} />开始新一轮
          </button>
        </div>

        <div className="history-list">
          {!turns.length ? (
            <div className="history-empty">
              <span>○</span>
              <p>还没有留下回想。</p>
              <small>在主界面和她说句话吧。</small>
            </div>
          ) : turns.map((turn, index) => (
            <article key={turn.id} className={`history-entry history-entry--${turn.role}`}>
              <div className="history-entry__meta">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{turn.role === "user" ? "你" : "大肥鱼"}</strong>
                <time>{new Date(turn.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <p>{turn.content}</p>
            </article>
          ))}
        </div>

        <footer>
          本轮回想保留在当前标签页；自动/手动存档与收藏另存本机，可在“存档与回忆馆”管理。设置中的 API Key 不进入剧情记录。
        </footer>
      </aside>
    </>
  );
}
