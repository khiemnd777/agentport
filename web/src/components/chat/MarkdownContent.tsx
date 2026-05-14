import { Fragment, type ReactNode } from "react";

interface Props {
  content: string;
  onFileLinkClick?: (link: MarkdownFileLink) => void;
}

export interface MarkdownFileLink {
  label: string;
  target: string;
}

type Block =
  | { type: "code"; language: string | null; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "paragraph"; text: string };

interface DiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  rows: DiffSummaryRow[];
}

interface DiffSummaryRow {
  path: string;
  name: string;
  dir: string;
  additions: number;
  deletions: number;
}

type GitDirectiveKind = "stage" | "commit" | "push" | "create-branch" | "create-pr";

interface GitDirective {
  kind: GitDirectiveKind;
  attrs: Record<string, string>;
}

export default function MarkdownContent({ content, onFileLinkClick }: Props) {
  const { markdown, gitDirectives } = extractGitDirectives(content);
  const blocks = parseMarkdown(markdown);
  if (blocks.length === 0 && gitDirectives.length === 0) {
    return null;
  }
  return (
    <div className="markdown-content">
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, onFileLinkClick)}</Fragment>
      ))}
      {gitDirectives.length ? <GitDirectiveBlock directives={gitDirectives} /> : null}
    </div>
  );
}

