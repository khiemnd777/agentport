interface Props {
  diff: string;
}

type DiffLineKind = "addition" | "deletion" | "context" | "file" | "hunk" | "meta" | "path";

interface DiffLine {
  content: string;
  kind: DiffLineKind;
  marker: string;
  newLine: number | null;
  oldLine: number | null;
}

export default function DiffViewer({ diff }: Props) {
  if (!diff.trim()) {
    return <div className="diff-viewer empty">No diff for the selected scope.</div>;
  }

  const lines = parseDiff(diff);

  return (
    <div className="diff-viewer" role="region" aria-label="Git diff">
      <div className="diff-lines">
        {lines.map((line, index) => (
          <div className={`diff-line diff-line-${line.kind}`} key={`${index}-${line.kind}`}>
            <span className="diff-line-number">{line.oldLine ?? ""}</span>
            <span className="diff-line-number">{line.newLine ?? ""}</span>
            <span className="diff-line-marker">{line.marker}</span>
            <code className="diff-line-code">{line.content || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseDiff(diff: string): DiffLine[] {
  const rawLines = diff.replace(/\r\n/g, "\n").split("\n");
  if (rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  let oldLine: number | null = null;
  let newLine: number | null = null;

  return rawLines.map((rawLine) => {
    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      return toDiffLine(rawLine, "hunk", "", null, null);
    }

    if (rawLine.startsWith("diff --git ")) {
      oldLine = null;
      newLine = null;
      return toDiffLine(rawLine, "file", "", null, null);
    }

    if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ")) {
      return toDiffLine(rawLine, "path", rawLine[0], null, null, rawLine.slice(1));
    }

    if (isDiffMetaLine(rawLine)) {
      return toDiffLine(rawLine, "meta", "", null, null);
    }

    if (rawLine.startsWith("+") && newLine !== null) {
      const currentNewLine = newLine;
      newLine += 1;
      return toDiffLine(rawLine, "addition", "+", null, currentNewLine, rawLine.slice(1));
    }

    if (rawLine.startsWith("-") && oldLine !== null) {
      const currentOldLine = oldLine;
      oldLine += 1;
      return toDiffLine(rawLine, "deletion", "-", currentOldLine, null, rawLine.slice(1));
    }

    if (oldLine !== null && newLine !== null) {
      const currentOldLine = oldLine;
      const currentNewLine = newLine;
      oldLine += 1;
      newLine += 1;
      return toDiffLine(rawLine, "context", rawLine.startsWith(" ") ? "" : " ", currentOldLine, currentNewLine, rawLine.replace(/^ /, ""));
    }

    return toDiffLine(rawLine, "context", "", null, null);
  });
}

function toDiffLine(
  rawLine: string,
  kind: DiffLineKind,
  marker: string,
  oldLine: number | null,
  newLine: number | null,
  content = rawLine
): DiffLine {
  return {
    content,
    kind,
    marker,
    newLine,
    oldLine
  };
}

function isDiffMetaLine(line: string): boolean {
  return (
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("\\ No newline at end of file")
  );
}
