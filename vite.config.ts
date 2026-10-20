/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { precachePlugin } from './server/precache-plugin';
import { inlineAllPlugin } from './server/inline-plugin';

// LEDGER_STANDALONE=1 builds the single-file version that opens straight from disk.
const standalone = process.env.LEDGER_STANDALONE === '1';
// LEDGER_HOSTED=1 builds the hosted app for GitHub Pages into site/: signed in, with
// the ledger in the account (cloud.json says which Supabase project). The laptop
// build has no account and never loads the Supabase client.
const hosted = process.env.LEDGER_HOSTED === '1';
const cloud = hosted ? (JSON.parse(readFileSync('cloud.json', 'utf8')) as { url: string; key: string }) : null;
if (hosted && !(cloud?.url && cloud.key) && process.env.LEDGER_ALLOW_EMPTY_CLOUD !== '1') {
  throw new Error('cloud.json has no Supabase url and key: the hosted app would have nowhere to keep the ledger.');
}

/**
 * The hosted page's Content-Security-Policy. GitHub Pages cannot send headers, so it
 * is a meta tag: scripts only from this site (no inline script, no eval; WebAssembly
 * for the on-device model), and connections only to the account's Supabase project,
 * the model's download hosts and Microsoft's sign-in for Outlook. A script injected
 * into the page could neither load more code nor send the ledger anywhere else.
 */
function csp(): string {
  const supa = cloud?.url ? new URL(cloud.url).host : '*.supabase.co';
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://${supa} wss://${supa} https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com https://login.microsoftonline.com https://graph.microsoft.com`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src https://login.microsoftonline.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const hostedHtml = {
  name: 'ledger-hosted-html',
  transformIndexHtml(html: string) {
    return html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp()}" />\n    <meta name="referrer" content="no-referrer" />`,
    );
  },
};

// A build stamp, so "did my change actually reach the laptop?" is answerable by
// looking at the app instead of guessing. git may be absent on a build machine,
// so every part of this is allowed to fail.
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
const buildCommit = git('rev-parse --short HEAD') || 'unknown';
// Only source counts as "dirty". dist/ and standalone/ are committed build output,
// and the first half of `build:all` dirties them before the second half reads this.
const buildDirty = git('status --porcelain -- src server index.html vite.config.ts') !== '';
const buildTime = new Date().toISOString();

export default defineConfig({
  // The single-file build must emit exactly one file, so nothing is copied from public/.
  publicDir: standalone ? false : 'public',
  // Relative, so the same build works at a site's root (the laptop) and under
  // /Ledger/ (GitHub Pages).
  base: './',
  define: {
    __CLOUD__: JSON.stringify(cloud),
    __STANDALONE__: JSON.stringify(standalone),
    __BUILD_COMMIT__: JSON.stringify(buildDirty ? `${buildCommit}+` : buildCommit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  // The .msg reader (msgreader, through iconv-lite) expects Node's Buffer; the
  // browser gets the standard polyfill under the same name.
  resolve: { alias: { buffer: 'buffer/' } },
  plugins: [react(), tailwindcss(), standalone ? inlineAllPlugin() : precachePlugin({ commit: buildCommit, builtAt: buildTime }), ...(hosted ? [hostedHtml] : [])],
  // Fixed port so the installed desktop app keeps a stable origin. The storage folder
  // handle and the IndexedDB mirror are both bound to that origin.
  server: { port: 47810, strictPort: true },
  preview: { port: 47810, strictPort: true },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    outDir: standalone ? 'standalone' : hosted ? 'site' : 'dist',
    // Everything must end up inside the one HTML file.
    assetsInlineLimit: standalone ? 100_000_000 : 4096,
    cssCodeSplit: !standalone,
    rollupOptions: standalone
      ? { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' } }
      : {},
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
