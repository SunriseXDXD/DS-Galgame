import { describe, expect, it, vi } from "vitest";
import type { DialoguePage } from "../types";
import { splitGraphemes } from "./dialogue";
import { createDialogueAdvanceGate, createDialogueProgress, revealDialogueProgress, visibleDialogueLength } from "./dialoguePlayback";

const page = (id: string, text: string): DialoguePage => ({ id, text, kind: "dialogue" });

describe("page-scoped dialogue completion", () => {
  it("does not unlock a short final page using the preceding long page's completed count", () => {
    const previous = page("page-0", "这一段说明还在前一页。".repeat(8));
    const last = page("page-1", "最后还要讲完这一句。🐳");
    const glyphCount = splitGraphemes(last.text).length;
    const finishedPrevious = revealDialogueProgress(createDialogueProgress(previous), previous, previous.text.length, true);

    // An unscoped count would show the new page as complete before its reset effect.
    expect(finishedPrevious.visibleLength >= glyphCount).toBe(true);
    expect(visibleDialogueLength(finishedPrevious, last, glyphCount)).toBe(0);

    let current = createDialogueProgress(last);
    for (let index = 0; index < glyphCount - 1; index += 1) {
      current = revealDialogueProgress(current, last, glyphCount);
      expect(visibleDialogueLength(current, last, glyphCount) >= glyphCount).toBe(false);
    }
    current = revealDialogueProgress(current, last, glyphCount);
    expect(visibleDialogueLength(current, last, glyphCount)).toBe(glyphCount);
  });

  it("restarts a new reply even when generated page IDs and text are identical", () => {
    const before = page("page-0", "本鲸鱼开始讲解。");
    const after = page("page-0", before.text);
    const completed = revealDialogueProgress(createDialogueProgress(before), before, before.text.length, true);
    expect(visibleDialogueLength(completed, after, after.text.length)).toBe(0);
  });

  it("ignores an old page's queued tick and reveal callback after a board jump", () => {
    const first = page("page-0", "上一板解释。");
    const next = page("page-3", "下一板解释还没有开始。");
    const current = createDialogueProgress(next);
    expect(revealDialogueProgress(current, first, first.text.length)).toBe(current);
    expect(revealDialogueProgress(current, first, first.text.length, true)).toBe(current);
    expect(visibleDialogueLength(current, next, next.text.length)).toBe(0);
  });

  it("reveals a full page for instant text without carrying progress into the following page", () => {
    const first = page("page-0", "无需逐字显示。");
    const next = page("page-1", "第二句。");
    const shown = revealDialogueProgress(createDialogueProgress(first), first, first.text.length, true);
    expect(visibleDialogueLength(shown, first, first.text.length)).toBe(first.text.length);
    expect(visibleDialogueLength(shown, next, next.text.length)).toBe(0);
    expect(revealDialogueProgress(shown, first, first.text.length)).toBe(shown);
  });
});

describe("dialogue advancement event ownership", () => {
  it("advances once when AUTO and a manual click arrive for the same completed page", () => {
    const current = page("page-0", "这句话已读完。");
    const gate = createDialogueAdvanceGate(current);
    const onAdvance = vi.fn();
    const advance = () => { if (gate.request(current)) onAdvance(); };
    advance(); // AUTO timer callback
    advance(); // Click callback before React commits the selected next page
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("rejects an old AUTO callback after a new page is selected", () => {
    const first = page("page-0", "第一句。");
    const next = page("page-1", "第二句还在播放。");
    const gate = createDialogueAdvanceGate(first);
    gate.select(next);
    expect(gate.request(first)).toBe(false);
    expect(gate.request(next)).toBe(true);
    expect(gate.request(next)).toBe(false);
  });

  it("allows reading a previously visited board again without leaving the old advance latch set", () => {
    const first = page("page-0", "第一页。");
    const next = page("page-1", "第二页。");
    const gate = createDialogueAdvanceGate(first);
    expect(gate.request(first)).toBe(true);
    gate.select(next);
    gate.select(first);
    expect(gate.request(first)).toBe(true);
  });
});
