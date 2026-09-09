import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import type { BlackboardContent } from "../types";
import { renderLatex } from "./blackboardLatex";
import "./Blackboard.css";

interface BlackboardProps {
  content?: BlackboardContent;
  /** One-based board position, independent of dialogue text pagination. */
  step?: { current: number; total: number };
  onPreviousStep?: () => void;
  onNextStep?: () => void;
}

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; start?: number; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; language?: string; text: string }
  | { kind: "math"; text: string };

const HEADING = /^(#{1,6})[ \t]+(.+)$/;
const UNORDERED_ITEM = /^\s*[-+*][ \t]+(.+)$/;
const ORDERED_ITEM = /^\s*(\d+)[.)][ \t]+(.+)$/;
const QUOTE = /^\s*>[ \t]?(.*)$/;
const FENCE = /^\s*```([A-Za-z0-9_+.-]*)\s*$/;
const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;
const MATH_FENCE_LANGUAGES = new Set(["math", "latex", "tex"]);

function MathFormula({ source, display = false }: { source: string; display?: boolean }) {
  const result = useMemo(() => renderLatex(source, display), [source, display]);
  const className = `blackboard__math${display ? " blackboard__math--display" : ""}`;
  if (result.error !== undefined) {
    return (
      <span className={`${className} blackboard__math--fallback`}>
        <code>{source}</code>
        <span className="blackboard__math-note">{result.error}</span>
      </span>
    );
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: result.html }} />;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function findClosing(source: string, delimiter: string, start: number): number {
  let cursor = source.indexOf(delimiter, start);
  while (cursor !== -1 && isEscaped(source, cursor)) cursor = source.indexOf(delimiter, cursor + delimiter.length);
  return cursor;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => TABLE_DIVIDER_CELL.test(cell));
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let plain = "";
  const flush = () => { if (plain) nodes.push(plain); plain = ""; };

  while (cursor < text.length) {
    const key = `${keyPrefix}-${cursor}`;
    // Code spans take priority; their dollars and TeX commands stay literal.
    if (text[cursor] === "`") {
      const marker = text.slice(cursor).match(/^`+/)?.[0] || "`";
      const end = text.indexOf(marker, cursor + marker.length);
      if (end !== -1) {
        flush();
        nodes.push(<code key={key}>{text.slice(cursor + marker.length, end)}</code>);
        cursor = end + marker.length;
        continue;
      }
    }
    if (text.startsWith("\\$", cursor)) {
      plain += "$";
      cursor += 2;
      continue;
    }

    const marker = text.startsWith("$$", cursor) ? "$$" :
      text.startsWith("\\[", cursor) ? "\\[" :
        text.startsWith("\\(", cursor) ? "\\(" : text[cursor] === "$" ? "$" : undefined;
    if (marker && !isEscaped(text, cursor)) {
      const closing = marker === "\\[" ? "\\]" : marker === "\\(" ? "\\)" : marker;
      const end = findClosing(text, closing, cursor + marker.length);
      const source = text.slice(cursor + marker.length, end);
      // Single dollars must hug their formula, avoiding common "$5 and $10" prose.
      if (end !== -1 && source.trim() && (marker !== "$" || (!/^\s|\s$/.test(source) && !source.includes("\n")))) {
        flush();
        nodes.push(<MathFormula key={key} source={source} display={marker === "$$" || marker === "\\["} />);
        cursor = end + closing.length;
        continue;
      }
      if (marker === "$$") {
        // An unclosed display marker must not become a single-dollar formula
        // when the scanner reaches its second dollar.
        plain += marker;
        cursor += marker.length;
        continue;
      }
    }

    if (text.startsWith("**", cursor)) {
      const end = text.indexOf("**", cursor + 2);
      if (end > cursor + 2) {
        flush();
        nodes.push(<strong key={key}>{renderInline(text.slice(cursor + 2, end), `${key}-strong`)}</strong>);
        cursor = end + 2;
        continue;
      }
    }
    plain += text[cursor];
    cursor += 1;
  }
  flush();
  return nodes;
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line) ||
    QUOTE.test(line) || FENCE.test(line) || /^(?:\$\$|\\\[)/.test(line.trim());
}

