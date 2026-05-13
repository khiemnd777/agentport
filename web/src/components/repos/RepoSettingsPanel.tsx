import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  RefreshCw,
  RotateCw,
  Star,
  Trash2,
  X
} from "lucide-react";
import type { PublicRepo, RepoDiscoveryStatus, RepoResolveCandidate } from "../../api/client";

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<{ name: string }>;
}

interface Props {
  repos: PublicRepo[];
  defaultRepo: string;
  repoDiscovery: RepoDiscoveryStatus | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onResolveFolder: (folderName: string) => Promise<{
    folderName: string;
    repoDiscovery: RepoDiscoveryStatus;
    candidates: RepoResolveCandidate[];
  }>;
  onAddRepo: (input: {
    folderName: string;
    label: string;
    key: string;
    candidateId?: string;
  }) => Promise<void>;
  onRemoveRepo: (repoKey: string) => Promise<void>;
  onSetDefaultRepo: (repoKey: string) => Promise<void>;
  onRestartServer: () => Promise<void>;
}

export default function RepoSettingsPanel({
  repos,
  defaultRepo,
  repoDiscovery,
  onClose,
  onRefresh,
  onResolveFolder,
  onAddRepo,
  onRemoveRepo,
  onSetDefaultRepo,
  onRestartServer
}: Props) {
  const [label, setLabel] = useState("");
  const [repoKey, setRepoKey] = useState("");
  const [folderName, setFolderName] = useState("");
  const [manualFolderName, setManualFolderName] = useState("");
  const [candidates, setCandidates] = useState<RepoResolveCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [busy, setBusy] = useState<"idle" | "refresh" | "resolve" | "add" | "remove" | "default" | "restart">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const directoryPickerSupported =
    typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";

  const canAdd =
    busy === "idle" &&
    Boolean(label.trim()) &&
    Boolean(repoKey.trim()) &&
    Boolean(folderName) &&
    (candidates.length === 1 || Boolean(selectedCandidateId));

  async function run(action: typeof busy, task: () => Promise<void>): Promise<void> {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("idle");
    }
  }

  async function handleRefresh() {
    await run("refresh", async () => {
      await onRefresh();
      setMessage("Repositories refreshed.");
    });
  }

  async function handleSelectFolder() {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError("This browser does not support folder selection. Enter the folder name below.");
      return;
    }

    try {
      const handle = await picker.call(window, { mode: "read" });
      await resolveFolderName(handle.name);
    } catch (err) {
      if ((err as DOMException).name === "AbortError") {
        return;
      }
      setError((err as Error).message || "Could not select the project folder.");
    }
  }

  async function handleResolveManualFolder() {
    await resolveFolderName(manualFolderName);
  }

  async function resolveFolderName(value: string) {
    const selectedFolderName = value.trim();
    if (!selectedFolderName) {
      setError("Enter a project folder name.");
      return;
    }

    const nextLabel = label.trim() || titleize(selectedFolderName);
    setFolderName(selectedFolderName);
    setLabel(nextLabel);
    setRepoKey((current) => current || slugifyRepoKey(nextLabel || selectedFolderName));
    setManualFolderName(selectedFolderName);
    setCandidates([]);
    setSelectedCandidateId("");

    await run("resolve", async () => {
      const result = await onResolveFolder(selectedFolderName);
      setCandidates(result.candidates);
      if (result.candidates.length === 1) {
        setSelectedCandidateId(result.candidates[0].id);
        setRepoKey((current) => current || result.candidates[0].suggestedKey);
      }
      if (!result.repoDiscovery.configured) {
        setError("Repo discovery search roots are not configured on the server.");
        return;
      }
      if (!result.candidates.length) {
        setError("No matching folder was found on the MacBook.");
        return;
      }
      setMessage(
        result.candidates.length === 1
          ? "Project folder resolved on the MacBook."
          : "Multiple matching folders found. Pick the intended repository."
      );
    });
  }

  async function handleAddRepo() {
    if (!canAdd) {
      return;
    }
    await run("add", async () => {
      await onAddRepo({
        folderName,
        label: label.trim(),
        key: repoKey.trim(),
        candidateId: selectedCandidateId || undefined
      });
      setLabel("");
      setRepoKey("");
      setFolderName("");
      setManualFolderName("");
      setCandidates([]);
      setSelectedCandidateId("");
      setMessage("Repository added.");
    });
  }

  async function handleRemoveRepo(repo: PublicRepo) {
    const confirmed = window.confirm(`Remove "${repo.label}" from Agent Port? Local files are not deleted.`);
    if (!confirmed) {
      return;
    }
    await run("remove", async () => {
      await onRemoveRepo(repo.key);
      setMessage("Repository removed.");
    });
  }

  async function handleSetDefaultRepo(repo: PublicRepo) {
    await run("default", async () => {
      await onSetDefaultRepo(repo.key);
      setMessage(`${repo.label} is now the default repository.`);
    });
  }

  async function handleRestartServer() {
    const confirmed = window.confirm(
      "Restart Agent Port server? Active Codex PTY sessions will disconnect; metadata, events, and logs remain."
    );
    if (!confirmed) {
      return;
    }
    await run("restart", async () => {
      await onRestartServer();
      setMessage("Restart requested. Reconnect after the server comes back.");
    });
  }

  return (
    <div className="repo-settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="repo-settings-title">
      <section className="repo-settings-panel">
        <header className="repo-settings-header">
          <div>
            <h2 id="repo-settings-title">Repositories</h2>
            <p>Manage whitelisted repositories for browser-controlled local Codex sessions.</p>
          </div>
          <div className="repo-settings-actions">
            <button type="button" className="icon-text-button secondary" onClick={handleRefresh} disabled={busy !== "idle"}>
              <RefreshCw size={15} className={busy === "refresh" ? "spin" : ""} /> Refresh
            </button>
            <button type="button" className="icon-text-button secondary" onClick={handleRestartServer} disabled={busy !== "idle"}>
              <RotateCw size={15} /> Restart server
            </button>
            <button type="button" className="icon-button" onClick={onClose} title="Close repository settings">
              <X size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}
        {message ? <div className="success-banner">{message}</div> : null}
        {repoDiscovery && !repoDiscovery.configured ? (
          <div className="warning-banner">
            Repo discovery has no search roots. Configure <code>repoDiscovery.searchRoots</code> or <code>RCD_REPO_SEARCH_ROOTS</code>.
          </div>
        ) : null}

        <section className="repo-settings-section">
          <div className="repo-settings-section-heading">
            <h3>Current repositories</h3>
            <span>{repos.length} configured</span>
          </div>
          <div className="repo-list">
            {repos.map((repo) => {
              const isDefault = repo.key === defaultRepo;
              return (
                <div className="repo-row" key={repo.key}>
                  <div className="repo-row-main">
                    <strong>{repo.label}</strong>
                    <span>{repo.key}</span>
                  </div>
                  <div className="repo-row-actions">
                    {isDefault ? (
                      <span className="default-repo-badge">
                        <Star size={13} /> Default
                      </span>
                    ) : (
                      <button type="button" className="compact-button" onClick={() => handleSetDefaultRepo(repo)} disabled={busy !== "idle"}>
                        Set default
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => handleRemoveRepo(repo)}
                      disabled={busy !== "idle" || isDefault}
                      title={isDefault ? "Set another default before removing" : "Remove repository"}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="repo-settings-section">
          <div className="repo-settings-section-heading">
            <h3>Add repository</h3>
            <span>Browser sends folder name only</span>
          </div>
          <div className="repo-add-form">
            <label>
              <span>Label</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Agent Port" />
            </label>
            <label>
              <span>Repo key</span>
              <input
                value={repoKey}
                onChange={(event) => setRepoKey(slugifyRepoKey(event.target.value))}
                placeholder="agent_port"
              />
            </label>
            <div className="repo-folder-picker-row">
              <button type="button" className="icon-text-button secondary" onClick={handleSelectFolder} disabled={busy !== "idle" || !directoryPickerSupported}>
                <FolderPlus size={15} /> Select project folder
              </button>
              <span>{folderName || "No folder selected"}</span>
            </div>
            {!directoryPickerSupported ? (
              <div className="repo-folder-name-row">
                <label>
                  <span>Folder name</span>
                  <input
                    value={manualFolderName}
                    onChange={(event) => setManualFolderName(event.target.value)}
                    placeholder="noah"
                  />
                </label>
                <button type="button" className="icon-text-button secondary" onClick={handleResolveManualFolder} disabled={busy !== "idle"}>
                  Resolve folder
                </button>
              </div>
            ) : null}
            {busy === "resolve" ? <div className="repo-resolve-state">Resolving folder on the MacBook...</div> : null}
            {candidates.length ? (
              <div className="repo-candidate-list">
                {candidates.map((candidate) => (
                  <label className="repo-candidate-row" key={candidate.id}>
                    <input
                      type="radio"
                      name="repo-candidate"
                      checked={selectedCandidateId === candidate.id}
                      onChange={() => setSelectedCandidateId(candidate.id)}
                    />
                    <span>
                      <strong>{candidate.label}</strong>
                      <small>{candidate.locationHint}</small>
                    </span>
                    {candidate.gitRepository ? (
                      <em>
                        <CheckCircle2 size={13} /> Git repo
                      </em>
                    ) : (
                      <em className="warning">
                        <AlertTriangle size={13} /> No .git marker
                      </em>
                    )}
                  </label>
                ))}
              </div>
            ) : null}
            <button type="button" className="icon-text-button primary" onClick={handleAddRepo} disabled={!canAdd}>
              <FolderPlus size={15} /> Add repository
            </button>
          </div>
        </section>
      </section>
    </div>
  );
}

function slugifyRepoKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function titleize(value: string): string {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase()) || value;
}
