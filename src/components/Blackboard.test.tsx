import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Blackboard } from "./Blackboard";
import { MAX_LATEX_CHARACTERS, renderLatex } from "./blackboardLatex";
import type { BlackboardContent } from "../types";

function board(content: string, kind: BlackboardContent["kind"] = "markdown") {
  return renderToStaticMarkup(<Blackboard content={{ kind, content }} />);
}

describe("blackboard math and safe Markdown rendering", () => {
  it("renders raw TeX as accessible display math", () => {
    const html = board(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`, "math");
    expect(html).toContain('display="block"');
    expect(html).toContain("<math");
    expect(html).toContain("公式讲解");
    expect(html).not.toContain("blackboard__math--fallback");
  });

  it.each([
    ["single dollars", "斜率 $m=2$ 就是变化率。", false],
    ["parentheses", String.raw`斜率 \(m=2\) 就是变化率。`, false],
    ["double dollars", "$$\\frac{a}{b}$$", true],
    ["square brackets", String.raw`\[\sum_{n=1}^N n\]`, true],
    ["multiline display", "先看公式：\n$$\n\\begin{aligned}\ny&=2x+1\\\\\nx&=3\n\\end{aligned}\n$$\n然后代入。", true],
    ["embedded display", String.raw`结果是 $$x^2$$，记住它。`, true],
  ])("supports %s delimiters", (_name, source, display) => {
    const html = board(source as string);
    expect(html).toContain('class="katex"');
    expect(html.includes('display="block"')).toBe(display);
    expect(html).not.toContain("blackboard__math--fallback");
  });

  it.each(["math", "latex", "tex", "LaTeX"])("renders %s fenced formulas", (language) => {
    const html = board("```" + language + "\n\\sqrt{x}\n```");
    expect(html).toContain('display="block"');
    expect(html).not.toContain("blackboard__code--fenced");
  });

  it("leaves inline code, double-backtick spans and normal code fences untouched", () => {
    const html = board("`$x$` and ``\\(y\\)``\n\n```js\nconst cost = '$5';\n// $$x$$\n```");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("<code>$x$</code>");
    expect(html).toContain("<code>\\(y\\)</code>");
    expect(html).toContain("// $$x$$");
    expect(html).toContain('data-language="js"');
    expect(board("$x$ \\(y\\)", "code")).not.toContain('class="katex"');
  });

  it("does not confuse escaped dollars or common currency prose with math", () => {
    const html = board(String.raw`价格 \$5，另外 $5 and $10。尚未闭合 $x。`);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("价格 $5");
    expect(html).toContain("$5 and $10");
    expect(board("$$x$")).not.toContain('class="katex"');
  });

  it("preserves headings, emphasis, lists and tables with inline formulas", () => {
    const html = board("## 小课堂\n**结论 $x=2$**\n\n- 代入 $y=3$\n\n| 变量 | 值 |\n| --- | --- |\n| $x$ | 2 |");
    expect(html).toContain("<h4");
    expect(html).toContain("<strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html.match(/class="katex"/g)).toHaveLength(3);
  });

  it("keeps raw HTML escaped even beside math or inside invalid TeX", () => {
    const html = board('<img src=x onerror="alert(1)"> $x$\n\n<script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    const invalid = board(String.raw`\invalid{<img src=x onerror=alert(1)>}`, "math");
    expect(invalid).not.toContain("<img");
    expect(invalid).toContain("&lt;img");
    expect(invalid).toContain("已保留 LaTeX 原文");
  });

  it("does not permit TeX links, images or arbitrary HTML attributes", () => {
    for (const source of [
      String.raw`\href{javascript:alert(1)}{点我}`,
      String.raw`\includegraphics{https://example.com/pixel.png}`,
      String.raw`\htmlStyle{background:url(https://example.com/pixel.png)}{x}`,
      String.raw`\htmlClass{injected}{x}`,
    ]) {
      const html = board(source, "math");
      expect(html).not.toMatch(/<(?:img|a)\b/);
      expect(html).not.toMatch(/class="injected"/);
      expect(html).not.toContain('style="background:url(');
    }
  });

  it("shows invalid formulas and expansion loops as source without crashing", () => {
    for (const source of [String.raw`\frac{1}{`, String.raw`\def\x{\x}\x`]) {
      const html = board(source, "math");
      expect(html).toContain("blackboard__math--fallback");
      expect(html).toContain("已保留 LaTeX 原文");
      expect(html).not.toContain("ParseError");
    }
  });

  it("bounds long source and prevents macro definitions leaking between renders", () => {
    expect(renderLatex("x".repeat(MAX_LATEX_CHARACTERS + 1), true).error).toContain("公式较长");
    expect(renderLatex(String.raw`\gdef\fish{x}\fish`, false).html).toBeDefined();
    expect(renderLatex(String.raw`\fish`, false).error).toBeDefined();
    const size = renderLatex(String.raw`\rule{999em}{999em}`, true);
    expect(size.html).toContain('width="20em" height="20em"');
    expect(size.html).not.toContain('width="999em"');
  });

  it("renders common formulas without inline styles under the production CSP", () => {
    for (const source of [
      String.raw`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
      String.raw`\int_0^1 x^2\,dx=\frac13`,
      String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
      String.raw`\begin{aligned}y&=2x+1\\x&=3\end{aligned}`,
      String.raw`\color{red}{x}+\mathbb{R}`,
    ]) {
      const result = renderLatex(source, true);
      expect(result.error).toBeUndefined();
      expect(result.html).toContain("<math");
      expect(result.html).not.toMatch(/<[^>]*\sstyle\s*=/);
    }
  });
});

describe("blackboard step controls", () => {
  const content: BlackboardContent = { kind: "markdown", content: "当前一步" };

  it("shows a compact accessible progress navigator with available actions", () => {
    const html = renderToStaticMarkup(<Blackboard content={content} step={{ current: 2, total: 3 }} onPreviousStep={() => {}} onNextStep={() => {}} />);
    expect(html).toContain('aria-label="分步板书"');
    expect(html).toContain("第 2 / 3 板");
    expect(html).toContain("上一板");
    expect(html).toContain("下一板");
    expect(html).not.toContain('disabled=""');
  });

  it("disables absent callbacks and clamps invalid progress", () => {
    const html = renderToStaticMarkup(<Blackboard content={content} step={{ current: 999, total: 3 }} />);
    expect(html).toContain("第 3 / 3 板");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables boundary actions and omits navigation when no step was supplied", () => {
    const first = renderToStaticMarkup(<Blackboard content={content} step={{ current: 1, total: 3 }} onPreviousStep={() => {}} onNextStep={() => {}} />);
    expect(first).toContain('disabled="">上一板');
    expect(first).not.toContain('disabled="">下一板');
    expect(renderToStaticMarkup(<Blackboard content={content} />)).not.toContain('aria-label="分步板书"');
    expect(renderToStaticMarkup(<Blackboard />)).toBe("");
  });
});
