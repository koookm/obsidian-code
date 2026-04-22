/**
 * Tests for OMCHUDProvider.
 *
 * Covers the empty-state path and the pure percent helper.
 * Polling behavior is verified indirectly via listener subscription
 * in the component tests; here we keep tests lean and synchronous.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCHUDProvider } from '@/core/omc/OMCHUDProvider';

describe('OMCHUDProvider', () => {
  it('returns empty HUDData when state dir does not exist', async () => {
    const provider = new OMCHUDProvider(
      { pluginRoot: '/nonexistent', cliPath: null },
      '/nonexistent-vault'
    );
    const data = await provider.readStateFiles();
    expect(data).toEqual({ skill: null, ralph: null, todos: null });
  });

  it('computes context percentage from usage', () => {
    expect(OMCHUDProvider.contextPercent(6700, 100000)).toBe(7);
  });

  it('guards against a zero context window', () => {
    expect(OMCHUDProvider.contextPercent(1000, 0)).toBe(0);
  });
});
