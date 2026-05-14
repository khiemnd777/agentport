type RestartSuccess = { ok: true; scheduled: true };
type RestartFailure = { ok: false; error: string };

export type RestartResult = RestartSuccess | RestartFailure;

export class ServerControlService {
  constructor(
    private readonly restartProcess: () => void,
    private readonly isRestartSupported: () => boolean = () => true
  ) {}

  requestRestart(): RestartResult {
    if (!this.isRestartSupported()) {
      return {
        ok: false,
        error: "Server restart is only available in managed runtime. Run bun run build && bun run start."
      };
    }

    setTimeout(() => {
      this.restartProcess();
    }, 250);
    return { ok: true, scheduled: true };
  }
}
