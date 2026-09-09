import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogueBox } from "./DialogueBox";

function renderDialogue(pageIndex: number, pageTotal: number, waiting = false) {
  return renderToStaticMarkup(<DialogueBox
    page={{ id: `page-${pageIndex}`, text: "这一句还没有播放完。", kind: "dialogue" }}
    pageIndex={pageIndex} pageTotal={pageTotal} suggestions={["下一轮选项"]}
    waiting={waiting} streamLength={0} typeSpeed={20} autoPlay={false}
    interactionEnabled onAutoPlayChange={() => {}} onAdvance={() => {}}
    onSubmit={() => {}} onChoice={() => {}} onStop={() => {}} onSound={() => {}}
  />);
}

describe("dialogue reply controls", () => {
  it.each([[0, 4], [3, 4], [0, 1]])("keeps reply controls hidden before page %i of %i finishes typing", (index, count) => {
    const html = renderDialogue(index, count);
    expect(html).not.toContain("下一轮选项");
    expect(html).not.toContain('aria-label="输入消息"');
    expect(html).toContain("type-caret");
  });

  it("never offers a new turn during generation", () => {
    const html = renderDialogue(3, 4, true);
    expect(html).toContain("正在把回答编排成分镜");
    expect(html).not.toContain("下一轮选项");
    expect(html).not.toContain('aria-label="输入消息"');
  });
});
