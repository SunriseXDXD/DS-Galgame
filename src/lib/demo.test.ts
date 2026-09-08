import { afterEach, describe, expect, it, vi } from "vitest";
import { demoReply } from "./demo";

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
    expect(result.segments.some((segment) => segment.text.includes(marker))).toBe(true);
    expect(new Set(result.segments.map((segment) => segment.mood)).size).toBeGreaterThan(1);
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
