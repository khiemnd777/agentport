import { FolderGit2, Settings2 } from "lucide-react";
import type { PublicRepo } from "../../api/client";

interface Props {
  repos: PublicRepo[];
  selectedRepoKey: string | null;
  onSelect: (repoKey: string) => void;
  onManage: () => void;
}

export default function RepoSwitcher({ repos, selectedRepoKey, onSelect, onManage }: Props) {
  return (
    <div className="repo-switcher">
      <div className="repo-switcher-heading">
        <span>
          <FolderGit2 size={16} /> Repository
        </span>
        <button type="button" className="repo-manage-button" onClick={onManage}>
          <Settings2 size={14} /> Manage
        </button>
      </div>
      <select value={selectedRepoKey ?? ""} onChange={(event) => onSelect(event.target.value)}>
        {repos.map((repo) => (
          <option key={repo.key} value={repo.key}>
            {repo.label}
          </option>
        ))}
      </select>
    </div>
  );
}
