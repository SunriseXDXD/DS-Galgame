import { describe, expect, it } from "vitest";
import type { BlackboardContent, DialoguePage } from "../types";
import { extractBlackboardPresentation, extractBlackboardPresentations, getBlackboardState, normalizeBlackboard } from "./blackboard";
import { parseScenePayload, sceneToPages, segmentsToHistoryText } from "./dialogue";

describe("teaching board normalization", () => {
  it("copies only the board contract and keeps literal TeX escapes and code JSON", () => {
    const board = normalizeBlackboard({
      kind: "math", content: String.raw`\frac{x}{2} + \text{鲸鱼}`, title: "第一步", token: "hidden", style: { debug: true },
    });
    expect(board).toEqual({ kind: "math", content: String.raw`\frac{x}{2} + \text{鲸鱼}`, title: "第一步" });
    expect(normalizeBlackboard({ kind: "code", content: '{"choices":[{"text":"example"}]}', language: "json" }))
      .toEqual({ kind: "code", content: '{"choices":[{"text":"example"}]}', language: "json" });
  });

  it.each([
    true, [], "latex", { kind: "html", content: "x" }, { kind: "math", content: "  " },
    { kind: "math", content: "x".repeat(16_001) }, { kind: "math", content: "x", title: "鲸".repeat(81) },
    { kind: "code", content: "x", language: "<script>" }, { kind: "code", content: "x", language: "x".repeat(21) },
    { kind: "math", content: { formula: "x" } },
  ])("ignores an invalid board without truncating its syntax: %j", (value) => {
    expect(normalizeBlackboard(value)).toBeUndefined();
  });

  it("accepts the exact code-point bounds and explicit clearing", () => {
    expect(normalizeBlackboard(null)).toBeNull();
    expect(normalizeBlackboard({ kind: "markdown", content: "鲸".repeat(16_000), title: "🐳".repeat(80) }))
      .toMatchObject({ title: "🐳".repeat(80) });
  });
});

