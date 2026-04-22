/**
 * ObsidianCode - OMC MCP importer
 *
 * Surfaces MCP server candidates defined in `~/.claude/settings.json`
 * that are not yet registered in the plugin's own MCP manager. The
 * caller decides whether to actually import any of them.
 *
 * Desktop-only — returns an empty list on mobile.
 */

import * as fs from 'fs';
import { Platform } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

export interface MCPCandidateServer {
  name: string;
  config: Record<string, unknown>;
}

function hasTransportField(cfg: Record<string, unknown>): boolean {
  if (typeof cfg.command === 'string' && cfg.command.trim()) return true;
  if (typeof cfg.url === 'string' && cfg.url.trim()) return true;
  if (cfg.transport === 'http') return true;
  return false;
}

export class OMCMCPImporter {
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? path.join(os.homedir(), '.claude');
  }

  getCandidates(alreadyRegistered: Set<string>): MCPCandidateServer[] {
    if (!Platform.isDesktop) return [];

    try {
      const settingsPath = path.join(this.claudeDir, 'settings.json');
      if (!fs.existsSync(settingsPath)) return [];

      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = settings.mcpServers ?? {};

      const result: MCPCandidateServer[] = [];
      for (const [name, cfg] of Object.entries(servers)) {
        if (alreadyRegistered.has(name)) continue;
        if (!cfg || typeof cfg !== 'object') continue;
        const config = cfg as Record<string, unknown>;
        if (!hasTransportField(config)) continue;
        result.push({ name, config });
      }
      return result;
    } catch {
      return [];
    }
  }
}
