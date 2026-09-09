import { describe, expect, it } from "vitest";
import { createDeepSeekBody, normalizeChatMessages } from "../../shared/chatRequest.mjs";

describe("normalizeChatMessages", () => {
  it("keeps an allowlisted scene and wraps legacy assistant text as scene JSON", () => {
    const scene = JSON.stringify({
      mood: "happy",
      segments: [{
        kind: "dialogue",
        text: "尾鳍收到信号。",
        mood: "excited",
        action: "cheer",
        debug: true,
      }],
      suggestions: ["继续聊"],
      apiKey: "must-not-survive",
    });
    const result = normalizeChatMessages([
      { role: "user", content: "第一问" },
      { role: "assistant", content: scene },
      { role: "user", content: "第二问" },
      { role: "assistant", content: "旧版纯文本回答" },
    ]);

    expect(JSON.parse(result[1].content)).toEqual({
      mood: "happy",
      segments: [{ kind: "dialogue", text: "尾鳍收到信号。", mood: "excited", action: "cheer" }],
      suggestions: ["继续聊"],
    });
    expect(JSON.parse(result[3].content)).toEqual({
      mood: "neutral",
      segments: [{ kind: "dialogue", text: "旧版纯文本回答", mood: "neutral" }],
      suggestions: [],
    });
  });

  it("keeps two rounds in order without duplicating a user turn", () => {
    const firstRound = normalizeChatMessages([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
    ]);
    const secondRound = normalizeChatMessages([...firstRound, { role: "user", content: "第二问" }]);

    expect(secondRound.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(secondRound.filter((message) => message.content === "第二问")).toHaveLength(1);
  });

  it("drops unsupported action strings and objects from assistant history", () => {
    const scene = JSON.stringify({
      mood: "thinking",
      segments: [
        { kind: "dialogue", text: "保留合法动作。", action: "point" },
        { kind: "dialogue", text: "丢弃未知动作。", action: "dance" },
        { kind: "dialogue", text: "丢弃对象动作。", action: { payload: "hidden" } },
      ],
      suggestions: [],
    });
    const result = normalizeChatMessages([
      { role: "user", content: "请继续" },
      { role: "assistant", content: scene },
    ]);
    const normalized = JSON.parse(result[1].content) as {
      segments: Array<{ text: string; action?: string }>;
    };

    expect(normalized.segments).toEqual([
      { kind: "dialogue", text: "保留合法动作。", mood: "thinking", action: "point" },
      { kind: "dialogue", text: "丢弃未知动作。", mood: "thinking" },
      { kind: "dialogue", text: "丢弃对象动作。", mood: "thinking" },
    ]);
    expect(result[1].content).not.toContain("dance");
    expect(result[1].content).not.toContain("payload");
    expect(normalizeChatMessages(result)).toEqual(result);
  });

  it("truncates visible text before serialization so the result remains valid JSON", () => {
    const hostileToJsonBudget = '鲸\\\"\n'.repeat(4_000);
    const [, message] = normalizeChatMessages([
      { role: "user", content: "请回答" },
      { role: "assistant", content: hostileToJsonBudget },
    ]);
    const scene = JSON.parse(message.content) as { segments: Array<{ text: string }> };

    expect(message.content.length).toBeLessThanOrEqual(8_000);
    expect(scene.segments[0].text.length).toBeGreaterThan(0);
    expect(hostileToJsonBudget.startsWith(scene.segments[0].text)).toBe(true);
  });

  it("is idempotent for already-normalized assistant messages", () => {
    const once = normalizeChatMessages([
      { role: "user", content: "你好" },
      { role: "assistant", content: "本鲸鱼在。" },
    ]);
    expect(normalizeChatMessages(once)).toEqual(once);
  });

  it("stays idempotent when a long assistant prefix ends in whitespace", () => {
    const input = [
      { role: "user", content: "请概括" },
      { role: "assistant", content: `鲸${" ".repeat(10_000)}尾` },
    ];
    const once = normalizeChatMessages(input);

    expect(normalizeChatMessages(once)).toEqual(once);
    expect(JSON.parse(once[1].content).segments[0].text.endsWith(" ")).toBe(false);
  });

  it("stays idempotent when a suggestion is cut at trailing whitespace", () => {
    const scene = JSON.stringify({
      mood: "happy",
      segments: [{ kind: "dialogue", text: "继续。", mood: "happy" }],
      suggestions: [`${"鲸".repeat(17)} 再聊`],
    });
    const once = normalizeChatMessages([
      { role: "user", content: "你好" },
      { role: "assistant", content: scene },
    ]);

    expect(normalizeChatMessages(once)).toEqual(once);
    expect(JSON.parse(once[1].content).suggestions).toEqual(["鲸".repeat(17)]);
  });

  it("stays idempotent when a user message is cut immediately after whitespace", () => {
    const input = [{ role: "user", content: `${"鲸".repeat(7_999)} 尾` }];
    const once = normalizeChatMessages(input);

    expect(once[0].content).toBe("鲸".repeat(7_999));
    expect(normalizeChatMessages(once)).toEqual(once);
  });

  it("preserves fenced code text inside assistant dialogue", () => {
    const code = "```ts\nconst rice = 1;\nconsole.log(rice);\n```";
    const [message] = normalizeChatMessages([{ role: "user", content: "代码" }, {
      role: "assistant",
      content: code,
    }]).slice(1);

    expect(JSON.parse(message.content).segments[0].text).toBe(code);
  });

  it("only trims and length-limits user text, and drops metadata", () => {
    const [message] = normalizeChatMessages([{
      id: "turn-1",
      role: "user",
      content: "  {\"mood\":\"happy\"}\n```ts\nconst x = 1;\n```  ",
      mood: "angry",
      apiKey: "must-not-survive",
    }]);

    expect(message).toEqual({
      role: "user",
      content: "{\"mood\":\"happy\"}\n```ts\nconst x = 1;\n```",
    });
    expect(message).not.toHaveProperty("id");
    expect(message).not.toHaveProperty("mood");
    expect(message).not.toHaveProperty("apiKey");
  });

  it("caps history and removes an orphan assistant created by round-aware slicing", () => {
    const history = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `turn-${index}`,
    }));
    const result = normalizeChatMessages(history);

    expect(result).toHaveLength(23);
    expect(result[0]).toMatchObject({ role: "user", content: "turn-2" });
    expect(result.at(-1)).toMatchObject({ role: "user", content: "turn-24" });
  });
});

describe("createDeepSeekBody", () => {
  it("builds only the provider request fields and supports both output formats", () => {
    const body = createDeepSeekBody({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "你好", mood: "happy", apiKey: "secret" }],
      systemPrompt: "system json prompt",
      sessionId: "123e4567-e89b-42d3-a456-426614174000",
      outputFormat: "text",
    });

    expect(body).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "system json prompt" },
        { role: "user", content: "你好" },
      ],
      thinking: { type: "disabled" },
      response_format: { type: "text" },
      stream: true,
      max_tokens: 1_600,
      user_id: "jingyu_123e4567e89b42d3a456426614174000",
    });
    expect(JSON.stringify(body)).not.toContain("secret");

    expect(createDeepSeekBody({
      model: "deepseek-v4-pro",
      messages: [],
      systemPrompt: "json",
      sessionId: "session-id",
    }).response_format).toEqual({ type: "json_object" });
  });

  it("rejects unsupported output formats at the shared boundary", () => {
    expect(() => createDeepSeekBody({
      model: "deepseek-v4-flash",
      messages: [],
      systemPrompt: "json",
      sessionId: "session-id",
      outputFormat: "xml" as "json_object",
    })).toThrow("outputFormat");
  });
});
