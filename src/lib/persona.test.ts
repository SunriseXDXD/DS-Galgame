import { describe, expect, it } from "vitest";
import { parseScenePayload, sceneToPages } from "./dialogue";
import { SYSTEM_PROMPT } from "./persona";

function extractExampleJson(): string[] {
  const startMarker = "示例 JSON 输出：";
  const endMarker = "示例结束。";
  const examples: string[] = [];
  let cursor = 0;
  while (true) {
    const start = SYSTEM_PROMPT.indexOf(startMarker, cursor);
    if (start < 0) break;
    const end = SYSTEM_PROMPT.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error("Persona JSON example end marker is missing.");
    examples.push(SYSTEM_PROMPT.slice(start + startMarker.length, end).trim());
    cursor = end + endMarker.length;
  }
  if (!examples.length) throw new Error("Persona JSON example markers are missing.");
  return examples;
}

describe("persona prompt example", () => {
  it("is valid scene JSON and teaches the code blackboard contract", () => {
    expect(SYSTEM_PROMPT).toContain("json");
    const [example] = extractExampleJson();
    expect(() => JSON.parse(example)).not.toThrow();

    const scene = parseScenePayload(example);
    expect(scene.mood).toBe("determined");
    expect(scene.segments.map((segment) => segment.mood)).toEqual([
      "thinking",
      "thinking",
      "determined",
      "relieved",
    ]);
    expect(scene.suggestions).toEqual(["补一个单元测试", "改成抛出异常"]);

    const codePages = sceneToPages(scene).filter((page) => page.blackboard?.kind === "code");
    expect(codePages[0]?.blackboard).toMatchObject({
      kind: "code",
      language: "ts",
    });
    expect(codePages[0]?.blackboard?.content).toBe("if (values.length === 0) return null;");
    expect(codePages[0]?.blackboard?.content).not.toContain("reduce");
    expect(codePages.some((page) => page.blackboard?.content.includes("export function average"))).toBe(true);
    expect(scene.segments[0].action).toBe("explain");
    expect(scene.segments[1].action).toBe("point");
    expect(scene.segments.at(-1)?.action).toBe("explain");
    expect(scene.rawText).not.toContain('"segments"');
  });

  it("uses valid JSON-escaped LaTeX in three small, ordered teaching boards", () => {
    const examples = extractExampleJson();
    expect(examples).toHaveLength(2);
    const mathExample = examples[1];
    expect(() => JSON.parse(mathExample)).not.toThrow();
    const scene = parseScenePayload(mathExample);
    const boards = scene.segments.map((segment) => segment.blackboard);

    expect(boards.map((board) => board?.kind)).toEqual(["math", "math", "math"]);
    expect(boards[0]?.content).toContain("x^2 - 6x = -5");
    expect(boards[0]?.content).not.toContain("\\sqrt");
    expect(boards[1]?.content).toContain("(x-3)^2 = 4");
    expect(boards[2]?.content).toContain("\\pm\\sqrt{4}");
    expect(boards[2]?.content).toContain("\\{1, 5\\}");
    expect(mathExample).toContain("\\\\sqrt");
    expect(scene.segments.every((segment) => !segment.text.includes("\\quad"))).toBe(true);
    expect(SYSTEM_PROMPT).toContain("省略时保留前一镜的黑板");
    expect(SYSTEM_PROMPT).toContain("写 null 时清空");
    expect(SYSTEM_PROMPT).toContain("不输出模型内部推理");
    // Each sample is a compact single reply, not an unbounded whole lesson.
    expect(examples.every((example) => example.length < 1_600)).toBe(true);
  });
});
