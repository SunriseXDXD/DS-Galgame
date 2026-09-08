import { describe, expect, it } from "vitest";
import { paginateText, parseScenePayload, sceneToPages, splitGraphemes } from "./dialogue";
import { inferEmotion } from "./emotions";

describe("parseScenePayload", () => {
  it("parses the model JSON contract", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "hungry",
      segments: [
        { kind: "narration", text: "她抱紧了饭碗。" },
        { kind: "dialogue", text: "先吃饭，再认真回答你。" },
      ],
      suggestions: ["给你加饭", "先回答问题"],
    }));

    expect(scene.mood).toBe("hungry");
    expect(scene.segments).toHaveLength(2);
    expect(scene.suggestions).toEqual(["给你加饭", "先回答问题"]);
  });

  it("recovers from fenced or unstructured output", () => {
    expect(parseScenePayload('```json\n{"mood":"happy","segments":[{"kind":"dialogue","text":"好耶。"}]}\n```').mood).toBe("happy");
    const fallback = parseScenePayload("先让我分析一下原因。\n\n很快就好。");
    expect(fallback.rawText).toBe("先让我分析一下原因。\n\n很快就好。");
    expect(sceneToPages(fallback).length).toBeGreaterThan(1);
  });

  it("unwraps a recoverable choices[0].message.content response", () => {
    const content = JSON.stringify({
      mood: "excited",
      segments: [{ kind: "dialogue", text: "好耶，信号接通了！" }],
      suggestions: ["继续测试"],
    });
    const response = JSON.stringify({
      id: "chatcmpl-test",
      choices: [{ index: 0, message: { role: "assistant", content } }],
      usage: { total_tokens: 42 },
    });
    const scene = parseScenePayload(`DeepSeek response:\n${response}`);

    expect(scene.mood).toBe("excited");
    expect(scene.rawText).toBe("好耶，信号接通了！");
    expect(scene.suggestions).toEqual(["继续测试"]);
    expect(scene.rawText).not.toContain("choices");
  });

  it.each([
    ["message.content", (content: string) => ({ message: { content } })],
    ["output_text", (content: string) => ({ output_text: content })],
    ["content.text", (content: string) => ({ content: { text: content } })],
    ["data.result.answer", (content: string) => ({ data: { result: { answer: content } } })],
  ])("recursively unwraps the %s envelope", (_, wrap) => {
    const content = JSON.stringify({
      mood: "relieved",
      segments: [{ kind: "dialogue", text: "没事就好，本鲸鱼放心了。" }],
    });
    const scene = parseScenePayload(JSON.stringify(wrap(content)));

    expect(scene.mood).toBe("relieved");
    expect(scene.rawText).toBe("没事就好，本鲸鱼放心了。");
  });

  it("unwraps a JSON scene encoded twice as strings", () => {
    const content = JSON.stringify({
      mood: "confused",
      segments: [{ kind: "thought", text: "这一串信号是什么意思？" }],
    });
    const scene = parseScenePayload(JSON.stringify(content));

    expect(scene.mood).toBe("confused");
    expect(scene.rawText).toBe("这一串信号是什么意思？");
  });

  it("reads only allowlisted wrapper text and ignores unrelated strings", () => {
    const response = JSON.stringify({
      payload: { reply: "本鲸鱼读到了这段回复。" },
      debug: "绝不能出现在正文里的调试信息",
      id: "opaque-protocol-id",
    });
    const scene = parseScenePayload(`Here is result:\n${response}`);

    expect(scene.rawText).toBe("本鲸鱼读到了这段回复。");
    expect(scene.rawText).not.toContain("debug");
    expect(scene.rawText).not.toContain("调试信息");
    expect(scene.rawText).not.toContain("opaque-protocol-id");
  });

  it("recovers text from a Python-style dict without displaying the dict", () => {
    const scene = parseScenePayload(
      "{'mood': 'happy', 'segments': [{'kind': 'dialogue', 'text': '只留下这句正文。'}], 'usage': {'total_tokens': 9}}",
    );

    expect(scene.rawText).toBe("只留下这句正文。");
    expect(scene.rawText).not.toContain("segments");
    expect(scene.rawText).not.toContain("total_tokens");
  });

  it("does not expose a YAML-style response object", () => {
    const scene = parseScenePayload(
      "mood: happy\nsegments:\n  - kind: dialogue\n    text: 只留下 YAML 里的正文。\nusage:\n  total_tokens: 9",
    );

    expect(scene.rawText).toBe("只留下 YAML 里的正文。");
    expect(scene.rawText).not.toContain("segments");
    expect(scene.rawText).not.toContain("total_tokens");
  });

  it("sanitizes a response object accidentally placed inside segment text", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "neutral",
      segments: [{
        kind: "dialogue",
        text: JSON.stringify({ choices: [{ message: { content: "真正的台词。" } }], usage: { total_tokens: 8 } }),
      }],
    }));

    expect(scene.rawText).toBe("真正的台词。");
    expect(scene.rawText).not.toContain("choices");
  });

  it("unwraps a segment-level response object whose content is fenced code", () => {
    const wrapped = JSON.stringify({
      choices: [{ message: { content: "```ts\nconst x = 1;\n```" } }],
      usage: { total_tokens: 8 },
    });
    const scene = parseScenePayload(JSON.stringify({
      mood: "thinking",
      segments: [{ kind: "dialogue", text: wrapped }],
    }));

    expect(scene.rawText).toBe("```ts\nconst x = 1;\n```");
    expect(scene.rawText).not.toContain("choices");
    expect(sceneToPages(scene)[0].blackboard?.content).toBe("const x = 1;");
  });

  it("unwraps a fenced provider envelope accidentally placed inside segment text", () => {
    const envelope = {
      choices: [{ message: { content: "真正的正文。" } }],
      usage: { total_tokens: 8 },
    };
    const scene = parseScenePayload(JSON.stringify({
      mood: "neutral",
      segments: [{ kind: "dialogue", text: `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\`` }],
    }));

    expect(scene.rawText).toBe("真正的正文。");
    expect(scene.rawText).not.toContain("choices");
    expect(sceneToPages(scene)[0].blackboard).toBeUndefined();
  });

  it("unwraps a fenced Python-style provider envelope", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "neutral",
      segments: [{
        kind: "dialogue",
        text: "```json\n{'choices': [{'message': {'content': '围栏里也只留正文。'}}], 'usage': {'total_tokens': 8}}\n```",
      }],
    }));

    expect(scene.rawText).toBe("围栏里也只留正文。");
    expect(scene.rawText).not.toContain("choices");
    expect(sceneToPages(scene)[0].blackboard).toBeUndefined();
  });

  it("replaces a fenced provider envelope without dropping its prefix", () => {
    const envelope = JSON.stringify({
      choices: [{ message: { content: "围栏中的正文。" } }],
      usage: { total_tokens: 8 },
    });
    const scene = parseScenePayload(`先保留这句前缀。\n\`\`\`json\n${envelope}\n\`\`\``);

    expect(scene.rawText).toBe("先保留这句前缀。\n围栏中的正文。");
    expect(scene.rawText).not.toContain("choices");
  });

  it("replaces a fenced provider envelope without dropping its suffix", () => {
    const envelope = JSON.stringify({ output_text: "围栏中的正文。" });
    const scene = parseScenePayload(`\`\`\`json\n${envelope}\n\`\`\`\n再保留这句后缀。`);

    expect(scene.rawText).toBe("围栏中的正文。\n再保留这句后缀。");
    expect(scene.rawText).not.toContain("output_text");
  });

  it("recognizes a provider fence with no newline before its closing marker", () => {
    const envelope = JSON.stringify({ message: { role: "assistant", content: "贴着围栏也能读到。" } });
    const scene = parseScenePayload(`\`\`\`json\n${envelope}\`\`\``);

    expect(scene.rawText).toBe("贴着围栏也能读到。");
    expect(sceneToPages(scene)[0].blackboard).toBeUndefined();
  });

  it("recognizes an envelope in a non-json-language fence", () => {
    const envelope = JSON.stringify({
      choices: [{ message: { content: "语言标签不会形成绕过。" } }],
    });
    const scene = parseScenePayload(`\`\`\`javascript\n${envelope}\n\`\`\``);

    expect(scene.rawText).toBe("语言标签不会形成绕过。");
    expect(sceneToPages(scene)[0].blackboard).toBeUndefined();
  });

  it("unwraps a double-encoded provider envelope inside a fence", () => {
    const envelope = {
      choices: [{ message: { content: "双重编码也只留下正文。" } }],
      usage: { total_tokens: 8 },
    };
    const encoded = JSON.stringify(JSON.stringify(envelope));
    const scene = parseScenePayload(`\`\`\`text\n${encoded}\n\`\`\``);

    expect(scene.rawText).toBe("双重编码也只留下正文。");
    expect(scene.rawText).not.toContain("choices");
  });

  it("traverses Python-style and JSON provider fences in the same text", () => {
    const jsonEnvelope = JSON.stringify({ output_text: "第二段正文。" });
    const raw = [
      "开头。",
      "```python",
      "{'choices': [{'message': {'content': '第一段正文。'}}], 'usage': {'total_tokens': 8}}",
      "```",
      "中间。",
      "```json",
      jsonEnvelope,
      "```",
      "结尾。",
    ].join("\n");
    const scene = parseScenePayload(raw);

    expect(scene.rawText).toBe("开头。\n第一段正文。\n中间。\n第二段正文。\n结尾。");
    expect(scene.rawText).not.toContain("choices");
    expect(scene.rawText).not.toContain("output_text");
  });

  it("keeps a top-level intentional JSON fence available to the blackboard", () => {
    const raw = "配置示例：\n```json\n{\"whale\":\"blue\"}\n```\n请保留它。";
    const scene = parseScenePayload(raw);

    expect(scene.rawText).toBe(raw);
    expect(sceneToPages(scene)[0].blackboard).toMatchObject({
      kind: "code",
      language: "json",
      content: "{\"whale\":\"blue\"}",
    });
  });

  it("sanitizes an envelope after an ordinary fenced example", () => {
    const envelope = JSON.stringify({
      choices: [{ message: { content: "真正正文。" } }],
      usage: { total_tokens: 8 },
    });
    const code = "{\"whale\":\"blue\"}";
    const raw = `示例：\n\`\`\`json\n${code}\n\`\`\`\n${envelope}`;
    const scene = parseScenePayload(raw);

    expect(scene.rawText).toBe(`示例：\n\`\`\`json\n${code}\n\`\`\`\n真正正文。`);
    expect(scene.rawText).not.toContain("choices");
    expect(sceneToPages(scene)[0].blackboard?.content).toBe(code);
  });

  it("sanitizes an envelope before an ordinary fenced example", () => {
    const envelope = JSON.stringify({
      choices: [{ message: { content: "真正正文。" } }],
      usage: { total_tokens: 8 },
    });
    const raw = `${envelope}\n\`\`\`ts\nconst whale = true;\n\`\`\``;
    const scene = parseScenePayload(raw);

    expect(scene.rawText).toBe("真正正文。\n```ts\nconst whale = true;\n```");
    expect(scene.rawText).not.toContain("choices");
    expect(sceneToPages(scene)[0].blackboard?.content).toBe("const whale = true;");
  });

  it.each([
    ["message string", { message: "hello" }],
    ["data object", { data: { id: 1 } }],
    ["result object", { result: { ok: true } }],
    ["body object", { body: { name: "鲸鱼" } }],
    ["numeric answer", { answer: 42 }],
    ["string answer", { answer: "42" }],
    ["object answer", { answer: { value: 42 } }],
  ])("keeps a weak %s JSON shape on the blackboard", (_, value) => {
    const content = JSON.stringify(value);
    const code = `\`\`\`json\n${content}\n\`\`\``;
    const scene = parseScenePayload(code);

    expect(scene.rawText).toBe(code);
    expect(sceneToPages(scene)[0].blackboard).toMatchObject({
      kind: "code",
      language: "json",
      content,
    });
  });

  it("keeps an intentional fenced JSON example on the blackboard", () => {
    const code = "```json\n{\"whale\":\"blue\"}\n```";
    const scene = parseScenePayload(JSON.stringify({
      mood: "thinking",
      segments: [{ kind: "dialogue", text: code }],
    }));

    expect(scene.rawText).toBe(code);
    expect(sceneToPages(scene)[0].blackboard).toMatchObject({
      kind: "code",
      language: "json",
      content: "{\"whale\":\"blue\"}",
    });
  });

  it("drops structured suggestions and bounds visible choices", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "happy",
      segments: [{ kind: "dialogue", text: "正文。" }],
      suggestions: [
        JSON.stringify({ choices: [{ message: { content: "隐藏包装" } }] }),
        "这是一条明显超过十八个字符所以需要被安全截断的快捷回复",
        "继续",
      ],
    }));

    expect(scene.suggestions).toHaveLength(2);
    expect(splitGraphemes(scene.suggestions[0])).toHaveLength(18);
    expect(scene.suggestions[1]).toBe("继续");
    expect(scene.suggestions.join(" ")).not.toContain("choices");
  });

  it("uses a friendly fallback for structured responses with no readable text", () => {
    const scene = parseScenePayload(JSON.stringify({
      id: "chatcmpl-empty",
      model: "deepseek-chat",
      status: "completed",
      usage: { total_tokens: 0 },
    }));

    expect(scene.rawText).toBe("海缆里只剩下一串安静的气泡……再试一次吧。");
    expect(scene.rawText).not.toContain("chatcmpl-empty");
    expect(scene.rawText).not.toContain("total_tokens");
  });

  it.each(["42", "true", "null"])("preserves the raw JSON-looking primitive %s", (value) => {
    expect(parseScenePayload(value).rawText).toBe(value);
    expect(parseScenePayload(JSON.stringify(value)).rawText).toBe(value);
  });

  it.each(["42", "true", "null"])("preserves provider message.content text %s", (content) => {
    const response = JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: { total_tokens: 8 },
    });

    expect(parseScenePayload(response).rawText).toBe(content);
  });
});

