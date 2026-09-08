import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import type { BlackboardContent } from "../types";

interface BlackboardProps {
  content?: BlackboardContent;
}

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; start?: number; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; language?: string; text: string };

const INLINE_TOKEN = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
const HEADING = /^(#{1,6})[ \t]+(.+)$/;
const UNORDERED_ITEM = /^\s*[-+*][ \t]+(.+)$/;
const ORDERED_ITEM = /^\s*(\d+)[.)][ \t]+(.+)$/;
const QUOTE = /^\s*>[ \t]?(.*)$/;
const FENCE = /^\s*```([A-Za-z0-9_+.-]*)\s*$/;
const TABLE_DIVIDER_CELL = /^:?-{3,}:?$/;

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
  let tokenIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(
        <strong key={key}>
          {renderInline(token.slice(2, -2), `${key}-strong`)}
        </strong>,
      );
    }

    cursor = index + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line) ||
    QUOTE.test(line) || FENCE.test(line);
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
      blocks.push({
        kind: "code",
        language: fence[1] || undefined,
        text: codeLines.join("\n"),
      });
      continue;
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
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
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

export function Blackboard({ content }: BlackboardProps) {
  const headingId = useId();
  const markdownBlocks = useMemo(
    () => content?.kind === "markdown" ? parseMarkdown(content.content) : [],
    [content?.content, content?.kind],
  );

  if (!content) return null;

  const language = content.kind === "code" ? content.language?.trim().slice(0, 20) : undefined;
  const title = content.title?.trim() || (content.kind === "code" ? "代码摘录" : "鲸鱼黑板");

  return (
    <aside className={`blackboard blackboard--${content.kind}`} aria-labelledby={headingId}>
      <header className="blackboard__header">
        <span className="blackboard__eyebrow">BLACKBOARD / {content.kind === "code" ? "CODE" : "NOTE"}</span>
        <h2 id={headingId}>{title}</h2>
        <span className="blackboard__meta">{language || (content.kind === "code" ? "TEXT" : "MARKDOWN")}</span>
      </header>
      <div className="blackboard__body" tabIndex={0} aria-label="黑板内容，可滚动查看">
        {content.kind === "code" ? (
          <pre className="blackboard__code">
            <code data-language={language}>{content.content}</code>
          </pre>
        ) : (
          <div className="blackboard__markdown">{renderMarkdown(markdownBlocks)}</div>
        )}
      </div>
    </aside>
  );
}
