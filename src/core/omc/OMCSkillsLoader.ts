/**
 * ObsidianCode - OMC skills loader
 *
 * Discovers skill definitions under `<pluginRoot>/skills/<name>/SKILL.md`
 * inside an oh-my-claudecode install and exposes them as candidates for
 * registration alongside the plugin's own slash commands. When a skill's
 * name collides with an existing slash command it is namespaced under
 * `omc:<name>` so user commands always win.
 *
 * Desktop-only — returns an empty list on mobile.
 */

import * as fs from 'fs';
import { Platform } from 'obsidian';
import * as path from 'path';

export interface OMCSkill {
  name: string;
  commandName: string;
  description: string;
  content: string;
}

export function parseSkillMeta(
  dirName: string,
  content: string
): { name: string; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { name: dirName, description: '' };

  const fm = fmMatch[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? dirName;
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description };
}

export class OMCSkillsLoader {
  private pluginRoot: string;
  private skills: OMCSkill[] = [];

  constructor(pluginRoot: string) {
    this.pluginRoot = pluginRoot;
  }

  resolveCommandName(name: string, existingNames: Set<string>): string {
    return existingNames.has(name) ? `omc:${name}` : name;
  }

  load(existingCommandNames: Set<string> = new Set()): OMCSkill[] {
    if (!Platform.isDesktop) return [];

    const skillsDir = path.join(this.pluginRoot, 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    this.skills = [];
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        const content = fs.readFileSync(skillMd, 'utf-8');
        const { name, description } = parseSkillMeta(entry.name, content);
        const commandName = this.resolveCommandName(name, existingCommandNames);
        this.skills.push({ name, commandName, description, content });
      }
    } catch {
      // Missing or unreadable install is not an error — the UI simply
      // shows no OMC skills. Surfacing a throw would break the plugin.
    }
    return this.skills;
  }

  unload(): void {
    this.skills = [];
  }

  getSkillContent(commandName: string): string | null {
    return this.skills.find((s) => s.commandName === commandName)?.content ?? null;
  }

  getAll(): OMCSkill[] {
    return [...this.skills];
  }
}
