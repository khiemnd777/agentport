import { FolderGit2 } from "lucide-react";
import type { PublicRepo } from "../../api/client";

interface Props {
  repos: PublicRepo[];
  selectedRepoKey: string | null;
  onSelect: (repoKey: string) => void;
}

export default function RepoSwitcher({ repos, selectedRepoKey, onSelect }: Props) {
  return (
    <label className="repo-switcher">
      <span>
        <FolderGit2 size={16} /> Repository
      </span>
      <select value={selectedRepoKey ?? ""} onChange={(event) => onSelect(event.target.value)}>
        {repos.map((repo) => (
          <option key={repo.key} value={repo.key}>
            {repo.label}
          </option>
        ))}
      </select>
    </label>
  );
}
