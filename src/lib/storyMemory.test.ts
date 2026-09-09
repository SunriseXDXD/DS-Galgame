import { describe, expect, it } from "vitest";
import { captureSaveSnapshot, createSaveSlotId } from "./saveSlots";
import { restoreStoryState } from "./storyMemory";
import { sceneToPages, segmentsToHistoryText } from "./dialogue";
import { getBlackboardState } from "./blackboard";
import type { SceneSegment } from "../types";

function snapshot() {
  return captureSaveSnapshot({
    slotId: createSaveSlotId("slot-1"), capturedAt: 10, pageIndex: 1, model: "deepseek-v4-pro",
    scene: {
      mood: "thinking",
      segments: [
        { kind: "dialogue", text: "先看这里。", mood: "thinking", action: "explain" },
        { kind: "dialogue", text: "```ts\nconst x = 1;\n```", mood: "proud", action: "point" },
      ], suggestions: ["继续"], rawText: "先看这里。\nconst x = 1;",
    },
    history: [
      { id: "u", role: "user", content: "写一行代码", createdAt: 1 },
      { id: "a", role: "assistant", content: "先看这里。", createdAt: 2, mood: "thinking" },
    ],
  });
}

describe("restoring story memory", () => {
  it("restores dialogue context, actions and blackboard source without sharing mutable objects", () => {
    const saved = snapshot();
    const restored = restoreStoryState(saved);
    expect(restored).toEqual(saved.state);
    expect(restored.scene).not.toBe(saved.state.scene);
    expect(restored.history).not.toBe(saved.state.history);
    expect(restored.scene.segments[1].action).toBe("point");
  });

  it("clamps an old page index after pagination changes", () => {
    const saved = snapshot();
    expect(restoreStoryState({ ...saved, state: { ...saved.state, pageIndex: 999 } }).pageIndex).toBe(1);
  });

  it("respects currently supported models and never restores credential fields", () => {
    const saved = snapshot();
    expect(restoreStoryState(saved, ["deepseek-v4-flash"]).model).toBe("deepseek-v4-flash");
    expect(Object.keys(restoreStoryState(saved)).sort()).toEqual(["history", "model", "pageIndex", "scene"]);
    expect(() => restoreStoryState({ ...saved, state: { ...saved.state, apiKey: "sk-not-a-real-key" } })).toThrow();
  });

  it("restores the exact teaching board and supports independent replay navigation and clearing", () => {
    const segments: SceneSegment[] = [
      { kind: "dialogue", text: "先看原方程。", blackboard: { kind: "math", content: "x^2=4", title: "第一板" } },
      { kind: "dialogue", text: "注意有正负两个根。" },
      { kind: "dialogue", text: "这就是结果。", blackboard: { kind: "math", content: String.raw`x=\pm 2`, title: "第二板" } },
      { kind: "dialogue", text: "先擦掉，下一题。", blackboard: null },
    ];
    const rawText = segmentsToHistoryText(segments);
    const saved = captureSaveSnapshot({
      slotId: createSaveSlotId("slot-2"), capturedAt: 200, pageIndex: 2, model: "deepseek-v4-flash",
      scene: { mood: "thinking", segments, suggestions: [], rawText },
      history: [{ id: "assistant", role: "assistant", content: rawText, createdAt: 100 }],
    });
    const restored = restoreStoryState(JSON.parse(JSON.stringify(saved)));
    const pages = sceneToPages(restored.scene);
    expect(getBlackboardState(pages, restored.pageIndex)).toMatchObject({
      content: { kind: "math", content: String.raw`x=\pm 2` },
      step: { current: 2, total: 2 }, previousPageIndex: 0,
    });
    expect(getBlackboardState(pages, 1).content?.content).toBe("x^2=4");
    expect(getBlackboardState(pages, 3)).toEqual({});
    expect(restored.history[0].content).toContain(String.raw`x=\pm 2`);
    expect(restored.pageIndex).toBe(2);
    expect(saved.state.scene.segments).toEqual(segments);
  });
});
