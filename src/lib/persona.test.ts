import { describe, expect, it } from "vitest";
import { parseScenePayload, sceneToPages } from "./dialogue";
import { SYSTEM_PROMPT } from "./persona";

function extractExampleJson(): string {
  const startMarker = "示例 JSON 输出：";
  const endMarker = "示例结束。";
  const start = SYSTEM_PROMPT.indexOf(startMarker);
  const end = SYSTEM_PROMPT.indexOf(endMarker, start + startMarker.length);

  if (start < 0 || end < 0) {
    throw new Error("Persona JSON example markers are missing.");
  }

  return SYSTEM_PROMPT.slice(start + startMarker.length, end).trim();
}

describe("persona prompt example", () => {
  it("is valid scene JSON and teaches the code blackboard contract", () => {
    expect(SYSTEM_PROMPT).toContain("json");
    const example = extractExampleJson();
    expect(() => JSON.parse(example)).not.toThrow();

    const scene = parseScenePayload(example);
    expect(scene.mood).toBe("determined");
    expect(scene.segments.map((segment) => segment.mood)).toEqual([
      "determined",
      "sulky",
      "thinking",
      "determined",
      "relieved",
    ]);
    expect(scene.segments.map((segment) => segment.kind)).toContain("thought");
    expect(scene.suggestions).toEqual(["补一个单元测试", "改成抛出异常"]);

    const codePage = sceneToPages(scene).find((page) => page.blackboard?.kind === "code");
    expect(codePage?.blackboard).toMatchObject({
      kind: "code",
      language: "ts",
    });
    expect(codePage?.blackboard?.content).toContain("export function average");
    expect(codePage?.action).toBe("point");
    expect(scene.segments.at(-1)?.action).toBe("explain");
    expect(scene.rawText).not.toContain('"segments"');
  });
});
