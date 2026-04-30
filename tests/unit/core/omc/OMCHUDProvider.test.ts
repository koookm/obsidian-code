/**
 * Tests for OMCHUDProvider.
 *
 * Covers reading the real OMC state files (`hud-stdin-cache.json`,
 * `subagent-tracking.json`) that OMC emits at `<vault>/.omc/state/`.
 * Polling behavior is exercised indirectly in view-level tests — here
 * we keep the unit surface lean and synchronous.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { OMCHUDProvider } from '@/core/omc/OMCHUDProvider';

const TEST_INSTALL = { pluginRoot: '/nonexistent', cliPath: null, version: '4.0.0' };

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ochud-'));
  fs.mkdirSync(path.join(dir, '.omc', 'state'), { recursive: true });
  return dir;
}

function writeHudCache(vault: string, payload: unknown): void {
  fs.writeFileSync(
    path.join(vault, '.omc', 'state', 'hud-stdin-cache.json'),
    JSON.stringify(payload)
  );
}

function writeSubagents(vault: string, payload: unknown): void {
  fs.writeFileSync(
    path.join(vault, '.omc', 'state', 'subagent-tracking.json'),
    JSON.stringify(payload)
  );
}

describe('OMCHUDProvider', () => {
  it('returns version with all-null fields when state dir does not exist', async () => {
    const provider = new OMCHUDProvider(TEST_INSTALL, '/nonexistent-vault');
    const data = await provider.readStateFiles();
    expect(data).toEqual({
      version: '4.0.0',
      model: null,
      contextPercent: null,
      effort: null,
      costUsd: null,
      activeAgents: null,
      fiveHourPercent: null,
      sevenDayPercent: null,
      skillsCount: null,
    });
  });

  it('parses model / context percent / effort / cost from hud-stdin-cache.json', async () => {
    const vault = makeVault();
    writeHudCache(vault, {
      model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7' },
      context_window: { used_percentage: 42 },
      effort: { level: 'xhigh' },
      cost: { total_cost_usd: 2.125 },
    });

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    const data = await provider.readStateFiles();

    expect(data.version).toBe('4.0.0');
    expect(data.model).toBe('Opus 4.7');
    expect(data.contextPercent).toBe(42);
    expect(data.effort).toBe('xhigh');
    expect(data.costUsd).toBeCloseTo(2.125);
  });

  it('counts active subagents from subagent-tracking.json', async () => {
    const vault = makeVault();
    writeSubagents(vault, {
      agents: [
        { id: 'a', status: 'running' },
        { id: 'b', status: 'running' },
      ],
      total_spawned: 3,
      total_completed: 1,
      total_failed: 0,
    });

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    const data = await provider.readStateFiles();

    expect(data.activeAgents).toBe(2);
  });

  it('keeps fields null when hud-stdin-cache.json is malformed', async () => {
    const vault = makeVault();
    fs.writeFileSync(
      path.join(vault, '.omc', 'state', 'hud-stdin-cache.json'),
      '{not valid json'
    );

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    const data = await provider.readStateFiles();

    expect(data).toEqual({
      version: '4.0.0',
      model: null,
      contextPercent: null,
      effort: null,
      costUsd: null,
      activeAgents: null,
      fiveHourPercent: null,
      sevenDayPercent: null,
      skillsCount: null,
    });
  });

  it('ignores partial hud cache fields without throwing', async () => {
    const vault = makeVault();
    writeHudCache(vault, { model: { display_name: 'Sonnet 4.6' } });

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    const data = await provider.readStateFiles();

    expect(data.model).toBe('Sonnet 4.6');
    expect(data.contextPercent).toBeNull();
    expect(data.effort).toBeNull();
    expect(data.costUsd).toBeNull();
  });

  it('push() merges SDK data as baseline and notifies listeners', async () => {
    const vault = makeVault();
    const provider = new OMCHUDProvider(TEST_INSTALL, vault);

    const received: unknown[] = [];
    provider.on((d) => received.push(d));

    provider.push({ model: 'claude-sonnet-4-6', contextPercent: 35 });

    await new Promise((r) => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    const d = received[0] as Record<string, unknown>;
    expect(d.model).toBe('claude-sonnet-4-6');
    expect(d.contextPercent).toBe(35);
    expect(d.version).toBe('4.0.0');
  });

  it('parses rate_limits (5h and 7d usage) from hud-stdin-cache.json', async () => {
    const vault = makeVault();
    writeHudCache(vault, {
      rate_limits: {
        five_hour: { used_percentage: 7.5 },
        seven_day: { used_percentage: 36.2 },
      },
    });

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    const data = await provider.readStateFiles();

    expect(data.fiveHourPercent).toBe(8);
    expect(data.sevenDayPercent).toBe(36);
  });

  it('setSkillsCount propagates to readStateFiles result', async () => {
    const provider = new OMCHUDProvider(TEST_INSTALL, '/nonexistent-vault');
    provider.setSkillsCount(21);
    const data = await provider.readStateFiles();
    expect(data.skillsCount).toBe(21);
  });

  it('state-file model wins over push() SDK model when both present', async () => {
    const vault = makeVault();
    writeHudCache(vault, {
      model: { display_name: 'Opus 4.7' },
      context_window: { used_percentage: 80 },
    });

    const provider = new OMCHUDProvider(TEST_INSTALL, vault);
    provider.push({ model: 'sdk-model', contextPercent: 10 });

    const data = await provider.readStateFiles();
    expect(data.model).toBe('Opus 4.7');
    expect(data.contextPercent).toBe(80);
  });
});
