/**
 * Reading Outlook through Microsoft Graph, signed in as the user.
 *
 * Off unless switched on in Settings with an app registration's client id, because
 * it needs IT: a Microsoft Entra app registration (a single-page app whose redirect
 * address is this app's /auth.html) and consent for Mail.Read and Calendars.Read.
 * It only reads. It works in the served version (http://localhost), not in the
 * single file opened from disk, because sign-in needs a web address to come back to.
 *
 * Tests swap in a fake by setting `window.__LEDGER_FAKE_GRAPH__`.
 */
import type { GraphEvent, GraphMessage } from './suggest';

export const SCOPES = ['User.Read', 'Mail.Read', 'Calendars.Read'];
const BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphClient {
  me(): Promise<{ displayName?: string; mail?: string; userPrincipalName?: string }>;
  sent(sinceIso: string): Promise<GraphMessage[]>;
  conversation(conversationId: string): Promise<GraphMessage[]>;
  flagged(): Promise<GraphMessage[]>;
  events(startIso: string, endIso: string): Promise<GraphEvent[]>;
  signOut(): Promise<void>;
}

export function canUseOutlook(): { ok: boolean; reason?: string } {
  if (typeof location === 'undefined') return { ok: false, reason: 'No window.' };
  if ((window as unknown as { __LEDGER_FAKE_GRAPH__?: unknown }).__LEDGER_FAKE_GRAPH__) return { ok: true };
  if (!location.protocol.startsWith('http')) return { ok: false, reason: 'Outlook needs the served version of Ledger (start.cmd, http://localhost:47810). Sign-in cannot return to a file opened from disk.' };
  return { ok: true };
}

type Pca = Awaited<ReturnType<typeof import('@azure/msal-browser')['PublicClientApplication']['createPublicClientApplication']>>;

class MsalGraph implements GraphClient {
  constructor(private readonly pca: Pca) {}

  private async token(): Promise<string> {
    const account = this.pca.getAllAccounts()[0];
    if (account) {
      try {
        return (await this.pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
      } catch {
        /* fall through to a popup */
      }
    }
    const r = account ? await this.pca.acquireTokenPopup({ scopes: SCOPES, account }) : await this.pca.loginPopup({ scopes: SCOPES });
    return r.accessToken;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
      // Times in the user's own zone, bodies as text rather than HTML.
      headers: { Authorization: `Bearer ${await this.token()}`, Prefer: `outlook.timezone="${Intl.DateTimeFormat().resolvedOptions().timeZone}", outlook.body-content-type="text"` },
    });
    if (!res.ok) throw new Error(`Outlook answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  private async list<T>(path: string, max = 200): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next && out.length < max) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.get(next);
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out.slice(0, max);
  }

  me() {
    return this.get<{ displayName?: string; mail?: string; userPrincipalName?: string }>('/me?$select=displayName,mail,userPrincipalName');
  }

  sent(sinceIso: string) {
    const f = encodeURIComponent(`sentDateTime ge ${sinceIso}`);
    return this.list<GraphMessage>(`/me/mailFolders/sentitems/messages?$filter=${f}&$orderby=sentDateTime desc&$top=50&$select=id,conversationId,subject,sentDateTime,toRecipients,ccRecipients,body,webLink`, 150);
  }

  conversation(conversationId: string) {
    const f = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`);
    return this.list<GraphMessage>(`/me/messages?$filter=${f}&$select=id,from,sentDateTime,receivedDateTime&$top=50`, 100);
  }

  flagged() {
    const f = encodeURIComponent("flag/flagStatus eq 'flagged'");
    return this.list<GraphMessage>(`/me/messages?$filter=${f}&$select=id,subject,from,receivedDateTime,body,flag,webLink&$top=50`, 100);
  }

  events(startIso: string, endIso: string) {
    return this.list<GraphEvent>(`/me/calendarView?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$select=id,subject,start,end,attendees,organizer,isCancelled&$top=50`, 100);
  }

  async signOut() {
    const account = this.pca.getAllAccounts()[0];
    if (account) await this.pca.logoutPopup({ account, postLogoutRedirectUri: `${location.origin}/auth.html` }).catch(() => undefined);
  }
}

let client: Promise<GraphClient> | null = null;
let clientKey = '';

export function graphClient(clientId: string, tenantId: string): Promise<GraphClient> {
  const fake = (window as unknown as { __LEDGER_FAKE_GRAPH__?: GraphClient }).__LEDGER_FAKE_GRAPH__;
  if (fake) return Promise.resolve(fake);
  const key = `${clientId}|${tenantId}`;
  if (client && key === clientKey) return client;
  clientKey = key;
  client = (async () => {
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const pca = await PublicClientApplication.createPublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId || 'organizations'}`, redirectUri: `${location.origin}/auth.html` },
      cache: { cacheLocation: 'localStorage' },
    });
    return new MsalGraph(pca);
  })();
  client.catch(() => {
    client = null;
  });
  return client;
}
