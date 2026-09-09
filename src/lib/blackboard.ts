import type { BlackboardContent, DialoguePage } from "../types";

export interface BlackboardPresentation {
  dialogueText: string;
  blackboard?: BlackboardContent | null;
}

export interface BlackboardState {
  content?: BlackboardContent;
  step?: { current: number; total: number };
  previousPageIndex?: number;
  nextPageIndex?: number;
}

const PRESENTATION_BLOCK = /```([^\n`]*)\n([\s\S]*?)```|^[ \t]*\$\$([\s\S]*?)\$\$[ \t]*(?=\n|$)|^[ \t]*\\\[([\s\S]*?)\\\][ \t]*(?=\n|$)/gm;
const MARKDOWN_LANGUAGE = /^(?:md|mdown|markdown)$/i;
const MATH_LANGUAGE = /^(?:latex|math|tex)$/i;
const MARKDOWN_LINE = /^(?:#{1,6}\s+|>\s+|[-+*]\s+|\d+[.)]\s+)/;
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function blackboardDialogueFallback(kind: BlackboardContent["kind"]): string {
  if (kind === "code") return "代码已经写在黑板上了。";
  if (kind === "math") return "先看黑板上的这个公式，本鲸鱼慢慢讲。";
  return "整理好的内容已经放在黑板上了。";
}

function titleFor(kind: BlackboardContent["kind"], language = ""): string {
  if (kind === "markdown") return "鲸鱼笔记";
  if (kind === "math") return "鲸鱼公式课堂";
  return language ? `${language.toUpperCase()} 代码` : "代码输出";
}

/** Reject an invalid/oversized board as a unit: slicing can break TeX or code. */
export function normalizeBlackboard(value: unknown): BlackboardContent | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.kind !== "code" && item.kind !== "markdown" && item.kind !== "math") return undefined;
  if (typeof item.content !== "string" || !item.content.trim() || Array.from(item.content).length > 16_000) {
    return undefined;
  }
  if (item.title !== undefined && (typeof item.title !== "string" || Array.from(item.title).length > 80)) {
    return undefined;
  }
  if (item.language !== undefined && (
    typeof item.language !== "string" || !/^[A-Za-z0-9_+.-]{0,20}$/.test(item.language)
  )) return undefined;
  return {
    kind: item.kind,
    content: item.content.replace(/\r\n?/g, "\n"),
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    ...(typeof item.language === "string" ? { language: item.language } : {}),
  };
}

function markdownStart(lines: string[]): number {
  const starts = [lines.findIndex((line) => /^#{1,6}\s+/.test(line.trimStart()))];
  const tableDivider = lines.findIndex((line) => TABLE_DIVIDER.test(line));
  if (tableDivider > 0 && lines[tableDivider - 1]?.includes("|")) starts.push(tableDivider - 1);
  const marked = lines
    .map((line, index) => MARKDOWN_LINE.test(line.trimStart()) ? index : -1)
    .filter((index) => index >= 0);
  if (marked.length >= 2) starts.push(marked[0]);
  return Math.min(...starts.filter((index) => index >= 0), Infinity);
}

function containsInlineMath(text: string): boolean {
  // Dollar amounts and code spans should remain ordinary dialogue/code.
  const withoutCode = text.replace(/(`+)[\s\S]*?\1/g, "");
  if (/(?:^|[^\\])(?:\\\\)*\\(?:\([\s\S]+?\\\)|\[[\s\S]+?\\\])/.test(withoutCode)) return true;
  if (/(?:^|[^\\$])(?:\\\\)*\$\$[\s\S]+?\$\$(?!\$)/.test(withoutCode)) return true;
  return Array.from(withoutCode.matchAll(/(?:^|[^\\$])\$(?![\s$])([^$\n]+?)\$(?!\$)/g))
    .some((match) => !/\s$/.test(match[1]));
}

function markdownBoard(content: string): BlackboardContent {
  return { kind: "markdown", content, title: titleFor("markdown") };
}

function extractProse(source: string): BlackboardPresentation[] {
  const text = normalizeText(source);
  if (!text) return [];
  const lines = text.split("\n");
  const start = markdownStart(lines);
  if (!Number.isFinite(start)) {
    if (!containsInlineMath(text)) return [{ dialogueText: text }];
    // A display environment can itself contain blank lines. Keep this whole
    // prose block rather than splitting a formula at a paragraph boundary.
    return [{ dialogueText: blackboardDialogueFallback("math"), blackboard: markdownBoard(text) }];
  }

  const prefix = lines.slice(0, start).join("\n").trim();
  const result = containsInlineMath(prefix) ? extractProse(prefix) : [];
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines.slice(start)) {
    if (/^#{1,6}\s+/.test(line.trimStart()) && current.some((part) => part.trim())) {
      sections.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some((part) => part.trim())) sections.push(current.join("\n").trim());
  sections.forEach((content, index) => result.push({
    dialogueText: index === 0 && prefix && !containsInlineMath(prefix)
      ? prefix : blackboardDialogueFallback("markdown"),
    blackboard: markdownBoard(content),
  }));
  return result;
}

