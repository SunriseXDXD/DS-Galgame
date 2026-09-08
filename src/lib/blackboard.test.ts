import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Blackboard } from "../components/Blackboard";
import { extractBlackboardPresentation } from "./blackboard";

describe("extractBlackboardPresentation", () => {
  it("moves fenced code to the board and leaves prose in dialogue", () => {
    const result = extractBlackboardPresentation("看这个实现：\n```ts\nconst answer = 42;\n```");

    expect(result.dialogueText).toBe("看这个实现：");
    expect(result.blackboard).toMatchObject({
      kind: "code",
      language: "ts",
      content: "const answer = 42;",
    });
  });

  it("uses a spoken cue when a fenced Markdown block has no surrounding prose", () => {
    const result = extractBlackboardPresentation("```markdown\n# 方案\n- 第一步\n- 第二步\n```");

    expect(result.dialogueText).toBe("整理好的内容已经放在黑板上了。");
    expect(result.blackboard?.kind).toBe("markdown");
    expect(result.blackboard?.content).toContain("# 方案");
  });

  it("recognizes an unfenced multi-line Markdown list", () => {
    const result = extractBlackboardPresentation("我把步骤列好了：\n1. 安装依赖\n2. 启动项目\n3. 打开页面");

    expect(result.dialogueText).toBe("我把步骤列好了：");
    expect(result.blackboard?.kind).toBe("markdown");
    expect(result.blackboard?.content).toContain("2. 启动项目");
  });

  it("keeps ordinary prose in the dialogue box", () => {
    const result = extractBlackboardPresentation("这是普通对话，不需要黑板。");

    expect(result).toEqual({ dialogueText: "这是普通对话，不需要黑板。" });
  });

  it("renders Markdown tables while escaping model-supplied HTML", () => {
    const html = renderToStaticMarkup(createElement(Blackboard, {
      content: {
        kind: "markdown",
        content: "| 项目 | 状态 |\n| --- | --- |\n| `<script>` | **完成** |",
      },
    }));

    expect(html).toContain("<table>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
