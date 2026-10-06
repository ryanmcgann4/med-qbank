/**
 * Q-Bank connector for Claude: a remote MCP server on Cloudflare Workers.
 *
 * Claude (web and mobile) connects with OAuth. The sign-in page asks for your
 * passphrase (the PASSPHRASE secret), so only you can connect. The tools read
 * and write the same private GitHub repo your devices sync through.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import OAuthProvider, { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { Env } from './bank';
import { buildServer } from './tools';

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const SCOPE = 'qbank';

// One stateless MCP exchange per request: no sessions to keep, any Worker instance can answer.
const mcpHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildServer(env);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(details: ConsentDescription, handle: string, query: string, error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Q-Bank</title>
<style>
  :root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#4f46e5}
  @media (prefers-color-scheme:dark){:root{--bg:#020617;--card:#0f172a;--ink:#f1f5f9;--muted:#94a3b8;--line:#1e293b}}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
  main{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;max-width:420px;width:100%}
  h1{font-size:20px;margin:0 0 8px} p{margin:8px 0;color:var(--muted)} b{color:var(--ink)}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font-size:16px;margin:12px 0}
  .row{display:flex;gap:8px;justify-content:flex-end} button{padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit;font-size:15px;cursor:pointer}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff} .err{color:#e11d48}
</style></head><body><main>
<h1>Connect ${escape(details.clientName)} to your Q-Bank?</h1>
<p>It will be able to read your questions and progress, add questions, and record answers. Access goes to <b>${escape(details.redirectHost)}</b>.</p>
${details.redirectIsLoopback ? '<p><b>This sends access to an app on this computer.</b> Continue only if you just started connecting from it.</p>' : ''}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <input type="hidden" name="query" value="${escape(query)}">
  <label for="pw">Passphrase</label>
  <input id="pw" name="passphrase" type="password" autocomplete="current-password" autofocus>
  ${error ? `<p class="err">${escape(error)}</p>` : ''}
  <div class="row"><button name="decision" value="deny">Cancel</button><button class="primary" name="decision" value="approve">Connect</button></div>
</form></main></body></html>`;
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

const html = (body: string, headers: Headers, status = 200) => {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { status, headers });
};

const authorize = {
  async fetch(req: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('Q-Bank connector is running. Add it in Claude: Settings → Connectors → Add custom connector, URL ending in /mcp.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (url.pathname !== '/authorize') return new Response('Not found', { status: 404 });
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (req.method === 'GET') {
        // `retry` is ours (shown after a wrong passphrase); keep it out of the OAuth parameters.
        const retry = url.searchParams.has('retry');
        url.searchParams.delete('retry');
        const request = await oauth.parseAuthRequest(new Request(url, req));
        const details = await oauth.describeConsent(request);
        const consent = await oauth.beginConsent(request);
        return html(page(details, consent.handle, url.search, retry ? 'Wrong passphrase. Try again.' : undefined), consent.headers);
      }
      const form = await req.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      if (!env.PASSPHRASE || !(await sameSecret(String(form.get('passphrase') ?? ''), env.PASSPHRASE))) {
        // Start the same authorization again with an error message.
        const query = String(form.get('query') ?? '');
        if (!query.startsWith('?')) return new Response('Wrong passphrase. Start connecting again from Claude.', { status: 401 });
        return Response.redirect(`${url.origin}/authorize${query}&retry=1`, 303);
      }
      const approved = await oauth.approveConsent(req, handle, { scope: [SCOPE, 'offline_access'] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: 'me',
        metadata: {},
        scope: approved.request.scope,
        props: {},
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        const message = error instanceof AuthorizationError ? error.description : 'This app could not be verified.';
        return new Response(message, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      throw error;
    }
  },
};

// The resource URL must be absolute, so the provider is built from the first request's origin.
const providers = new Map<string, OAuthProvider<AuthEnv>>();
function providerFor(origin: string) {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<AuthEnv>({
      apiRoute: '/mcp',
      apiHandler: mcpHandler as never,
      defaultHandler: authorize as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [SCOPE, 'offline_access'],
      requiredScopes: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      // Stay connected while you keep using it; a grant idle for 90 days expires.
      refreshTokenIdleTTL: 90 * 24 * 3600,
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request: Request, env: AuthEnv, ctx: ExecutionContext) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
};
