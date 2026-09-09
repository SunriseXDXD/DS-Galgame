import {
  CHARACTER_ACTIONS,
  EMOTIONS,
  type AssistantScene,
  type CharacterAction,
  type DialoguePage,
  type Emotion,
  type SceneSegment,
  type SegmentKind,
} from "../types";
import { blackboardDialogueFallback, extractBlackboardPresentations, normalizeBlackboard } from "./blackboard";
import { inferEmotion } from "./emotions";

const VALID_KINDS = new Set<SegmentKind>(["narration", "dialogue", "thought"]);
const VALID_MOODS = new Set<string>(EMOTIONS);
const VALID_ACTIONS = new Set<string>(CHARACTER_ACTIONS);
const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "；", ";", "…"]);
const SOFT_BREAK = new Set(["，", "、", "；", ";", " ", "\t"]);
const EMPTY_RESPONSE_TEXT = "海缆里只剩下一串安静的气泡……再试一次吧。";
const WRAPPER_KEYS = [
  "message",
  "delta",
  "output_text",
  "answer",
  "result",
  "data",
  "output",
  "response",
  "body",
  "payload",
  "reply",
  "value",
  "content",
  "text",
] as const;
const STRUCTURED_KEYS = new Set([
  "choices",
  "message",
  "delta",
  "output_text",
  "answer",
  "result",
  "data",
  "output",
  "response",
  "body",
  "payload",
  "reply",
  "segments",
  "narration",
  "dialogue",
  "suggestions",
  "mood",
]);
const MAX_UNWRAP_DEPTH = 12;
const FENCED_BLOCK = /```([^\r\n`]*)[ \t]*\r?\n([\s\S]*?)```/g;
const NESTED_PROVIDER_KEYS = ["data", "result", "body", "payload", "response", "output", "value"] as const;
const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
  : null;

interface JsonCandidate {
  value: unknown;
}

type ResolvedPayload =
  | { kind: "scene"; value: Record<string, unknown> }
  | { kind: "text"; value: string };

interface FencedResolution {
  text: string;
  payload: ResolvedPayload;
}

interface FencedRewrite {
  text: string;
  hasFences: boolean;
  changed: boolean;
  direct?: ResolvedPayload;
}

export function splitGraphemes(text: string): string[] {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
    : Array.from(text);
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").trim()
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripOuterFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function findContainerEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      stack.push("}");
    } else if (character === "[") {
      stack.push("]");
    } else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return -1;
      if (!stack.length) return index + 1;
    }
  }

  return -1;
}

function hasStructuredShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasStructuredShape);
  if (!isRecord(value)) return false;
  return Object.keys(value).some((key) => STRUCTURED_KEYS.has(key));
}

function hasEnvelopeContext(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).replace(/```(?:json)?/gi, "").trim();
  const after = text.slice(end).replace(/```/g, "").trim();
  const mentionsEnvelope = /here|response|result|output|answer|reply|assistant|deepseek|openai|json|模型|返回|回复|响应|结果|输出|如下|以下/i;
  return before.length <= 120
    && mentionsEnvelope.test(before)
    && (!after || /^[。.!！]+$/.test(after));
}

function parseJsonText(raw: string): JsonCandidate | undefined {
  const text = stripOuterFence(raw);
  if (!text) return undefined;

  try {
    return { value: JSON.parse(text) };
  } catch {
    // Some providers prefix an otherwise valid JSON response with a short label.
  }

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{" && text[start] !== "[") continue;
    const end = findContainerEnd(text, start);
    if (end < 0) continue;
    try {
      const value = JSON.parse(text.slice(start, end));
      if (hasStructuredShape(value) || hasEnvelopeContext(text, start, end)) {
        return { value };
      }
    } catch {
      // Continue scanning in case a later JSON container is complete.
    }
  }

  return undefined;
}

function looksLikeStructuredText(raw: string, ignoreFencedBlocks = false): boolean {
  const source = ignoreFencedBlocks
    ? raw.replace(/```[^\n`]*\n[\s\S]*?```/g, " ")
    : stripOuterFence(raw);
  const text = source.replace(/^Object\s*/i, "").trim();
  if (text.startsWith("{") && /[:},]/.test(text)) return true;
  if (/^\[\s*(?:[{["']|-?\d|true\b|false\b|null\b)/i.test(text) && /[\],]/.test(text)) return true;
  if (/^\s*(?:mood|segments|suggestions|choices|message|delta|content|usage|output_text)\s*:/im.test(text)) return true;
  return /["'](?:choices|segments|message|delta|content|text|answer|output_text|usage|mood)["']\s*:/.test(text);
}

function decodeQuotedText(value: string, quote: string): string {
  if (quote === '"') {
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      // Fall through to the conservative escape decoder below.
    }
  }
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([\\'"/])/g, "$1")
    .trim();
}

function recoverKnownTextFields(raw: string): string[] {
  const fieldPattern = /(?:"(?:text|content|answer|output_text|dialogue|narration)"|'(?:text|content|answer|output_text|dialogue|narration)')\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/gi;
  const result: string[] = [];
  for (const match of raw.matchAll(fieldPattern)) {
    const quote = match[1] !== undefined ? '"' : "'";
    const decoded = decodeQuotedText(match[1] ?? match[2] ?? "", quote);
    if (decoded && !result.includes(decoded)) result.push(decoded);
  }
  const yamlFieldPattern = /^\s*(?:-\s*)?(?:text|content|answer|output_text|dialogue|narration)\s*:\s*([^|>\n][^\n]*)$/gim;
  for (const match of raw.matchAll(yamlFieldPattern)) {
    const decoded = match[1]?.trim();
    if (decoded && !result.includes(decoded)) result.push(decoded);
  }
  return result;
}

function looksLikeScene(value: Record<string, unknown>): boolean {
  if (Array.isArray(value.segments)) return true;
  if ("narration" in value || "dialogue" in value) return true;
  const hasDirectText = typeof value.text === "string" || typeof value.content === "string";
  return hasDirectText && ("mood" in value || "suggestions" in value);
}

function resolveArray(values: unknown[], depth: number): ResolvedPayload | undefined {
  const texts: string[] = [];
  for (const value of values) {
    const resolved = resolvePayload(value, depth + 1);
    if (resolved?.kind === "scene") return resolved;
    if (resolved?.kind === "text") texts.push(resolved.value);
  }
  const text = texts.join("\n").trim();
  return text ? { kind: "text", value: text } : undefined;
}

function resolvePayload(value: unknown, depth = 0): ResolvedPayload | undefined {
  if (depth > MAX_UNWRAP_DEPTH || value == null) return undefined;

  if (typeof value === "string") {
    const text = cleanText(value);
    if (!text) return undefined;
    const nested = parseJsonText(text);
    if (nested && (
      typeof nested.value === "string"
      || Array.isArray(nested.value)
      || isRecord(nested.value)
    )) {
      const resolved = resolvePayload(nested.value, depth + 1);
      if (resolved) return resolved;
    }
    return { kind: "text", value: text };
  }

  if (Array.isArray(value)) return resolveArray(value, depth);
  if (!isRecord(value)) return undefined;
  if (looksLikeScene(value)) return { kind: "scene", value };

  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      const resolved = resolvePayload(choice, depth + 1);
      if (resolved) return resolved;
    }
  }

  for (const key of WRAPPER_KEYS) {
    if (!(key in value)) continue;
    const resolved = resolvePayload(value[key], depth + 1);
    if (resolved) return resolved;
  }
  return undefined;
}

function isProviderPayload(value: unknown, depth = 0): boolean {
  if (depth > MAX_UNWRAP_DEPTH || value == null) return false;
  if (typeof value === "string") {
    const nested = parseJsonText(value);
    return nested
      ? isProviderPayload(nested.value, depth + 1)
      : looksLikePythonProvider(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => isProviderPayload(item, depth + 1));
  }
  if (!isRecord(value)) return false;

  if (looksLikeScene(value) || Array.isArray(value.choices)) return true;
  if ("output_text" in value) return true;

  const providerMetadata = [
    "id",
    "model",
    "object",
    "provider",
    "usage",
    "created",
    "request_id",
    "role",
  ];
  if ("answer" in value && providerMetadata.some((field) => field in value)) return true;

  const hasWrapperField = WRAPPER_KEYS.some((key) => key in value);
  if ("usage" in value && hasWrapperField) return true;

  for (const key of ["message", "delta"] as const) {
    const nested = value[key];
    if (!isRecord(nested) || !("content" in nested || "text" in nested)) continue;
    const hasAssistantRole = nested.role === "assistant";
    const hasProviderMetadata = ["id", "model", "object", "provider", "usage", "index", "finish_reason"]
      .some((field) => field in value);
    if (hasAssistantRole || hasProviderMetadata) return true;
  }

  if (
    (value.type === "output_text" && "text" in value)
    || (value.type === "message" && value.role === "assistant" && "content" in value)
  ) return true;

  return NESTED_PROVIDER_KEYS.some((key) =>
    key in value && isProviderPayload(value[key], depth + 1),
  );
}

function looksLikePythonProvider(raw: string): boolean {
  const has = (field: string) => new RegExp(`["']${field}["']\\s*:`, "i").test(raw);
  if (["choices", "output_text", "segments", "narration", "dialogue"].some(has)) {
    return true;
  }
  const hasProviderMetadata = ["id", "model", "object", "provider", "usage", "created", "request_id", "role"]
    .some(has);
  if (has("answer") && hasProviderMetadata) return true;
  if (has("mood") && (has("content") || has("text"))) return true;
  if (has("usage") && WRAPPER_KEYS.some(has)) return true;
  const hasMessageObject = /["'](?:message|delta)["']\s*:\s*\{/i.test(raw);
  const hasAssistantRole = /["']role["']\s*:\s*["']assistant["']/i.test(raw);
  return hasMessageObject && hasAssistantRole && (has("content") || has("text"));
}

function resolveFencedBody(body: string, depth: number): FencedResolution | undefined {
  const candidate = parseJsonText(body);
  if (candidate && isProviderPayload(candidate.value, depth + 1)) {
    const resolved = resolvePayload(candidate.value, depth + 1);
    if (resolved?.kind === "text") {
      const text = sanitizeVisibleText(resolved.value, depth + 1) || EMPTY_RESPONSE_TEXT;
      return { text, payload: { kind: "text", value: text } };
    }
    if (resolved?.kind === "scene") {
      const text = segmentsToHistoryText(normalizeSegments(resolved.value)) || EMPTY_RESPONSE_TEXT;
      return { text, payload: resolved };
    }
    return {
      text: EMPTY_RESPONSE_TEXT,
      payload: { kind: "text", value: EMPTY_RESPONSE_TEXT },
    };
  }

  if (!candidate && looksLikePythonProvider(body)) {
    const text = recoverKnownTextFields(body)
      .map((item) => sanitizeVisibleText(item, depth + 1))
      .filter(Boolean)
      .join("\n") || EMPTY_RESPONSE_TEXT;
    return { text, payload: { kind: "text", value: text } };
  }

  return undefined;
}

function sanitizeOutsideFence(chunk: string, depth: number): string {
  if (!chunk) return "";
  const firstContent = chunk.search(/\S/);
  if (firstContent < 0) return chunk;
  const trailingWhitespace = chunk.match(/\s*$/)?.[0] ?? "";
  const contentEnd = chunk.length - trailingWhitespace.length;
  const leadingWhitespace = chunk.slice(0, firstContent);
  const content = chunk.slice(firstContent, contentEnd);
  const sanitized = sanitizeVisibleText(content, depth + 1);
  return `${leadingWhitespace}${sanitized}${trailingWhitespace}`;
}

function rewriteFencedEnvelopes(text: string, depth: number): FencedRewrite {
  const matches = Array.from(text.matchAll(FENCED_BLOCK));
  if (!matches.length || depth > MAX_UNWRAP_DEPTH) {
    return { text, hasFences: false, changed: false };
  }

  let cursor = 0;
  let rewritten = "";
  let changed = false;
  let soleResolution: FencedResolution | undefined;

  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const resolution = resolveFencedBody(match[2] ?? "", depth + 1);
    rewritten += sanitizeOutsideFence(text.slice(cursor, start), depth);
    if (resolution) {
      rewritten += resolution.text;
      changed = true;
      soleResolution = matches.length === 1 ? resolution : undefined;
    } else {
      rewritten += match[0];
    }
    cursor = end;
  }
  rewritten += sanitizeOutsideFence(text.slice(cursor), depth);

  const onlyFence = Boolean(
    matches.length === 1
      && soleResolution
      && text.slice(0, matches[0].index ?? 0).trim() === ""
      && text.slice((matches[0].index ?? 0) + matches[0][0].length).trim() === "",
  );
  const direct = onlyFence ? soleResolution?.payload : undefined;

  return {
    text: rewritten,
    hasFences: true,
    changed,
    ...(direct ? { direct } : {}),
  };
}

function sanitizeVisibleText(value: unknown, depth = 0): string {
  const text = cleanText(value);
  if (!text || depth > MAX_UNWRAP_DEPTH) return "";
  const fenced = rewriteFencedEnvelopes(text, depth);
  if (fenced.hasFences) return cleanText(fenced.text);
  if (!looksLikeStructuredText(text, true)) return text;

  const candidate = parseJsonText(text);
  if (candidate) {
    const resolved = resolvePayload(candidate.value, depth + 1);
    if (resolved?.kind === "text") return sanitizeVisibleText(resolved.value, depth + 1);
    if (resolved?.kind === "scene") {
      const nested = segmentsToHistoryText(normalizeSegments(resolved.value));
      return nested || EMPTY_RESPONSE_TEXT;
    }
    return EMPTY_RESPONSE_TEXT;
  }

  const recovered = recoverKnownTextFields(text)
    .map((item) => sanitizeVisibleText(item, depth + 1))
    .filter(Boolean);
  return recovered.join("\n") || EMPTY_RESPONSE_TEXT;
}

function normalizeSegments(payload: Record<string, unknown>): SceneSegment[] {
  const result: SceneSegment[] = [];
  const candidates = Array.isArray(payload.segments) ? payload.segments : [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const blackboard = normalizeBlackboard(item.blackboard);
    const text = sanitizeVisibleText(item.text) || (blackboard
      ? blackboardDialogueFallback(blackboard.kind)
      : blackboard === null ? "这一部分讲完了，我们先收起黑板。" : "");
    if (!text) continue;
    const kind = VALID_KINDS.has(item.kind as SegmentKind)
      ? (item.kind as SegmentKind)
      : "dialogue";
    const mood = VALID_MOODS.has(String(item.mood)) ? (item.mood as Emotion) : undefined;
    const action = typeof item.action === "string" && VALID_ACTIONS.has(item.action)
      ? (item.action as CharacterAction)
      : undefined;
    result.push({
      kind,
      text,
      ...(mood ? { mood } : {}),
      ...(action ? { action } : {}),
      ...(blackboard !== undefined ? { blackboard } : {}),
    });
  }

  if (result.length) return result;

  const narration = sanitizeVisibleText(payload.narration);
  if (narration) result.push({ kind: "narration", text: narration });

  const dialogue = Array.isArray(payload.dialogue)
    ? payload.dialogue.map((item) => sanitizeVisibleText(item)).filter(Boolean)
    : [
        sanitizeVisibleText(payload.dialogue) ||
        sanitizeVisibleText(payload.text) ||
        sanitizeVisibleText(payload.content),
      ].filter(Boolean);

  result.push(...dialogue.map((text) => ({ kind: "dialogue" as const, text })));
  return result;
}

function fallbackSegments(raw: string): SceneSegment[] {
  const text = sanitizeVisibleText(raw) || EMPTY_RESPONSE_TEXT;
  return [{ kind: "dialogue", text }];
}

/** Keep the actual teaching source in conversation history, never its JSON envelope. */
export function segmentsToHistoryText(segments: readonly SceneSegment[]): string {
  return segments.map((segment) => {
    const board = segment.blackboard;
    if (!board) return segment.text;
    if (board.kind === "math") return `${segment.text}\n\n$$\n${board.content}\n$$`;
    // A longer fence preserves examples that themselves contain triple backticks.
    const longestRun = Math.max(0, ...Array.from(board.content.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const language = board.kind === "markdown" ? "markdown" : board.language || "text";
    return `${segment.text}\n\n${fence}${language}\n${board.content}\n${fence}`;
  }).filter(Boolean).join("\n");
}

function sceneFromText(text: string): AssistantScene {
  const segments = fallbackSegments(text);
  const combined = segmentsToHistoryText(segments);
  return {
    mood: inferEmotion(combined),
    segments,
    suggestions: [],
    rawText: combined,
  };
}

function sceneFromPayload(payload: Record<string, unknown>): AssistantScene | undefined {
  const segments = normalizeSegments(payload);
  if (!segments.length) return undefined;
  const combined = segmentsToHistoryText(segments);
  const mood = VALID_MOODS.has(String(payload.mood))
    ? (payload.mood as Emotion)
    : inferEmotion(combined);
  const suggestions = Array.isArray(payload.suggestions)
    ? payload.suggestions
        .map((value) => cleanText(value))
        .filter((value) => value && !looksLikeStructuredText(value))
        .map((value) => splitGraphemes(value.replace(/\s+/g, " ")).slice(0, 18).join(""))
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return { mood, segments, suggestions, rawText: combined };
}

function sceneFromJsonValue(value: unknown): AssistantScene {
  const resolved = resolvePayload(value);
  if (resolved?.kind === "scene") return sceneFromPayload(resolved.value) ?? sceneFromText("");
  if (resolved?.kind === "text") return sceneFromText(resolved.value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return sceneFromText(String(value));
  }
  return sceneFromText("");
}

export function parseScenePayload(raw: string): AssistantScene {
  // Markdown markers inside JSON string fields are data, not outer fences.
  // Parse a complete JSON envelope before scanning raw Markdown boundaries.
  let completeJson: JsonCandidate | undefined;
  try {
    completeJson = { value: JSON.parse(raw.trim()) };
  } catch {
    // Plain text, outer JSON fences and recoverable provider prefixes follow.
  }
  if (completeJson) return sceneFromJsonValue(completeJson.value);

  const fenced = rewriteFencedEnvelopes(raw, 0);
  if (fenced.direct?.kind === "scene") {
    return sceneFromPayload(fenced.direct.value) ?? sceneFromText("");
  }
  if (fenced.direct?.kind === "text") return sceneFromText(fenced.direct.value);
  if (fenced.hasFences) return sceneFromText(fenced.text);

  const candidate = parseJsonText(raw);
  if (!candidate) {
    if (!looksLikeStructuredText(raw)) return sceneFromText(raw);
    const recovered = recoverKnownTextFields(raw)
      .map((item) => sanitizeVisibleText(item))
      .filter(Boolean)
      .join("\n");
    return sceneFromText(recovered);
  }

  return sceneFromJsonValue(candidate.value);
}

function splitLongUnit(unit: string[], maxLength: number): string[][] {
  const rest = [...unit];
  const trailingBreaks: string[] = [];
  while (rest.at(-1) === "\n") trailingBreaks.unshift(rest.pop() as string);
  if (rest.length <= maxLength) return [[...rest, ...trailingBreaks]];
  const chunks: string[][] = [];
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength);
    let breakAt = -1;
    for (let index = window.length - 1; index >= 0; index -= 1) {
      if (SOFT_BREAK.has(window[index])) {
        breakAt = index;
        break;
      }
    }
    const index = breakAt >= Math.floor(maxLength * 0.55) ? breakAt + 1 : maxLength;
    chunks.push(rest.splice(0, index));
  }
  if (rest.length) chunks.push(rest);
  (chunks.at(-1) ?? chunks[0]).push(...trailingBreaks);
  return chunks;
}

function measuredLength(glyphs: string[]): number {
  return glyphs.reduce((length, glyph) => length + (glyph === "\n" ? 0 : 1), 0);
}

export function paginateText(text: string, maxLength = 76): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return [];
  const safeMaxLength = Math.max(1, Math.floor(maxLength));
  const units: Array<{ glyphs: string[]; breakAfter: boolean }> = [];
  let buffer: string[] = [];
  for (const glyph of splitGraphemes(normalized)) {
    buffer.push(glyph);
    if (glyph === "\n" && buffer.length === 1 && units.at(-1)?.breakAfter) {
      units.at(-1)?.glyphs.push(glyph);
      buffer = [];
      continue;
    }
    if (glyph === "\n" || SENTENCE_END.has(glyph)) {
      units.push({ glyphs: buffer, breakAfter: glyph === "\n" });
      buffer = [];
    }
  }
  if (buffer.length) units.push({ glyphs: buffer, breakAfter: false });

  const pages: string[] = [];
  let current: string[] = [];
  for (const unit of units) {
    const chunks = splitLongUnit(unit.glyphs, safeMaxLength);
    chunks.forEach((chunk, index) => {
      if (current.length && measuredLength(current) + measuredLength(chunk) > safeMaxLength) {
        pages.push(current.join(""));
        current = [];
      }
      current.push(...chunk);
      if (unit.breakAfter && index === chunks.length - 1) {
        pages.push(current.join(""));
        current = [];
      }
    });
  }
  if (current.length) pages.push(current.join(""));
  return pages.filter((page) => page.length > 0);
}

export function sceneToPages(scene: AssistantScene): DialoguePage[] {
  let count = 0;
  return scene.segments.flatMap((segment) => {
    const presentations = segment.blackboard !== undefined
      ? [{ dialogueText: segment.text || (segment.blackboard
          ? blackboardDialogueFallback(segment.blackboard.kind) : "这一部分讲完了，我们先收起黑板。"),
          blackboard: segment.blackboard }]
      : extractBlackboardPresentations(segment.text);
    return presentations.flatMap((presentation) => paginateText(presentation.dialogueText).map((text, index) => {
      const inferred = inferEmotion(text);
      return {
        id: `page-${count++}`,
        kind: segment.kind,
        text,
        mood: segment.mood ?? (inferred === "neutral" ? scene.mood : inferred),
        ...(segment.action ? { action: segment.action } : {}),
        ...(index === 0 && presentation.blackboard !== undefined ? { blackboard: presentation.blackboard } : {}),
      };
    }));
  });
}
