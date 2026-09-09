import katex from "katex";

export const MAX_LATEX_CHARACTERS = 6_000;

export type LatexResult = { html: string; error?: never } | { html?: never; error: string };

/** Only KaTeX-generated markup may enter the renderer's HTML sink. */
export function renderLatex(source: string, displayMode: boolean): LatexResult {
  if (source.length > MAX_LATEX_CHARACTERS) {
    return { error: "公式较长，暂以 LaTeX 原文展示。可以请大肥鱼拆成几步。" };
  }
  try {
    const html = katex.renderToString(source, {
        displayMode,
        // Native MathML avoids KaTeX HTML's inline styles under our strict CSP.
        output: "mathml",
        throwOnError: true,
        trust: false,
        strict: "error",
        maxExpand: 500,
        maxSize: 20,
        // Do not let a definition in one formula leak into another one.
        macros: {},
        globalGroup: false,
      });
    // A future/rare MathML feature that requires inline CSS should degrade to
    // source, rather than silently rendering broken under style-src 'self'.
    if (/<[^>]*\sstyle\s*=/.test(html)) {
      return { error: "这条公式需要额外排版，暂以 LaTeX 原文展示。" };
    }
    return { html };
  } catch {
    // KaTeX error messages can contain unescaped model output. Never render them.
    return { error: "这条公式暂时无法排版，已保留 LaTeX 原文。" };
  }
}
