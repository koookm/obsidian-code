/**
 * Tests for OMCMCPImporter.
 *
 * Covers the no-settings path and the candidate filter rules.
 * Actual filesystem integration is exercised at runtime in Obsidian.
 */

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { OMCMCPImporter } from '@/core/omc/OMCMCPImporter';

describe('OMCMCPImporter.getCandidates', () => {
  it('returns an empty list when settings.json is absent', () => {
    const importer = new OMCMCPImporter('/nonexistent/path/should/not/exist');
    expect(importer.getCandidates(new Set())).toEqual([]);
  });

  it('filters already-registered servers and servers without a transport field', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-mcp-test-'));
    try {
      const settings = {
        mcpServers: {
          existing: { command: 'node', args: ['a.js'] },
          stdioNew: { command: 'node', args: ['b.js'] },
          httpNew: { url: 'http://localhost:1234', transport: 'http' },
          noTransport: { args: ['c.js'] },
        },
      };
      fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify(settings), 'utf-8');

      const importer = new OMCMCPImporter(tmp);
      const candidates = importer.getCandidates(new Set(['existing']));

      const names = candidates.map((c) => c.name).sort();
      expect(names).toEqual(['httpNew', 'stdioNew']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns an empty list when settings.json is malformed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-mcp-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'settings.json'), '{ not valid json', 'utf-8');
      const importer = new OMCMCPImporter(tmp);
      expect(importer.getCandidates(new Set())).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