/**
 * One ordered presentation per complete code/math/Markdown block. Narration
 * between blocks stays between them; a later board is never revealed early.
 */
export function extractBlackboardPresentations(source: string): BlackboardPresentation[] {
  const normalized = normalizeText(source);
  if (!normalized) return [{ dialogueText: "" }];
  const matches = Array.from(normalized.matchAll(PRESENTATION_BLOCK));
  if (!matches.length) return extractProse(normalized);
  const result: BlackboardPresentation[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const prose = extractProse(normalized.slice(cursor, match.index));
    const rawLanguage = match[1];
    const language = (rawLanguage?.trim().split(/\s+/)[0] || "")
      .replace(/[^a-z0-9_+.-]/gi, "").toLowerCase().slice(0, 20);
    const kind = rawLanguage === undefined || MATH_LANGUAGE.test(language)
      ? "math" : MARKDOWN_LANGUAGE.test(language) ? "markdown" : "code";
    const content = (match[2] ?? match[3] ?? match[4] ?? "").replace(/\s+$/, "");
    cursor = (match.index ?? 0) + match[0].length;
    if (!content.trim()) {
      result.push(...prose);
      return;
    }
    const blackboard: BlackboardContent = {
      kind, content,
      ...(kind === "code" && language ? { language } : {}),
      title: titleFor(kind, language),
    };
    // The initial introduction can accompany the first board, as before. Any
    // later interleaved explanation remains on the previously revealed board.
    const introduction = index === 0 && prose.length === 1 && prose[0].blackboard === undefined
      ? prose[0].dialogueText : undefined;
    if (introduction === undefined) result.push(...prose);
    result.push({ dialogueText: introduction || blackboardDialogueFallback(kind), blackboard });
  });
  result.push(...extractProse(normalized.slice(cursor)));
  return result.length ? result : [{ dialogueText: "" }];
}

/** Compatibility helper for callers expecting a single block. */
export function extractBlackboardPresentation(source: string): BlackboardPresentation {
  const presentations = extractBlackboardPresentations(source);
  if (presentations.length === 1) return presentations[0];
  const boards = presentations.filter((item) => item.blackboard);
  const firstBoard = boards[0];
  if (!firstBoard) return { dialogueText: normalizeText(source) };
  if (boards.length === 1) {
    const fallback = blackboardDialogueFallback(firstBoard.blackboard!.kind);
    const dialogueText = presentations.map((item) => item.dialogueText)
      .filter((text) => text !== fallback).join("\n").trim();
    return { ...firstBoard, dialogueText: dialogueText || fallback };
  }
  return firstBoard;
}

function equalBoards(a: BlackboardContent, b: BlackboardContent): boolean {
  return a.kind === b.kind && a.content === b.content && a.language === b.language && a.title === b.title;
}

/** Resolve retained boards and navigation from page events, without mutation. */
export function getBlackboardState(pages: readonly DialoguePage[], pageIndex: number): BlackboardState {
  if (!pages.length || !Number.isFinite(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) return {};
  const targetIndex = Math.floor(pageIndex);
  let active: BlackboardContent | undefined;
  let group: Array<{ pageIndex: number; content: BlackboardContent }> = [];
  let targetGroup: typeof group | undefined;
  let currentStep = -1;
  for (let index = 0; index < pages.length; index += 1) {
    const board = pages[index].blackboard;
    if (board === null) {
      if (index > targetIndex && targetGroup) break;
      active = undefined;
      group = [];
    } else if (board && (!active || !equalBoards(active, board))) {
      active = board;
      group.push({ pageIndex: index, content: board });
    }
    if (index === targetIndex) {
      if (!active) return {};
      targetGroup = group;
      currentStep = group.length - 1;
    }
  }
  if (!targetGroup || currentStep < 0) return {};
  return {
    content: targetGroup[currentStep].content,
    step: { current: currentStep + 1, total: targetGroup.length },
    ...(currentStep > 0 ? { previousPageIndex: targetGroup[currentStep - 1].pageIndex } : {}),
    ...(currentStep + 1 < targetGroup.length ? { nextPageIndex: targetGroup[currentStep + 1].pageIndex } : {}),
  };
}
