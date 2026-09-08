import type { BlackboardContent } from "../types";

export interface BlackboardPresentation {
  dialogueText: string;
  blackboard?: BlackboardContent;
}

interface FencedBlock {
  language: string;
  content: string;
}

const FENCED_BLOCK = /```([^\n`]*)\n([\s\S]*?)```/g;
const MARKDOWN_LANGUAGE = /^(?:md|mdown|markdown)$/i;
const MARKDOWN_LINE = /^(?:#{1,6}\s+|>\s+|[-+*]\s+|\d+[.)]\s+)/;
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function dialogueFallback(kind: BlackboardContent["kind"]): string {
  return kind === "code"
    ? "代码已经写在黑板上了。"
    : "整理好的内容已经放在黑板上了。";
}

function titleFor(kind: BlackboardContent["kind"], language = ""): string {
  if (kind === "markdown") return "鲸鱼笔记";
  return language ? `${language.toUpperCase()} 代码` : "代码输出";
}

function markdownStart(lines: string[]): number {
  const heading = lines.findIndex((line) => /^#{1,6}\s+/.test(line.trimStart()));
  if (heading >= 0) return heading;

  const tableDivider = lines.findIndex((line) => TABLE_DIVIDER.test(line));
  if (tableDivider > 0 && lines[tableDivider - 1]?.includes("|")) return tableDivider - 1;

  const marked = lines
    .map((line, index) => MARKDOWN_LINE.test(line.trimStart()) ? index : -1)
    .filter((index) => index >= 0);
  return marked.length >= 2 ? marked[0] : -1;
}

function combineFencedBlocks(blocks: FencedBlock[]): BlackboardContent {
  const onlyMarkdown = blocks.every((block) => MARKDOWN_LANGUAGE.test(block.language));
  const kind: BlackboardContent["kind"] = onlyMarkdown ? "markdown" : "code";
  const languages = [...new Set(
    blocks
      .filter((block) => !MARKDOWN_LANGUAGE.test(block.language))
      .map((block) => block.language)
      .filter(Boolean),
  )];
  const language = languages.length === 1 ? languages[0] : undefined;
  const content = blocks.map((block) => block.content).join("\n\n").trim();

  return {
    kind,
    content,
    ...(language ? { language } : {}),
    title: titleFor(kind, language),
  };
}

/**
 * Separates material meant for a visual aid from text that should be spoken in
 * the visual-novel dialogue box. Fenced code is preferred; otherwise a
 * multi-line Markdown structure is moved onto the board.
 */
export function extractBlackboardPresentation(source: string): BlackboardPresentation {
  const normalized = normalizeText(source);
  if (!normalized) return { dialogueText: "" };

  const blocks: FencedBlock[] = [];
  const withoutFences = normalized.replace(FENCED_BLOCK, (_match, rawLanguage: string, rawContent: string) => {
    blocks.push({
      language: (rawLanguage.trim().split(/\s+/)[0] || "")
        .replace(/[^a-z0-9_+.-]/gi, "")
        .toLowerCase()
        .slice(0, 20),
      content: rawContent.replace(/\s+$/, ""),
    });
    return "\n";
  });

  if (blocks.length) {
    const blackboard = combineFencedBlocks(blocks);
    if (!blackboard.content) return { dialogueText: normalizeText(withoutFences) };
    return {
      dialogueText: normalizeText(withoutFences) || dialogueFallback(blackboard.kind),
      blackboard,
    };
  }

  const lines = normalized.split("\n");
  const start = markdownStart(lines);
  if (start < 0) return { dialogueText: normalized };

  const content = lines.slice(start).join("\n").trim();
  const dialogueText = lines.slice(0, start).join("\n").trim();
  const blackboard: BlackboardContent = {
    kind: "markdown",
    content,
    title: titleFor("markdown"),
  };
  return {
    dialogueText: dialogueText || dialogueFallback("markdown"),
    blackboard,
  };
}
