/**
 * ObsidianCode - OMC installation detector
 *
 * Discovers an oh-my-claudecode plugin install under ~/.claude/plugins/
 * so the rest of the app can surface OMC skills, MCP configs, and the
 * CLI. Desktop-only; returns null on mobile where the filesystem isn't
 * addressable.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import { Platform } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

export interface OMCInstall {
  version: string;
  pluginRoot: string;
  cliPath: string | null;
  configPath: string;
}

export class OMCDetector {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), '.claude');
  }

  static detect(): Promise<OMCInstall | null> {
    return new OMCDetector().detect();
  }

  async detect(): Promise<OMCInstall | null> {
    if (!Platform.isDesktop) return null;

    try {
      const pluginBase = path.join(
        this.claudeDir, 'plugins', 'cache', 'omc', 'oh-my-claudecode'
      );
      if (!fs.existsSync(pluginBase)) return null;

      const versions = fs.readdirSync(pluginBase)
        .filter((v) => /^\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (!versions.length) return null;

      const version = versions[versions.length - 1];
      const pluginRoot = path.join(pluginBase, version);
      const configPath = path.join(this.claudeDir, '.omc-config.json');
      const cliPath = await this.findCli();

      return { version, pluginRoot, cliPath, configPath };
    } catch {
      return null;
    }
  }

  private findCli(): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const child = spawn('omc', ['--version'], { shell: true, timeout: 3000 });
        child.on('close', (code) => resolve(code === 0 ? 'omc' : null));
        child.on('error', () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }
}
