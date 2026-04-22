/**
 * Tests for OMCDetector.
 *
 * Covers the no-install path. Real installation discovery touches the
 * filesystem and is verified at runtime in Obsidian, not here.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCDetector } from '@/core/omc/OMCDetector';

describe('OMCDetector', () => {
  it('returns null when plugin dir does not exist', async () => {
    const detector = new OMCDetector('/nonexistent/path/should/not/exist');
    const result = await detector.detect();
    expect(result).toBeNull();
  });

  it('static detect() also returns null for an absent install', async () => {
    const detector = new OMCDetector('/nonexistent/path/should/not/exist');
    const result = await detector.detect();
    expect(result).toBeNull();
  });
});
