/**
 * ObsidianCode - OMC CLI bridge
 *
 * Spawns a long-running OMC CLI subprocess and streams its stdout /
 * stderr back via callbacks. Exactly one process runs at a time; a
 * second `run()` while one is active returns false.
 *
 * Cancellation sends SIGTERM first and then SIGKILL after a 2s grace
 * period so a misbehaving child can't hold the UI indefinitely.
 *
 * Desktop-only — `run()` reports an error and returns false on mobile.
 */

import { type ChildProcess, spawn } from 'child_process';
import { Platform } from 'obsidian';

export class CLIBridge {
  private active: ChildProcess | null = null;

  get isRunning(): boolean {
    return this.active !== null;
  }

  run(
    command: string,
    vaultPath: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: string) => void
  ): boolean {
    if (!Platform.isDesktop) {
      onError('CLI bridge requires desktop');
      return false;
    }
    if (this.active) {
      onError('A bridge process is already running');
      return false;
    }

    const child = spawn(command, { shell: true, cwd: vaultPath });
    this.active = child;

    child.stdout?.on('data', (d: Buffer) => onChunk(d.toString()));
    child.stderr?.on('data', (d: Buffer) => onChunk(d.toString()));
    child.on('close', () => {
      if (this.active === child) this.active = null;
      onDone();
    });
    child.on('error', (e) => {
      if (this.active === child) this.active = null;
      onError(e.message);
    });
    return true;
  }

  cancel(): void {
    if (!this.active) return;
    const proc = this.active;
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 2000);
    this.active = null;
  }
}