describe("visual novel pagination", () => {
  it("splits at Chinese punctuation and keeps every character", () => {
    const source = "第一句话很短。第二句话也不长！第三句话用来测试分页。";
    const pages = paginateText(source, 14);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("")).toBe(source);
  });

  it("preserves whitespace, code indentation, URLs, and whole emoji graphemes", () => {
    const source = "Hello! World!\n```py\n  value = '鲸鱼'\n```\nhttps://example.com/a-very-long-path\n👩‍💻🐳完成";
    const pages = paginateText(source, 12);

    expect(pages.join("")).toBe(source);
    expect(pages.every((page) => splitGraphemes(page).filter((glyph) => glyph !== "\n").length <= 12)).toBe(true);
    expect(pages.some((page) => page.includes("  value"))).toBe(true);
    expect(pages.some((page) => page.includes("👩‍💻"))).toBe(true);
  });

  it("preserves segment kinds", () => {
    const scene = parseScenePayload('{"mood":"shy","segments":[{"kind":"thought","text":"才、才没有高兴。"}]}');
    expect(sceneToPages(scene)[0].kind).toBe("thought");
  });

  it("can infer a more specific mood for the current page", () => {
    const scene = parseScenePayload('{"mood":"neutral","segments":[{"kind":"dialogue","text":"事已至此，先吃饭吧。"}]}');
    expect(sceneToPages(scene)[0].mood).toBe("hungry");
  });

  it("prefers a non-neutral page inference over the scene mood", () => {
    const scene = parseScenePayload('{"mood":"proud","segments":[{"kind":"dialogue","text":"事已至此，先吃饭吧。"}]}');
    expect(sceneToPages(scene)[0].mood).toBe("hungry");
  });

  it("inherits the scene mood when the current page remains neutral", () => {
    const scene = parseScenePayload('{"mood":"proud","segments":[{"kind":"dialogue","text":"尾鳍轻轻拍了一下水面。"}]}');
    expect(sceneToPages(scene)[0].mood).toBe("proud");
  });

  it("keeps an explicit segment mood above both scene mood and text inference", () => {
    const scene = parseScenePayload('{"mood":"angry","segments":[{"kind":"dialogue","text":"吃完饭就没事了。","mood":"relieved"}]}');
    expect(sceneToPages(scene)[0].mood).toBe("relieved");
  });

  it("moves fenced code out of dialogue pages and onto the blackboard", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "thinking",
      segments: [{ kind: "dialogue", text: "看这里：\n```ts\nconst whale = true;\n```", mood: "proud" }],
    }));
    const pages = sceneToPages(scene);

    expect(pages.map((page) => page.text).join("")).toBe("看这里：");
    expect(pages[0].blackboard).toMatchObject({
      kind: "code",
      language: "ts",
      content: "const whale = true;",
    });
    expect(pages[0].mood).toBe("proud");
  });
});

