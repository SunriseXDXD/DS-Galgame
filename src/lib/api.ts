import type { ChatTurn, ModelId } from "../types";
import { normalizeChatMessages } from "../../shared/chatRequest.mjs";

interface StreamOptions {
  apiKey: string;
  authMode: "byok" | "server";
  sessionId: string;
  model: ModelId;
  messages: ChatTurn[];
  signal: AbortSignal;
  onDelta?: (content: string) => void;
}

export class ApiTimeoutError extends Error {
  constructor(message = "海底线路等待超时") {
    super(message);
    this.name = "ApiTimeoutError";
  }
}

interface ApiStreamStats {
  frameCount: number;
  contentCharacters: number;
  reasoningCharacters: number;
  finishReason: string;
  done: boolean;
}

export class ApiEmptyResponseError extends Error {
  readonly stats: Readonly<ApiStreamStats>;

  constructor(stats: ApiStreamStats) {
    super("上游返回空回复");
    this.name = "ApiEmptyResponseError";
    this.stats = Object.freeze({ ...stats });
  }
}

export const INVALID_BYOK_KEY_MESSAGE =
  "只粘贴 sk-... 本体，勿含中文引号/全角符号/Bearer";

export function validateByokApiKey(apiKey: string): string | undefined {
  if (!apiKey) return "请输入你的 DeepSeek API Key";
  if (apiKey.length > 512 || !/^sk-[!-~]+$/.test(apiKey)) {
    return INVALID_BYOK_KEY_MESSAGE;
  }
  return undefined;
}

function parseErrorPayload(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    const candidate = typeof parsed.error === "string"
      ? parsed.error
      : typeof parsed.error?.message === "string"
        ? parsed.error.message
        : typeof parsed.message === "string"
          ? parsed.message
          : "";
    const message = candidate
      .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-***")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 240);
    if (/^[{[]/.test(message) || /["'](?:choices|usage|message|content)["']\s*:/.test(message)) {
      return "请求失败";
    }
    return message || "请求失败";
  } catch {
    return "上游服务返回了无法识别的错误";
  }
}

async function consumeSseResponse(
  response: Response,
  onDelta?: (content: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("浏览器未收到流式响应");
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    throw new Error("代理返回了非流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let streamError = "";
  const stats: ApiStreamStats = {
    frameCount: 0,
    contentCharacters: 0,
    reasoningCharacters: 0,
    finishReason: "",
    done: false,
  };

  const consumeEvent = (event: string): boolean => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return false;
    if (data === "[DONE]") {
      stats.done = true;
      return true;
    }
    stats.frameCount += 1;
    try {
      const chunk = JSON.parse(data) as {
        error?: unknown;
        choices?: Array<{
          delta?: { content?: unknown; reasoning_content?: unknown };
          finish_reason?: unknown;
        }>;
      };
      if (chunk.error !== undefined) {
        streamError = typeof chunk.error === "string" ? chunk.error : "malformed_frame";
      }
      if (chunk.choices !== undefined && !Array.isArray(chunk.choices)) {
        streamError ||= "malformed_frame";
      }
      const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
      if (choice?.finish_reason != null) {
        if (typeof choice.finish_reason === "string") stats.finishReason = choice.finish_reason;
        else streamError ||= "malformed_frame";
      }
      const reasoning = choice?.delta?.reasoning_content;
      if (typeof reasoning === "string") stats.reasoningCharacters += reasoning.length;
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) {
        content += delta;
        stats.contentCharacters += delta.length;
        onDelta?.(content);
      } else if (delta != null && typeof delta !== "string") {
        streamError ||= "malformed_frame";
      }
    } catch {
      streamError ||= "malformed_frame";
    }
    return false;
  };

  let providerFinished = false;
  while (!providerFinished) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      if (consumeEvent(event)) {
        providerFinished = true;
        break;
      }
    }
    if (done) break;
  }

  if (!providerFinished && buffer.trim()) consumeEvent(buffer);
  if (providerFinished) await reader.cancel().catch(() => undefined);
  if (streamError) {
    if (streamError === "timeout") throw new ApiTimeoutError();
    throw new Error("DeepSeek 响应流意外中断");
  }
  if (!stats.done) throw new Error("DeepSeek 响应流未完整结束");
  if (stats.finishReason !== "stop") {
    if (stats.finishReason === "length") {
      throw new Error("回答达到长度上限，请缩小问题后重试");
    }
    throw new Error(stats.finishReason
      ? `回答未正常结束（${stats.finishReason}）`
      : "DeepSeek 响应缺少结束标记");
  }
  if (!content.trim()) throw new ApiEmptyResponseError(stats);
  return content;
}

type StreamAttempt = "structured" | "text-retry";

function warnEmptyResponse(error: ApiEmptyResponseError, attempt: StreamAttempt): void {
  console.warn("DeepSeek empty response", {
    attempt,
    frameCount: error.stats.frameCount,
    contentCharacters: error.stats.contentCharacters,
    reasoningCharacters: error.stats.reasoningCharacters,
    finishReason: error.stats.finishReason,
    done: error.stats.done,
  });
}

export async function streamDeepSeek({
  apiKey,
  authMode,
  sessionId,
  model,
  messages,
  signal,
  onDelta,
}: StreamOptions): Promise<string> {
  const trimmedApiKey = apiKey.trim();
  if (authMode === "byok") {
    const validationError = validateByokApiKey(trimmedApiKey);
    if (validationError) throw new Error(validationError);
  }

  const normalizedMessages = normalizeChatMessages(messages);
  const request = async (attempt: StreamAttempt): Promise<string> => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DS-Auth-Mode": authMode,
        "X-DS-Session-ID": sessionId,
        ...(authMode === "byok" ? { "X-DeepSeek-API-Key": trimmedApiKey } : {}),
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        ...(attempt === "text-retry" ? { outputFormat: "text" } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const detail = parseErrorPayload(await response.text());
      if (response.status === 504) throw new ApiTimeoutError(detail);
      throw new Error(detail);
    }
    return consumeSseResponse(response, onDelta);
  };

  try {
    return await request("structured");
  } catch (error) {
    if (!(error instanceof ApiEmptyResponseError)) throw error;
    warnEmptyResponse(error, "structured");
    if (signal.aborted) throw error;
    onDelta?.("");
  }

  try {
    return await request("text-retry");
  } catch (error) {
    if (error instanceof ApiEmptyResponseError) warnEmptyResponse(error, "text-retry");
    throw error;
  }
}
