/**
 * Tests for CLIBridge.
 *
 * Covers the single-process invariant and the cancel-no-op path.
 * Real process spawning is exercised at runtime in Obsidian.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { CLIBridge } from '@/core/omc/CLIBridge';

describe('CLIBridge', () => {
  it('is not running when freshly constructed', () => {
    expect(new CLIBridge().isRunning).toBe(false);
  });

  it('cancel() is a no-op when no process is active', () => {
    const bridge = new CLIBridge();
    expect(() => bridge.cancel()).not.toThrow();
    expect(bridge.isRunning).toBe(false);
  });
});
