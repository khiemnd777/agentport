import type { ReactNode } from "react";

export default function RightPanel({ children }: { children: ReactNode }) {
  return <aside className="right-panel">{children}</aside>;
}
