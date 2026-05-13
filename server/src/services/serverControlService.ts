export class ServerControlService {
  constructor(private readonly restartProcess: () => void) {}

  requestRestart(): { ok: true; scheduled: true } {
    setTimeout(() => {
      this.restartProcess();
    }, 250);
    return { ok: true, scheduled: true };
  }
}
