import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiEmptyResponseError, ApiTruncatedResponseError, streamDeepSeek } from "./api";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("streamDeepSeek", () => {
  it("parses SSE across arbitrary network chunk boundaries", async () => {
    const delta = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => streamResponse([
      ": keep-alive\n\n",
      "data: {\"choices\":[{\"delta\":{\"con",
      "tent\":\"你好\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"，鲸鱼在。\"}}]}\n\n",
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty("outputFormat");
  });

  it("preserves a long Chinese teaching reply through its last board and final choices", async () => {
    // Deliberately larger than short-chat fixtures: JSON and board source share
    // the provider's token cap. Character count is NOT an exact token count.
    const segments = Array.from({ length: 7 }, (_, index) => ({
      kind: "dialogue",
      text: `第${index + 1}步：本鲸鱼先说明输入与边界，再看当前黑板上的对应示例。确认每一项的结果之后，我们再继续下一步，不要跳过验证。`,
      mood: index === 6 ? "relieved" : "thinking",
      action: index === 6 ? "explain" : "point",
      ...(index < 5 ? {
        blackboard: {
          kind: index === 4 ? "math" : "code",
          title: `第${index + 1}步`,
          ...(index < 4 ? { language: "ts" } : {}),
          content: index === 4
            ? "\\sum_{i=1}^{n} x_i = n\\bar{x}"
            : Array.from({ length: 20 }, (_, line) => (
              `const sample${line} = values.map((value) => value * ${index * 20 + line + 1}).filter(Number.isFinite);`
            )).join("\n"),
        },
      } : {}),
    }));
    const payload = JSON.stringify({ mood: "thinking", segments, suggestions: ["检查最后的结果"] });
    const frames = Array.from({ length: Math.ceil(payload.length / 137) }, (_, index) => (
      `data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(index * 137, (index + 1) * 137) } }] })}\n\n`
    ));
    const fetchMock = vi.fn(async () => streamResponse([
      ...frames,
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    });

    expect(payload.length).toBeGreaterThan(7_000);
    expect(result).toBe(payload);
    expect(JSON.parse(result).segments.at(-1)?.text).toContain("第7步");
    expect(JSON.parse(result).segments[4].blackboard.content).toContain("\\bar{x}");
    expect(JSON.parse(result).suggestions).toEqual(["检查最后的结果"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries one empty structured response as text with the same request context", async () => {
    const delta = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => streamResponse([]))
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"私密推理\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"  \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]))
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{\"content\":\"恢复正文\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "sk-test",
      authMode: "byok",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
      onDelta: delta,
    })).resolves.toBe("恢复正文");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const retryRequest = fetchMock.mock.calls[1]?.[1];
    const firstBody = JSON.parse(String(firstRequest?.body)) as Record<string, unknown>;
    const retryBody = JSON.parse(String(retryRequest?.body)) as Record<string, unknown>;
    expect(firstBody).not.toHaveProperty("outputFormat");
    expect(retryBody).toMatchObject({ outputFormat: "text" });
    expect(retryBody.messages).toEqual(firstBody.messages);
    expect(retryRequest?.headers).toEqual(firstRequest?.headers);
    expect(retryRequest?.signal).toBe(firstRequest?.signal);
    expect(delta).toHaveBeenCalledWith("");
    expect(delta).toHaveBeenLastCalledWith("恢复正文");
    expect(warning).toHaveBeenCalledWith("DeepSeek empty response", {
      attempt: "structured",
      frameCount: 3,
      contentCharacters: 2,
      reasoningCharacters: 4,
      finishReason: "stop",
      done: true,
    });
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("私密推理");
    expect(logged).not.toContain("sk-test");
    expect(logged).not.toContain("你好");
  });

  it("throws a typed friendly error when the single text retry is also empty", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]))
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"不得泄露的推理\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\" \"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]));
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await streamDeepSeek({
        apiKey: "",
        authMode: "server",
        sessionId,
        model: "deepseek-v4-flash",
        messages,
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiEmptyResponseError);
    expect(caught).toMatchObject({
      name: "ApiEmptyResponseError",
      message: "上游返回空回复",
      stats: {
        frameCount: 3,
        contentCharacters: 1,
        reasoningCharacters: 7,
        finishReason: "stop",
        done: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("不得泄露的推理");
    expect(logged).not.toContain("choices");
  });

  it("does not retry an empty response after its signal is canceled", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const controller = new AbortController();
    const delta = vi.fn();
    const fetchMock = vi.fn(async () => {
      controller.abort("user");
      return streamResponse([
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: controller.signal,
      onDelta: delta,
    })).rejects.toBeInstanceOf(ApiEmptyResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delta).not.toHaveBeenCalled();
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
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: "API Key 无效" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "sk-bad",
      authMode: "byok",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("API Key 无效");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.fn(async () => streamResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"半截 JSON\"},\"finish_reason\":\"length\"}]}\n\n",
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-pro",
      messages,
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(ApiTruncatedResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a length-finished response even if its scene JSON is syntactically complete", async () => {
    const scene = JSON.stringify({
      mood: "happy",
      segments: [{ kind: "dialogue", text: "还没有讲完。" }],
      suggestions: ["不要提前显示的选项"],
    });
    const fetchMock = vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: scene }, finish_reason: "length" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: "ApiTruncatedResponseError",
      message: "本次回答达到长度上限，未完整生成。请把问题拆成更小的一步后重试。",
      stats: { finishReason: "length", done: true, contentCharacters: scene.length },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not make a third paid attempt when the empty-response fallback hits the token cap", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n",
      ]))
      .mockResolvedValueOnce(streamResponse([
        "data: {\"choices\":[{\"delta\":{\"content\":\"未完成的重试\"},\"finish_reason\":\"length\"}]}\n\n",
        "data: [DONE]\n\n",
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(ApiTruncatedResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not accept complete-looking scene JSON after a stop frame without DONE", async () => {
    const scene = JSON.stringify({ mood: "happy", segments: [{ kind: "dialogue", text: "正文。" }], suggestions: ["下一步"] });
    const fetchMock = vi.fn(async () => streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: scene }, finish_reason: "stop" }] })}\n\n`,
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamDeepSeek({
      apiKey: "",
      authMode: "server",
      sessionId,
      model: "deepseek-v4-flash",
      messages,
      signal: new AbortController().signal,
    })).rejects.toThrow("未完整结束");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
