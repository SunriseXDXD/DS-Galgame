import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CornerDownLeft, LoaderCircle, Send, Square } from "lucide-react";
import type { DialoguePage } from "../types";
import { splitGraphemes } from "../lib/dialogue";

interface DialogueBoxProps {
  page?: DialoguePage;
  pageIndex: number;
  pageTotal: number;
  suggestions: string[];
  waiting: boolean;
  streamLength: number;
  typeSpeed: number;
  autoPlay: boolean;
  interactionEnabled: boolean;
  onAutoPlayChange: (enabled: boolean) => void;
  onAdvance: () => void;
  onSubmit: (message: string) => void;
  onChoice: (message: string) => void;
  onStop: () => void;
  onSound: (kind: "advance" | "send") => void;
}

function speakerFor(kind: DialoguePage["kind"] | undefined): string {
  if (kind === "narration") return "旁白";
  if (kind === "thought") return "大肥鱼 · 心声";
  return "大肥鱼";
}

export function DialogueBox({
  page,
  pageIndex,
  pageTotal,
  suggestions,
  waiting,
  streamLength,
  typeSpeed,
  autoPlay,
  interactionEnabled,
  onAutoPlayChange,
  onAdvance,
  onSubmit,
  onChoice,
  onStop,
  onSound,
}: DialogueBoxProps) {
  const [visibleLength, setVisibleLength] = useState(0);
  const [draft, setDraft] = useState("");
  const fullText = page?.text ?? "";
  const glyphs = useMemo(() => splitGraphemes(fullText), [fullText]);
  const complete = visibleLength >= glyphs.length;
  const isLastPage = pageTotal === 0 || pageIndex >= pageTotal - 1;
  const visibleText = useMemo(
    () => glyphs.slice(0, visibleLength).join(""),
    [glyphs, visibleLength],
  );

  useLayoutEffect(() => {
    setVisibleLength(0);
  }, [page]);

  useEffect(() => {
    if (!interactionEnabled || waiting || complete || !fullText) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeSpeed === 0) {
      setVisibleLength(glyphs.length);
      return;
    }
    const timer = window.setTimeout(
      () => setVisibleLength((length) => Math.min(length + 1, glyphs.length)),
      typeSpeed,
    );
    return () => window.clearTimeout(timer);
  }, [complete, fullText, glyphs.length, interactionEnabled, typeSpeed, visibleLength, waiting]);

  useEffect(() => {
    if (!autoPlay || !interactionEnabled || waiting || !complete || isLastPage) return;
    const timer = window.setTimeout(onAdvance, 1_650);
    return () => window.clearTimeout(timer);
  }, [autoPlay, complete, interactionEnabled, isLastPage, onAdvance, waiting]);

  const advance = useCallback(() => {
    if (waiting) return;
    if (!complete) {
      setVisibleLength(glyphs.length);
      return;
    }
    if (!isLastPage) {
      onSound("advance");
      onAdvance();
    }
  }, [complete, glyphs.length, isLastPage, onAdvance, onSound, waiting]);

  useEffect(() => {
    if (!interactionEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
        target?.closest("button, a, input, textarea, select, [contenteditable='true'], [tabindex]")
      ) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, interactionEnabled]);

  const submit = () => {
    const message = draft.trim();
    if (!message || waiting) return;
    onSound("send");
    onSubmit(message);
    setDraft("");
  };

  return (
    <section className="dialogue-wrap" aria-label="对话区域">
      <div
        className={`dialogue-box dialogue-box--${page?.kind || "dialogue"}`}
        onClick={(event) => {
          if ((event.target as Element).closest("button, a, textarea")) return;
          advance();
        }}
      >
        <div className="dialogue-box__topline" aria-hidden="true" />
        <div className="speaker-tag">
          <span>{speakerFor(page?.kind)}</span>
          <small>{page?.kind === "narration" ? "SCENE" : "CETACEA_01"}</small>
        </div>
        <div className="dialogue-tools">
          <button
            type="button"
            className={autoPlay ? "tool-toggle is-active" : "tool-toggle"}
            onClick={() => onAutoPlayChange(!autoPlay)}
            aria-pressed={autoPlay}
          >
            AUTO
          </button>
          <span className="page-count">
            {String(Math.min(pageIndex + 1, Math.max(pageTotal, 1))).padStart(2, "0")}
            <i />
            {String(Math.max(pageTotal, 1)).padStart(2, "0")}
          </span>
        </div>

        <div className="dialogue-content">
          {waiting ? (
            <div className="thinking-line">
              <LoaderCircle className="spin" size={21} aria-hidden="true" />
              <div aria-hidden="true">
                <strong>正在把回答编排成分镜</strong>
                <span>
                  {streamLength > 0 ? `海缆已收到 ${streamLength} 个字符` : "尾鳍正在努力划水……"}
                </span>
              </div>
              <button type="button" className="stop-button" onClick={onStop}>
                <Square size={12} fill="currentColor" />
                停止
              </button>
            </div>
          ) : (
            <p aria-hidden="true">
              {visibleText}
              {!complete && <span className="type-caret" />}
            </p>
          )}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {waiting ? "正在把回答编排成分镜" : `${speakerFor(page?.kind)}：${fullText}`}
          </span>
        </div>

        {!waiting && complete && !isLastPage && (
          <button type="button" className="continue-hint" onClick={advance}>
            继续
            <span>›</span>
          </button>
        )}

        {!waiting && complete && isLastPage && (
          <div className="player-controls">
            {suggestions.length > 0 && (
              <div className="choice-list" aria-label="快捷回复">
                {suggestions.map((suggestion, index) => (
                  <button key={`${suggestion}-${index}`} type="button" onClick={() => onChoice(suggestion)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="message-composer">
              <textarea
                value={draft}
                rows={1}
                maxLength={4_000}
                placeholder="对大肥鱼说点什么……"
                aria-label="输入消息"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" && !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <span className="composer-tip">
                <CornerDownLeft size={12} /> Enter
              </span>
              <button type="button" className="send-button" onClick={submit} disabled={!draft.trim()} aria-label="发送消息">
                <Send size={17} />
                <span>发送</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
