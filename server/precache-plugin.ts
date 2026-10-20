import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BuildStamp {
  commit: string;
  builtAt: string;
}

/**
 * Emits sw.js at build time with the list of built assets to precache, so the
 * installed app opens instantly and works with no network at all. The template
 * lives in server/sw.template.js; __PRECACHE__ and __VERSION__ are substituted.
 *
 * Also emits build.json, which is how update.ps1 reports what it replaced: the
 * stamp compiled into the bundle is not readable without parsing the bundle.
 */
export function precachePlugin(stamp: BuildStamp): Plugin {
  return {
    name: 'ledger-precache-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // The on-device model's engine and the Outlook sign-in library are megabytes
      // and only needed when switched on; they are cached the first time they load
      // instead of on every install.
      const big = (f: string) => {
        const o = bundle[f] as { code?: string; source?: string | Uint8Array };
        return (o.code?.length ?? (typeof o.source === 'string' ? o.source.length : (o.source?.length ?? 0))) > 300_000;
      };
      const assets = Object.keys(bundle)
        .filter((f) => !big(f))
        .map((f) => f);
      // Relative to the worker, so the app works at a site's root and under a path.
      const files = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...assets];
      const version = `${Date.now().toString(36)}`;
      const template = readFileSync(resolve(process.cwd(), 'server/sw.template.js'), 'utf8');
      const source = template.replace('__PRECACHE__', JSON.stringify(files)).replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      // Emitted after the precache list is taken: build.json is read by update.ps1
      // off the disk, never by the browser, so it has no business in the cache.
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ ...stamp }, null, 2) + '\n' });
    },
  };
}
