import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, LoaderCircle, Send, Square } from "lucide-react";
import type { DialoguePage } from "../types";
import { splitGraphemes } from "../lib/dialogue";
import { createDialogueAdvanceGate, createDialogueProgress, revealDialogueProgress, visibleDialogueLength } from "../lib/dialoguePlayback";

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
  onSpeakingChange?: (speaking: boolean) => void;
  onAutoPlayChange: (enabled: boolean) => void;
  onAdvance: () => void;
  onSubmit: (message: string) => void;
  onChoice: (message: string) => void;
  onStop: () => void;
  onSound: (kind: "advance" | "send") => void;
}

const FALLBACK_CHOICES = ["举个例子", "换个话题"];

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
  onSpeakingChange,
  onAutoPlayChange,
  onAdvance,
  onSubmit,
  onChoice,
  onStop,
  onSound,
}: DialogueBoxProps) {
  const [progress, setProgress] = useState(() => createDialogueProgress(page));
  const advanceGateRef = useRef(createDialogueAdvanceGate(page));
  const [draft, setDraft] = useState("");
  const fullText = page?.text ?? "";
  const glyphs = useMemo(() => splitGraphemes(fullText), [fullText]);
  const visibleLength = visibleDialogueLength(progress, page, glyphs.length);
  const complete = visibleLength >= glyphs.length;
  const isLastPage = pageTotal === 0 || pageIndex >= pageTotal - 1;
  const canReply = !waiting && complete && isLastPage;
  // Empty model suggestions (including plain-text replies and old saves) must
  // not remove the game's choice UI. These are local, user-initiated defaults.
  const replyChoices = suggestions.length > 0 ? suggestions : FALLBACK_CHOICES;
  const visibleText = useMemo(
    () => glyphs.slice(0, visibleLength).join(""),
    [glyphs, visibleLength],
  );
  const speaking = interactionEnabled && !waiting && !complete && Boolean(fullText);

  useLayoutEffect(() => {
    onSpeakingChange?.(speaking);
    return () => onSpeakingChange?.(false);
  }, [onSpeakingChange, speaking]);

  useLayoutEffect(() => {
    advanceGateRef.current.select(page);
    setProgress(createDialogueProgress(page));
  }, [page]);

  useEffect(() => {
    if (!interactionEnabled || waiting || complete || !fullText) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeSpeed === 0) {
      setProgress((current) => revealDialogueProgress(current, page, glyphs.length, true));
      return;
    }
    const timer = window.setTimeout(
      () => setProgress((current) => revealDialogueProgress(current, page, glyphs.length)),
      typeSpeed,
    );
    return () => window.clearTimeout(timer);
  }, [complete, fullText, glyphs.length, interactionEnabled, page, typeSpeed, visibleLength, waiting]);

  const advancePage = useCallback((withSound: boolean) => {
    if (!interactionEnabled || waiting) return;
    if (!complete) {
      setProgress((current) => revealDialogueProgress(current, page, glyphs.length, true));
      return;
    }
    if (!isLastPage && advanceGateRef.current.request(page)) {
      // AUTO and a manual click can arrive together: advance this page only once.
      if (withSound) onSound("advance");
      onAdvance();
    }
  }, [complete, glyphs.length, interactionEnabled, isLastPage, onAdvance, onSound, page, waiting]);
  const advance = useCallback(() => advancePage(true), [advancePage]);

  useEffect(() => {
    if (!autoPlay || !interactionEnabled || waiting || !complete || isLastPage) return;
    const timer = window.setTimeout(() => advancePage(false), 1_650);
    return () => window.clearTimeout(timer);
  }, [advancePage, autoPlay, complete, interactionEnabled, isLastPage, page, waiting]);

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
    if (!message || !interactionEnabled || !canReply) return;
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

        {canReply && (
          <div className="player-controls">
            <div className="choice-list" aria-label="快捷回复">
              {replyChoices.map((suggestion, index) => (
                <button key={`${suggestion}-${index}`} type="button" onClick={() => {
                  if (interactionEnabled && canReply) onChoice(suggestion);
                }}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {suggestion}
                </button>
              ))}
            </div>
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