function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(MATH_FENCE_LANGUAGES.has(fence[1].toLowerCase()) ? {
        kind: "math", text: codeLines.join("\n"),
      } : { kind: "code", language: fence[1] || undefined, text: codeLines.join("\n") });
      continue;
    }

    // Parse standalone display blocks before tables/lists; TeX can contain pipes.
    const trimmed = line.trim();
    const displayMarker = trimmed.startsWith("$$") ? "$$" : trimmed.startsWith("\\[") ? "\\[" : undefined;
    if (displayMarker) {
      const closing = displayMarker === "$$" ? "$$" : "\\]";
      const remaining = lines.slice(index).join("\n").trimStart();
      const end = findClosing(remaining, closing, displayMarker.length);
      if (end !== -1 && !remaining.slice(end + closing.length).split("\n")[0].trim()) {
        const consumed = remaining.slice(0, end + closing.length);
        blocks.push({ kind: "math", text: consumed.slice(displayMarker.length, -closing.length).trim() });
        index += consumed.split("\n").length;
        continue;
      }
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const cells = tableCells(lines[index]);
        rows.push(headers.map((_header, cellIndex) => cells[cellIndex] || ""));
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const unordered = line.match(UNORDERED_ITEM);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(UNORDERED_ITEM);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    const ordered = line.match(ORDERED_ITEM);
    if (ordered) {
      const items: string[] = [];
      const start = Number(ordered[1]);
      while (index < lines.length) {
        const item = lines[index].match(ORDERED_ITEM);
        if (!item) break;
        items.push(item[2]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: true, start, items });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const nextQuote = lines[index].match(QUOTE);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join(" ").trim() });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function MarkdownHeading({ block, blockKey }: { block: Extract<MarkdownBlock, { kind: "heading" }>; blockKey: string }) {
  const children = renderInline(block.text, blockKey);
  const className = `blackboard__heading blackboard__heading--${block.level}`;

  if (block.level === 1) return <h3 className={className}>{children}</h3>;
  if (block.level === 2) return <h4 className={className}>{children}</h4>;
  if (block.level === 3) return <h5 className={className}>{children}</h5>;
  return <h6 className={className}>{children}</h6>;
}

function renderMarkdown(blocks: MarkdownBlock[]): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `markdown-${index}`;

    if (block.kind === "heading") {
      return <MarkdownHeading key={key} block={block} blockKey={key} />;
    }
    if (block.kind === "paragraph") {
      return <p key={key}>{renderInline(block.text, key)}</p>;
    }
    if (block.kind === "quote") {
      return <blockquote key={key}>{renderInline(block.text, key)}</blockquote>;
    }
    if (block.kind === "math") return <MathFormula key={key} source={block.text} display />;
    if (block.kind === "code") {
      return (
        <pre key={key} className="blackboard__code blackboard__code--fenced">
          <code data-language={block.language}>{block.text}</code>
        </pre>
      );
    }
    if (block.kind === "table") {
      return (
        <div key={key} className="blackboard__table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {block.headers.map((header, cellIndex) => (
                  <th key={`${key}-header-${cellIndex}`} scope="col">
                    {renderInline(header, `${key}-header-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-row-${rowIndex}-${cellIndex}`}>
                      {renderInline(cell, `${key}-row-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const List = block.ordered ? "ol" : "ul";
    return (
      <List key={key} start={block.ordered ? block.start : undefined}>
        {block.items.map((item, itemIndex) => (
          <li key={`${key}-item-${itemIndex}`}>
            {renderInline(item, `${key}-item-${itemIndex}`)}
          </li>
        ))}
      </List>
    );
  });
}

export function Blackboard({ content, step, onPreviousStep, onNextStep }: BlackboardProps) {
  const headingId = useId();
  const markdownBlocks = useMemo(
    () => content?.kind === "markdown" ? parseMarkdown(content.content) : [],
    [content?.content, content?.kind],
  );

  if (!content) return null;

  const language = content.kind === "code" ? content.language?.trim().slice(0, 20) : undefined;
  const title = content.title?.trim() || (content.kind === "code" ? "代码摘录" : content.kind === "math" ? "公式讲解" : "鲸鱼黑板");
  const total = step && Number.isFinite(step.total) ? Math.max(1, Math.floor(step.total)) : 1;
  const current = step && Number.isFinite(step.current) ? Math.max(1, Math.min(total, Math.floor(step.current))) : 1;

  return (
    <aside className={`blackboard blackboard--${content.kind}`} aria-labelledby={headingId}>
      <header className="blackboard__header">
        <span className="blackboard__eyebrow">BLACKBOARD / {content.kind === "code" ? "CODE" : content.kind === "math" ? "MATH" : "NOTE"}</span>
        <h2 id={headingId}>{title}</h2>
        <span className="blackboard__meta">{language || (content.kind === "code" ? "TEXT" : content.kind === "math" ? "LATEX" : "MARKDOWN")}</span>
        {step && (
          <nav className="blackboard__steps" aria-label="分步板书">
            <button type="button" onClick={onPreviousStep} disabled={!onPreviousStep || current <= 1}>上一板</button>
            <span role="status" aria-live="polite">第 {current} / {total} 板</span>
            <button type="button" onClick={onNextStep} disabled={!onNextStep || current >= total}>下一板</button>
          </nav>
        )}
      </header>
      <div key={`${content.kind}:${content.content}`} className="blackboard__body" tabIndex={0} aria-label="黑板内容，可滚动查看">
        {content.kind === "code" ? (
          <pre className="blackboard__code">
            <code data-language={language}>{content.content}</code>
          </pre>
        ) : content.kind === "math" ? (
          <MathFormula source={content.content} display />
        ) : (
          <div className="blackboard__markdown">{renderMarkdown(markdownBlocks)}</div>
        )}
      </div>
    </aside>
  );
}
