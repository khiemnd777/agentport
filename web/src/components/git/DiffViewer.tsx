interface Props {
  diff: string;
}

export default function DiffViewer({ diff }: Props) {
  return (
    <pre className="diff-viewer">
      {diff || "No diff for the selected scope."}
    </pre>
  );
}
