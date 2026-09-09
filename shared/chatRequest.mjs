const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 8_000;
const MAX_SEGMENTS = 7;
const MAX_SUGGESTIONS = 3;
const VALID_ROLES = new Set(["user", "assistant"]);
const VALID_KINDS = new Set(["narration", "dialogue", "thought"]);
const VALID_ACTIONS = new Set(["bashful", "cheer", "explain", "point"]);
const VALID_MOODS = new Set([
  "neutral",
  "thinking",
  "happy",
  "shy",
  "angry",
  "hungry",
  "sleepy",
  "surprised",
  "sad",
  "proud",
  "confused",
  "worried",
  "relieved",
  "excited",
  "sulky",
  "determined",
]);

function parseScene(content) {
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    if (!VALID_MOODS.has(value.mood) || !Array.isArray(value.segments)) return undefined;

    const segments = value.segments.slice(0, MAX_SEGMENTS).flatMap((segment) => {
      if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
      if (!VALID_KINDS.has(segment.kind) || typeof segment.text !== "string") return [];
      const text = segment.text.trim();
      if (!text) return [];
      const mood = VALID_MOODS.has(segment.mood) ? segment.mood : value.mood;
      const action = typeof segment.action === "string" && VALID_ACTIONS.has(segment.action)
        ? segment.action
        : undefined;
      return [{
        kind: segment.kind,
        text,
        mood,
        ...(action ? { action } : {}),
      }];
    });
    if (!segments.length) return undefined;

    const suggestions = Array.isArray(value.suggestions)
      ? value.suggestions
          .filter((suggestion) => typeof suggestion === "string")
          .map((suggestion) => suggestion.trim())
          .filter(Boolean)
          .slice(0, MAX_SUGGESTIONS)
          .map((suggestion) => Array.from(suggestion).slice(0, 18).join("").trimEnd())
          .filter(Boolean)
      : [];

    return { mood: value.mood, segments, suggestions };
  } catch {
    return undefined;
  }
}

function serializeScene(scene) {
  const serialized = JSON.stringify(scene);
  if (serialized.length <= MAX_CONTENT_LENGTH) return serialized;

  const sourceSegments = scene.segments.map((segment) => ({
    ...segment,
    characters: Array.from(segment.text),
  }));
  let low = 1;
  let high = Math.max(...sourceSegments.map((segment) => segment.characters.length));
  let best = JSON.stringify({
    ...scene,
    segments: sourceSegments.map(({ characters, ...segment }) => ({
      ...segment,
      text: characters.slice(0, 1).join("").trimEnd(),
    })),
  });

  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({
      ...scene,
      segments: sourceSegments.map(({ characters, ...segment }) => ({
        ...segment,
        text: characters.slice(0, cap).join("").trimEnd(),
      })),
    });
    if (candidate.length <= MAX_CONTENT_LENGTH) {
      best = candidate;
      low = cap + 1;
    } else {
      high = cap - 1;
    }
  }
  return best;
}

function normalizeAssistantContent(content) {
  const scene = parseScene(content) ?? {
    mood: "neutral",
    segments: [{ kind: "dialogue", text: content, mood: "neutral" }],
    suggestions: [],
  };
  return serializeScene(scene);
}

export function normalizeChatMessages(input) {
  if (!Array.isArray(input)) return [];

  const messages = input
    .filter((message) =>
      message
      && typeof message === "object"
      && VALID_ROLES.has(message.role)
      && typeof message.content === "string")
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant"
        ? normalizeAssistantContent(message.content)
        : message.content.slice(0, MAX_CONTENT_LENGTH).trimEnd(),
    }));

  while (messages[0]?.role === "assistant") messages.shift();
  return messages;
}

export function createDeepSeekBody({
  model,
  messages,
  systemPrompt,
  sessionId,
  outputFormat = "json_object",
}) {
  if (outputFormat !== "json_object" && outputFormat !== "text") {
    throw new TypeError("outputFormat must be json_object or text");
  }
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...normalizeChatMessages(messages),
    ],
    thinking: { type: "disabled" },
    response_format: { type: outputFormat },
    stream: true,
    max_tokens: 1_600,
    user_id: `jingyu_${sessionId.replaceAll("-", "")}`,
  };
}