describe("emotion inference", () => {
  it("distinguishes rice from measurement units and product names", () => {
    expect(inferEmotion("事已至此，先吃白米饭吧。")).toBe("hungry");
    expect(inferEmotion("分析一厘米等于多少毫米")).not.toBe("hungry");
    expect(inferEmotion("小米手机的代码问题")).not.toBe("hungry");
  });

  it("recognizes the six additional moods conservatively", () => {
    expect(inferEmotion("这段说明我还是看不懂。")).toBe("confused");
    expect(inferEmotion("我担心继续下去会出事。")).toBe("worried");
    expect(inferEmotion("没事就好，本鲸鱼终于放心了。")).toBe("relieved");
    expect(inferEmotion("好耶，马上就能出发了！")).toBe("excited");
    expect(inferEmotion("哼！才不要理你。")).toBe("sulky");
    expect(inferEmotion("本鲸鱼一定会做到，再难也绝不放弃。")).toBe("determined");
  });

  it("applies specific collision priorities before broader moods", () => {
    expect(inferEmotion("好耶，先吃白米饭再庆祝！")).toBe("hungry");
    expect(inferEmotion("居然说本鲸鱼胖，哼！")).toBe("angry");
    expect(inferEmotion("好耶，问题终于解决了！")).toBe("excited");
    expect(inferEmotion("我不明白，也担心真的会出事。")).toBe("worried");
    expect(inferEmotion("一定会做到，现在开始分析方案。")).toBe("determined");
    expect(inferEmotion("终于解决了，谢谢你。")).toBe("relieved");
    expect(inferEmotion("这段代码看不懂，先分析一下。")).toBe("confused");
  });

  it("does not treat the generic word 问题 as thinking", () => {
    expect(inferEmotion("这里有一个问题。")).toBe("neutral");
  });
});