function renderBlock(block: Block, onFileLinkClick?: (link: MarkdownFileLink) => void): ReactNode {
  if (block.type === "code") {
    const diffSummary = parseDiffSummary(block.text);
    if (diffSummary) {
      return <ChatDiffSummaryBlock summary={diffSummary} onFileLinkClick={onFileLinkClick} />;
    }
    return (
      <pre className="markdown-code">
        {block.language ? <span className="markdown-code-language">{block.language}</span> : null}
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === "heading") {
    const Tag = headingTag(block.level);
    return <Tag>{renderInline(block.text, onFileLinkClick)}</Tag>;
  }
  if (block.type === "blockquote") {
    return <blockquote>{renderInline(block.text, onFileLinkClick)}</blockquote>;
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag>
        {block.items.map((item, index) => (
          <li key={index}>{renderInline(item, onFileLinkClick)}</li>
        ))}
      </Tag>
    );
  }
  if (block.type === "table") {
    const [head, ...body] = block.rows;
    return (
      <div className="markdown-table-wrap">
        <table>
          <thead>
            <tr>{head.map((cell, index) => <th key={index}>{renderInline(cell, onFileLinkClick)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell, onFileLinkClick)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <p>{renderInline(block.text, onFileLinkClick)}</p>;
}

function ChatDiffSummaryBlock({
  summary,
  onFileLinkClick
}: {
  summary: DiffSummary;
  onFileLinkClick?: (link: MarkdownFileLink) => void;
}) {
  return (
    <div className="markdown-diff-summary">
      <div className="changed-file-row summary markdown-diff-summary-header">
        <span className="changed-file-main">
          <span className="changed-file-name">Changes</span>
          <span className="changed-file-dir">
            {summary.fileCount} {summary.fileCount === 1 ? "file" : "files"} changed
          </span>
        </span>
        <ChangeStats additions={summary.additions} deletions={summary.deletions} />
      </div>
      <div className="markdown-diff-summary-list">
        {summary.rows.map((row) => (
          <button
            className="changed-file-row markdown-diff-summary-row"
            type="button"
            key={row.path}
            onClick={() => onFileLinkClick?.({ label: row.path, target: row.path })}
          >
            <span className="file-status modified">M</span>
            <span className="changed-file-main">
              <span className="changed-file-name">{row.name}</span>
              <span className="changed-file-dir">{row.dir || "./"}</span>
            </span>
            <ChangeStats additions={row.additions} deletions={row.deletions} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ChangeStats({ additions, deletions }: { additions?: number; deletions?: number }) {
  const hasAdditions = typeof additions === "number";
  const hasDeletions = typeof deletions === "number";
  if (!hasAdditions && !hasDeletions) {
    return <span className="change-stats empty" aria-hidden="true" />;
  }
  return (
    <span className="change-stats">
      {hasAdditions ? <span className="change-stat additions">+{additions}</span> : null}
      {hasDeletions ? <span className="change-stat deletions">-{deletions}</span> : null}
    </span>
  );
}

function GitDirectiveBlock({ directives }: { directives: GitDirective[] }) {
  return (
    <div className="markdown-git-directives" aria-label="Git actions applied">
      <div className="markdown-git-directives-title">Git actions applied</div>
      <ul>
        {directives.map((directive, index) => (
          <li key={`${directive.kind}-${index}`}>
            <span className="markdown-git-directive-status" aria-hidden="true">
              OK
            </span>
            <span>{gitDirectiveLabel(directive)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function gitDirectiveLabel(directive: GitDirective): string {
  if (directive.kind === "stage") {
    return "Staged changes";
  }
  if (directive.kind === "commit") {
    return "Created commit";
  }
  if (directive.kind === "push") {
    return directive.attrs.branch ? `Pushed ${directive.attrs.branch}` : "Pushed branch";
  }
  if (directive.kind === "create-branch") {
    return directive.attrs.branch ? `Created branch ${directive.attrs.branch}` : "Created branch";
  }
  if (directive.kind === "create-pr") {
    const draft = directive.attrs.isDraft === "true" ? "draft " : "";
    return `Opened ${draft}pull request`;
  }
  return "Applied git action";
}

function extractGitDirectives(content: string): { markdown: string; gitDirectives: GitDirective[] } {
  const gitDirectives: GitDirective[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const markdownLines = lines.filter((line) => {
    const directive = parseGitDirective(line);
    if (!directive) {
      return true;
    }
    gitDirectives.push(directive);
    return false;
  });
  return {
    markdown: markdownLines.join("\n").trim(),
    gitDirectives
  };
}

function parseGitDirective(line: string): GitDirective | null {
  const match = line.trim().match(/^::git-(stage|commit|push|create-branch|create-pr)\{([^}]*)\}$/);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] as GitDirectiveKind,
    attrs: parseDirectiveAttrs(match[2])
  };
}

function parseDirectiveAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z][A-Za-z0-9]*)=(?:"([^"]*)"|([^\s}]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(input))) {
    attrs[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attrs;
}

function parseMarkdown(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language: fence[1] ?? null, text: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const current = orderedList
          ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/)
          : lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!current) {
          break;
        }
        items.push(current[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows: string[][] = [parseTableRow(lines[index])];
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks;
}

function parseDiffSummary(text: string): DiffSummary | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  const header = parseDiffSummaryHeader(lines[0]);
  if (!header) {
    return null;
  }

  const rows = lines.slice(1).map(parseDiffSummaryRow).filter((row): row is DiffSummaryRow => Boolean(row));
  if (!rows.length) {
    return null;
  }

  const rowTotals = rows.reduce(
    (total, row) => ({
      additions: total.additions + row.additions,
      deletions: total.deletions + row.deletions
    }),
    { additions: 0, deletions: 0 }
  );

  return {
    fileCount: header.fileCount,
    additions: header.additions ?? rowTotals.additions,
    deletions: header.deletions ?? rowTotals.deletions,
    rows
  };
}

function parseDiffSummaryHeader(line: string): { fileCount: number; additions?: number; deletions?: number } | null {
  const compact = line.match(/^(\d+)\s+files?\s+changed(?:\s+\+(\d+))?(?:\s+[−-](\d+))?\s*$/i);
  if (compact) {
    return {
      fileCount: Number(compact[1]),
      additions: compact[2] ? Number(compact[2]) : undefined,
      deletions: compact[3] ? Number(compact[3]) : undefined
    };
  }

  const verbose = line.match(/^(\d+)\s+files?\s+changed,\s+(\d+)\s+insertions?\(\+\),\s+(\d+)\s+deletions?\(-\)\s*$/i);
  if (!verbose) {
    return null;
  }
  return {
    fileCount: Number(verbose[1]),
    additions: Number(verbose[2]),
    deletions: Number(verbose[3])
  };
}

function parseDiffSummaryRow(line: string): DiffSummaryRow | null {
  const match = line.match(/^(.+?)\s+\+(\d+)\s+[−-](\d+)\s*$/);
  if (!match) {
    return null;
  }
  const additions = Number(match[2]);
  const deletions = Number(match[3]);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
    return null;
  }
  const path = match[1].trim();
  const pathParts = splitPath(path);
  return {
    path,
    name: pathParts.name,
    dir: pathParts.dir,
    additions,
    deletions
  };
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.split("/");
  const name = parts.pop() || filePath;
  return {
    dir: parts.join("/"),
    name
  };
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    /^```/.test(line) ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    /^\s*\|.+\|\s*$/.test(lines[index] ?? "") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "")
  );
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderInline(text: string, onFileLinkClick?: (link: MarkdownFileLink) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((?!#)[^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(...renderTextWithBreaks(text.slice(lastIndex, match.index), nodes.length));
    }
    nodes.push(renderInlineToken(match[0], nodes.length, onFileLinkClick));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(...renderTextWithBreaks(text.slice(lastIndex), nodes.length));
  }
  return nodes;
}

function headingTag(level: number): "h1" | "h2" | "h3" | "h4" {
  if (level <= 1) {
    return "h1";
  }
  if (level === 2) {
    return "h2";
  }
  if (level === 3) {
    return "h3";
  }
  return "h4";
}

function renderInlineToken(token: string, key: number, onFileLinkClick?: (link: MarkdownFileLink) => void): ReactNode {
  if (token.startsWith("`")) {
    return <code key={key}>{token.slice(1, -1)}</code>;
  }
  if (token.startsWith("**")) {
    return <strong key={key}>{token.slice(2, -2)}</strong>;
  }
  if (token.startsWith("*")) {
    return <em key={key}>{token.slice(1, -1)}</em>;
  }
  const link = token.match(/^\[([^\]]+)\]\(((?!#)[^)\s]+)\)$/);
  if (link) {
    const target = link[2];
    if (!/^https?:\/\//.test(target)) {
      return (
        <button
          key={key}
          className="markdown-file-link"
          type="button"
          title={target}
          onClick={() => onFileLinkClick?.({ label: link[1], target })}
        >
          {link[1]}
        </button>
      );
    }
    return (
      <a key={key} href={target} target="_blank" rel="noreferrer">
        {link[1]}
      </a>
    );
  }
  return token;
}

function renderTextWithBreaks(text: string, keyPrefix: number): ReactNode[] {
  return text.split("\n").flatMap((part, index, parts) => {
    const nodes: ReactNode[] = [<Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>];
    if (index < parts.length - 1) {
      nodes.push(<br key={`${keyPrefix}-${index}-br`} />);
    }
    return nodes;
  });
}