describe("ordered legacy lesson extraction", () => {
  it("reveals code blocks separately and keeps the explanation before the next board", () => {
    const presentations = extractBlackboardPresentations([
      "先定义函数。", "```ts", "const twice = (x: number) => x * 2;", "```",
      "这里乘二，还没有调用它。", "```ts", "twice(3);", "```", "结果是六。",
    ].join("\n"));
    expect(presentations).toHaveLength(4);
    expect(presentations[0]).toMatchObject({ dialogueText: "先定义函数。", blackboard: { content: "const twice = (x: number) => x * 2;" } });
    expect(presentations[1]).toEqual({ dialogueText: "这里乘二，还没有调用它。" });
    expect(presentations[2].blackboard?.content).toBe("twice(3);");
    expect(presentations[3]).toEqual({ dialogueText: "结果是六。" });
  });

  it.each([
    ["dollars", "$$\nx^2 = 4\n$$", "\nx^2 = 4"],
    ["brackets", String.raw`\[\frac{1}{2}\]`, String.raw`\frac{1}{2}`],
    ["latex", "```latex\nx^2 = 4\n```", "x^2 = 4"],
    ["tex", "```tex\nx^2 = 4\n```", "x^2 = 4"],
    ["math", "```math\nx^2 = 4\n```", "x^2 = 4"],
  ])("recognizes complete %s math without splitting formulas", (_, source, expected) => {
    const presentations = extractBlackboardPresentations(source);
    expect(presentations).toHaveLength(1);
    expect(presentations[0].blackboard).toMatchObject({ kind: "math", content: expected });
    expect(presentations[0].dialogueText).not.toContain("x^2");
  });

  it("does not extract math delimiters from code fences", () => {
    const content = 'const formula = "$$x^2$$";';
    expect(extractBlackboardPresentations(`\`\`\`js\n${content}\n\`\`\``)[0].blackboard)
      .toMatchObject({ kind: "code", content });
  });

  it("moves inline TeX paragraphs onto a Markdown board, with a spoken cue", () => {
    const source = String.raw`我们使用 $x^2$，然后看 \(x + 1\)。`;
    const presentations = extractBlackboardPresentations(source);
    expect(presentations).toHaveLength(1);
    expect(presentations[0].blackboard).toMatchObject({ kind: "markdown", content: source });
    expect(presentations[0].dialogueText).not.toContain("$");
    expect(extractBlackboardPresentations("价格是 $5 和 $10。")).toEqual([{ dialogueText: "价格是 $5 和 $10。" }]);
    expect(extractBlackboardPresentations("字面量 `$x$` 不上黑板。")[0].blackboard).toBeUndefined();
  });

  it.each([
    "结果是 $$x^2$$，记住它。",
    String.raw`结果是 \[\frac{x}{2}\]，记住它。`,
    "推导使用 $$\n\\begin{aligned}x &= 1\\\\y &= 2\\end{aligned}\n$$，这一步不要拆开。",
    "推导使用 $$\n\\begin{aligned}x &= 1\\\\\n\ny &= 2\\end{aligned}\n$$，这一步不要拆开。",
  ])("moves an embedded display formula and its explanation to one Markdown board: %s", (source) => {
    const pages = sceneToPages(parseScenePayload(source));
    expect(pages).toHaveLength(1);
    expect(pages[0].blackboard).toMatchObject({ kind: "markdown", content: source });
    expect(pages[0].text).not.toContain("x");
  });

  it.each([
    "字面量 `$$x^2$$` 不需要渲染。",
    String.raw`字面量 \$\$x^2\$\$ 不需要渲染。`,
    String.raw`字面量 \\[x^2\\] 不需要渲染。`,
    String.raw`字面量 \\(x^2\\) 不需要渲染。`,
  ])("does not activate a board for code or escaped formula delimiters: %s", (source) => {
    expect(extractBlackboardPresentations(source)).toEqual([{ dialogueText: source }]);
  });

  it("separates whole Markdown sections without cutting a table or list", () => {
    const source = "# 定义\n- 保留第一项\n- 保留第二项\n\n# 结果\n| x | y |\n| --- | --- |\n| 1 | 2 |";
    const boards = extractBlackboardPresentations(source).map((item) => item.blackboard);
    expect(boards).toHaveLength(2);
    expect(boards[0]?.content).toBe("# 定义\n- 保留第一项\n- 保留第二项");
    expect(boards[1]?.content).toBe("# 结果\n| x | y |\n| --- | --- |\n| 1 | 2 |");
  });

  it("retains surrounding prose for the old single-board helper", () => {
    const presentation = extractBlackboardPresentation("开始。\n```ts\nx();\n```\n结束。");
    expect(presentation.dialogueText).toContain("开始。");
    expect(presentation.dialogueText).toContain("结束。");
  });
});

