/**
 * The account, when this build has one: the hosted app always does; the laptop build
 * only under the `?cloud=fake` test hook. The Supabase client is loaded on first use,
 * so a build without an account never fetches it.
 */
import type { CloudApi } from './api';
import { cloudConfig, fakeCloudRequested } from './config';

let api: Promise<CloudApi> | null = null;

export function cloudWanted(): boolean {
  return !!cloudConfig() || fakeCloudRequested();
}

export function getCloudApi(): Promise<CloudApi> {
  api ??= (async () => {
    const cfg = cloudConfig();
    if (cfg && !fakeCloudRequested()) return (await import('./supabaseApi')).supabaseApi(cfg);
    const { FakeServer, fakeApi } = await import('./fakeApi');
    return fakeApi(new FakeServer(localStorage), localStorage);
  })();
  return api;
}
