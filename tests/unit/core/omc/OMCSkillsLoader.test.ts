/**
 * Tests for OMCSkillsLoader.
 *
 * Covers the pure frontmatter parser and the name-collision rule.
 * Filesystem discovery is exercised at runtime in Obsidian.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import { OMCSkillsLoader, parseSkillMeta } from '@/core/omc/OMCSkillsLoader';

describe('parseSkillMeta', () => {
  it('extracts name and description from SKILL.md frontmatter', () => {
    const content = `---\nname: my-skill\ndescription: Does something useful\n---\n\n# Content`;
    const result = parseSkillMeta('my-skill', content);
    expect(result.name).toBe('my-skill');
    expect(result.description).toBe('Does something useful');
  });

  it('falls back to directory name when frontmatter missing', () => {
    const result = parseSkillMeta('fallback-name', '# No frontmatter');
    expect(result.name).toBe('fallback-name');
    expect(result.description).toBe('');
  });

  it('falls back to directory name when frontmatter has no name field', () => {
    const content = `---\ndescription: Only a description\n---\n`;
    const result = parseSkillMeta('dir-name', content);
    expect(result.name).toBe('dir-name');
    expect(result.description).toBe('Only a description');
  });
});

describe('OMCSkillsLoader collision handling', () => {
  it('prefixes with omc: when name collides', () => {
    const loader = new OMCSkillsLoader('/plugin-root');
    const name = loader.resolveCommandName('plan', new Set(['plan']));
    expect(name).toBe('omc:plan');
  });

  it('keeps original name when no collision', () => {
    const loader = new OMCSkillsLoader('/plugin-root');
    const name = loader.resolveCommandName('executor', new Set());
    expect(name).toBe('executor');
  });
});

describe('OMCSkillsLoader load/getAll/unload', () => {
  it('returns an empty list when the skills dir does not exist', () => {
    const loader = new OMCSkillsLoader('/nonexistent/plugin-root');
    expect(loader.load()).toEqual([]);
    expect(loader.getAll()).toEqual([]);
  });

  it('clears the in-memory skill cache on unload', () => {
    const loader = new OMCSkillsLoader('/nonexistent/plugin-root');
    loader.load();
    loader.unload();
    expect(loader.getAll()).toEqual([]);
  });
});
