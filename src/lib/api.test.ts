import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDeepSeek } from "./api";
import type { ChatTurn } from "../types";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

const messages: ChatTurn[] = [{
  id: "turn-1",
  role: "user",
  content: "你好",
  createdAt: 1,
}];

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamDeepSeek", () => {
  it("parses SSE across arbitrary network chunk boundaries", async () => {
    const delta = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      ": keep-alive\n\n",
      "data: {\"choices\":[{\"delta\":{\"con",
      "tent\":\"你好\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"，鲸鱼在。\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ])));

    const result = await streamDeepSeek({
      apiKey: "  sk-test  ",
      authMode: "byok",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
      onDelta: delta,
    });

    expect(result).toBe("你好，鲸鱼在。");
    expect(delta).toHaveBeenLastCalledWith("你好，鲸鱼在。");
    expect(fetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
      headers: expect.objectContaining({
        "X-DS-Auth-Mode": "byok",
        "X-DeepSeek-API-Key": "sk-test",
      }),
    }));
  });

  it.each([
    "sk-test中文",
    "“sk-test”",
    "sk-test\nBearer",
    "Bearer sk-test",
  ])("rejects an unsafe BYOK key before fetch: %s", async (apiKey) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey,
      authMode: "byok",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("只粘贴 sk-... 本体，勿含中文引号/全角符号/Bearer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces JSON proxy errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "API Key 无效" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )));

    await expect(streamDeepSeek({
      apiKey: "sk-bad",
      authMode: "byok",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("API Key 无效");
  });

  it("does not expose non-JSON upstream bodies as dialogue errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<html lang=\"zh-CN\"><pre>proxy stack sk-secret-raw-value</pre></html>",
      { status: 502, headers: { "Content-Type": "text/html" } },
    )));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("上游服务返回了无法识别的错误");
  });

  it("does not expose a response dict nested in a JSON error field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: JSON.stringify({ choices: [], usage: { total_tokens: 0 } }) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("请求失败");
  });

  it("rejects truncated streams even when partial content arrived", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"半截 JSON\"},\"finish_reason\":\"length\"}]}\n\n",
      "data: [DONE]\n\n",
    ])));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-pro",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("长度上限");
  });

  it("rejects a connection that closes without DONE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"未完成\"}}]}\n\n",
    ])));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("未完整结束");
  });

  it("rejects malformed data frames instead of returning partial content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"只有前半\"}}]}\n\n",
      "data: {not-json}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ])));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("响应流意外中断");
  });

  it("rejects non-string delta content instead of coercing raw values into dialogue", async () => {
    const delta = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":[\"choices\",\"usage\"]}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ])));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
      onDelta: delta,
    })).rejects.toThrow("响应流意外中断");
    expect(delta).not.toHaveBeenCalled();
  });

  it("treats both HTTP and streamed proxy timeouts as timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "海底线路等待超时，请稍后再试" }),
      { status: 504, headers: { "Content-Type": "application/json" } },
    )));
    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: "ApiTimeoutError" });

    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      "data: {\"error\":\"timeout\"}\n\n",
      "data: [DONE]\n\n",
    ])));
    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: "ApiTimeoutError" });
  });

  it("limits the transmitted context and requires a stop finish frame", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"完整内容\"}}]}\n\n",
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const longHistory = Array.from({ length: 30 }, (_, index): ChatTurn => ({
      id: String(index),
      role: index % 2 ? "assistant" : "user",
      content: "鲸".repeat(8_100),
      createdAt: index,
    }));

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages: longHistory,
      signal: new AbortController().signal,
    })).rejects.toThrow("缺少结束标记");

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    if (!request) throw new Error("missing request init");
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    expect(body.messages).toHaveLength(24);
    expect(body.messages.every((message) => message.content.length === 8_000)).toBe(true);
  });
});
