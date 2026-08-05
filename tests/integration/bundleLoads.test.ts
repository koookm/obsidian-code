import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The unit suite exercises source modules directly, so it never evaluates the
 * bundle esbuild produces. A bundling regression therefore ships green: the
 * Agent SDK is ESM and calls `createRequire(import.meta.url)`, which compiles
 * to `undefined` in a CJS bundle and throws the moment Obsidian loads the
 * plugin. This test loads the built main.js the way Obsidian does.
 */
describe('built bundle', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const bundlePath = path.join(repoRoot, 'main.js');

  // Obsidian supplies these at runtime; stub them as permissive callables so
  // module-level code can evaluate without pulling in the real packages.
  const harness = `
    const Module = require('module');
    const orig = Module._load;
    function makeStub() {
      const fn = function () { return makeStub(); };
      return new Proxy(fn, {
        get: (t, p) => {
          if (p === '__esModule') return false;
          if (p === Symbol.toPrimitive || p === Symbol.iterator) return undefined;
          if (p === 'prototype') return t.prototype;
          return makeStub();
        },
        apply: () => makeStub(),
        construct: () => ({}),
      });
    }
    Module._load = function (request) {
      if (
        request === 'obsidian' ||
        request === 'electron' ||
        request.startsWith('@codemirror/') ||
        request.startsWith('@lezer/')
      ) {
        return makeStub();
      }
      return orig.apply(this, arguments);
    };
    const mod = require(${JSON.stringify(bundlePath)});
    const plugin = mod.default || mod;
    if (typeof plugin !== 'function') {
      throw new Error('bundle did not export a plugin class');
    }
  `;

  it('is present — run `npm run build` first', () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
  });

  it('evaluates without throwing and exports a plugin class', () => {
    // Throws with the child's stderr attached when the bundle fails to load.
    expect(() =>
      execFileSync(process.execPath, ['-e', harness], {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 60_000,
      })
    ).not.toThrow();
  });

  it('does not leave import.meta.url undefined for createRequire', () => {
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    // esbuild's CJS shim names the placeholder `import_meta`; if it reaches
    // createRequire the plugin dies on load.
    expect(bundle).not.toMatch(/createRequire\)\(import_meta\.url\)/);
  });
});