describe("explicit teaching scenes and model history", () => {
  it("parses, retains and clears explicit boards, including board-only segments", () => {
    const scene = parseScenePayload(JSON.stringify({
      mood: "thinking",
      segments: [
        { kind: "dialogue", text: "先移项。", blackboard: { kind: "math", content: "x^2 = 4", title: "第一步" } },
        { kind: "dialogue", text: "两边一起开方。" },
        { kind: "dialogue", blackboard: { kind: "math", content: "x = \\pm 2" } },
        { kind: "dialogue", text: "讲完啦。", blackboard: null },
      ],
      usage: { secret: "not history" },
    }));
    expect(scene.segments).toHaveLength(4);
    expect(scene.segments[2].text).toContain("公式");
    expect(scene.segments[3].blackboard).toBeNull();
    expect(scene.rawText).toContain("$$\nx = \\pm 2\n$$");
    expect(scene.rawText).not.toContain('"segments"');
    expect(scene.rawText).not.toContain("not history");
    const pages = sceneToPages(scene);
    expect(pages[1].blackboard).toBeUndefined();
    expect(getBlackboardState(pages, 1).content?.content).toBe("x^2 = 4");
    expect(getBlackboardState(pages, 2).content?.content).toBe("x = \\pm 2");
    expect(getBlackboardState(pages, 3)).toEqual({});
  });

  it("ignores invalid model boards and does not leak their object contents", () => {
    const scene = parseScenePayload(JSON.stringify({ segments: [
      { text: "只读台词。", blackboard: { kind: "html", content: "secret" } },
      { blackboard: { kind: "code", content: [] } },
      { blackboard: null },
    ] }));
    expect(scene.segments).toHaveLength(2);
    expect(scene.segments[0]).toEqual({ kind: "dialogue", text: "只读台词。" });
    expect(scene.segments[1].blackboard).toBeNull();
    expect(scene.rawText).not.toContain("secret");
  });

  it("keeps deliberately requested code JSON in history even when it resembles a provider", () => {
    const content = '{"choices":[{"message":{"content":"an API example"}}]}';
    const scene = parseScenePayload(JSON.stringify({ segments: [{
      text: "这是返回结构的代码示例。", blackboard: { kind: "code", language: "json", content },
    }] }));
    expect(scene.rawText).toContain(`\`\`\`json\n${content}\n\`\`\``);
    expect(sceneToPages(scene)[0].blackboard?.content).toBe(content);
  });

  it("does not mistake fences inside pretty-printed JSON string fields for outer response fences", () => {
    const payload = { segments: [
      { text: "先看第一段。", blackboard: { kind: "markdown", content: "```ts\nconst one = 1;\n```" } },
      { text: "再看第二段。", blackboard: { kind: "markdown", content: "```ts\nconst two = 2;\n```" } },
    ] };
    const scene = parseScenePayload(JSON.stringify(payload, null, 2));
    expect(scene.segments).toHaveLength(2);
    expect(scene.segments[0].blackboard?.content).toBe(payload.segments[0].blackboard.content);
    expect(scene.segments[1].blackboard?.content).toBe(payload.segments[1].blackboard.content);
  });

  it("uses safe-length fences for Markdown teaching that itself includes code", () => {
    const source = segmentsToHistoryText([{ kind: "dialogue", text: "先看嵌套示例。", blackboard: {
      kind: "markdown", content: "# 示例\n```ts\nx();\n```",
    } }]);
    expect(source).toBe("先看嵌套示例。\n\n````markdown\n# 示例\n```ts\nx();\n```\n````");
  });

  it("emits an explicit board event once while preserving it through long narration", () => {
    const scene = parseScenePayload(JSON.stringify({ segments: [{
      text: "这是一段比较长的解释，请你跟着本鲸鱼慢慢理解。".repeat(15),
      blackboard: { kind: "math", content: "a+b=c" },
    }] }));
    const pages = sceneToPages(scene);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.filter((page) => page.blackboard !== undefined)).toHaveLength(1);
    expect(getBlackboardState(pages, pages.length - 1)).toMatchObject({ content: { content: "a+b=c" }, step: { current: 1, total: 1 } });
  });
});

describe("blackboard lesson navigation", () => {
  const first: BlackboardContent = { kind: "math", content: "x=1" };
  const second: BlackboardContent = { kind: "math", content: "x+1=2" };
  const page = (id: number, blackboard?: BlackboardContent | null): DialoguePage => ({ id: `page-${id}`, kind: "dialogue", text: "讲解。", ...(blackboard !== undefined ? { blackboard } : {}) });

  it("counts changed board events, not narration pages or duplicate board objects", () => {
    const pages = [page(0), page(1, first), page(2), page(3, { ...first }), page(4, second), page(5)];
    expect(getBlackboardState(pages, 0)).toEqual({});
    expect(getBlackboardState(pages, 3)).toEqual({ content: first, step: { current: 1, total: 2 }, nextPageIndex: 4 });
    expect(getBlackboardState(pages, 5)).toEqual({ content: second, step: { current: 2, total: 2 }, previousPageIndex: 1 });
  });

  it("starts a new lesson after clear, without navigating to its future boards", () => {
    const pages = [page(0, first), page(1, second), page(2, null), page(3), page(4, first)];
    expect(getBlackboardState(pages, 0).step).toEqual({ current: 1, total: 2 });
    expect(getBlackboardState(pages, 1).nextPageIndex).toBeUndefined();
    expect(getBlackboardState(pages, 2)).toEqual({});
    expect(getBlackboardState(pages, 3)).toEqual({});
    expect(getBlackboardState(pages, 4)).toEqual({ content: first, step: { current: 1, total: 1 } });
    expect(getBlackboardState(pages, -1)).toEqual({});
    expect(getBlackboardState(pages, 100)).toEqual({});
  });
});
