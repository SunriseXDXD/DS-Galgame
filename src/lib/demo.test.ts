import { afterEach, describe, expect, it, vi } from "vitest";
import { demoReply } from "./demo";
import { sceneToPages } from "./dialogue";

afterEach(() => {
  vi.useRealTimers();
});

describe("demoReply", () => {
  it("returns the matching local scene after its short delay", async () => {
    vi.useFakeTimers();
    const pending = demoReply("你好，在吗？", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    await expect(pending).resolves.toMatchObject({ mood: "happy" });
  });

  it("does not mistake measurement units for rice", async () => {
    vi.useFakeTimers();
    const pending = demoReply("一厘米是多少毫米？", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    await expect(pending).resolves.toMatchObject({ mood: "thinking" });
  });

  it.each([
    ["给我一个 TypeScript 代码示例", "```ts"],
    ["用 Markdown 清单演示黑板", "# 今日计划"],
  ])("provides a local blackboard demo for %s", async (input, marker) => {
    vi.useFakeTimers();
    const pending = demoReply(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;
    expect(result.rawText).toContain(marker);
    expect(new Set(result.segments.map((segment) => segment.mood)).size).toBeGreaterThan(1);
  });

  it("demonstrates all four explicit character actions in order", async () => {
    vi.useFakeTimers();
    const pending = demoReply("动作差分演示", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;

    expect(result.segments.map((segment) => segment.action)).toEqual([
      "bashful",
      "cheer",
      "explain",
      "point",
    ]);
    expect(result.segments).toHaveLength(4);
    expect(result.segments[3].text).toContain("# 动作差分");
    expect(result.suggestions[0]).toBe("动作差分演示");
    expect(result.rawText).toBe(result.segments.map((segment) => segment.text).join("\n"));
    expect(result.rawText).not.toContain("rawText");
    expect(result.rawText).not.toContain('"action"');
  });

  it.each([
    ["给我一个 TypeScript 代码示例", "greet(\"饲养员\")"],
    ["用 Markdown 清单演示黑板", "# 今日计划"],
  ])("uses explain for teaching and point for the board in %s", async (input, boardMarker) => {
    vi.useFakeTimers();
    const pending = demoReply(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;

    expect(result.segments.find((segment) => segment.action === "explain")?.kind).toBe("dialogue");
    expect(result.segments.find((segment) => (segment.blackboard?.content ?? segment.text).includes(boardMarker))?.action).toBe("point");
  });

  it.each(["公式分步演示", "LaTeX 公式怎么显示", "展示 latex"])("teaches a quadratic equation with three boards for %s", async (input) => {
    vi.useFakeTimers();
    const pending = demoReply(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;
    const boards = result.segments.map((segment) => segment.blackboard);

    expect(boards.map((board) => board?.kind)).toEqual(["math", "math", "math"]);
    expect(boards.map((board) => board?.title)).toEqual(["1/3 · 移项", "2/3 · 配成平方", "3/3 · 求根与检查"]);
    expect(boards[0]?.content).not.toContain("\\{1, 5\\}");
    expect(boards[1]?.content).toContain("(x-3)^2 = 4");
    expect(boards[2]?.content).toContain("\\pm\\sqrt{4}");
    expect(boards[2]?.content).toContain("\\{1, 5\\}");
    expect(result.segments[0].action).toBe("explain");
    expect(result.segments.slice(1).every((segment) => segment.action === "point")).toBe(true);
    expect(result.rawText).toContain("$$");
    expect(result.rawText).toContain("x^2 - 6x = -5");
    expect(result.rawText).not.toContain('"blackboard"');
    expect(sceneToPages(result).filter((page) => page.blackboard?.kind === "math")).toHaveLength(3);
  });

  it("only reveals the full code after explaining its definition and call", async () => {
    vi.useFakeTimers();
    const pending = demoReply("代码分步讲解", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;
    const boards = result.segments.flatMap((segment) => segment.blackboard ? [segment.blackboard] : []);

    expect(boards).toHaveLength(3);
    expect(boards[0].content).toContain("const greet");
    expect(boards[0].content).not.toContain("console.log");
    expect(boards[1].content).toContain("// 返回：你好，饲养员！");
    expect(boards[1].content).not.toContain("const greet");
    expect(boards[2].content).toContain("const greet");
    expect(boards[2].content).toContain("console.log");
    expect(result.rawText).toContain("```ts");
    expect(result.segments.every((segment) => !segment.text.includes("```"))).toBe(true);
  });

  it("does not add lecture actions to ordinary small talk", async () => {
    vi.useFakeTimers();
    const pending = demoReply("你好，在吗？", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    const result = await pending;

    expect(result.segments.every((segment) => segment.action === undefined)).toBe(true);
  });

  it.each([
    ["这是什么意思？", "confused"],
    ["我有点担心会失败，怎么办？", "worried"],
    ["问题终于解决了，可以松口气啦", "relieved"],
    ["好耶，我们成功了！", "excited"],
    ["哼，我生气了，不理你", "sulky"],
    ["不能放弃，一起加油", "determined"],
  ] as const)("maps %s to the %s scene", async (input, mood) => {
    vi.useFakeTimers();
    const pending = demoReply(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(620);
    await expect(pending).resolves.toMatchObject({ mood });
  });

  it("stops immediately when the request is aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = demoReply("你好", controller.signal);
    controller.abort("user");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
