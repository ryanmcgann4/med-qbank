import crypto from 'node:crypto';
// Plays Claude against a running connector: discovery, sign-in, tokens, then every tool.
// Usage: BASE=http://localhost:8788 PASSPHRASE=... node scripts/smoke-test.mjs [--write]
// Without --write it only reads. With --write it imports the sample day, answers, and flags a
// question, so point it at `wrangler dev` with BRANCH set to a throwaway branch, not your real bank.
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:8788';
const PASSPHRASE = process.env.PASSPHRASE ?? '';
const WRITE = process.argv.includes('--write');
const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const cookies = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); cookies.set(k, v); } };
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

// 1. Discovery like Claude does: 401 → protected resource metadata → AS metadata
let r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok('unauthenticated /mcp is 401 with a challenge', r.status === 401 && /resource_metadata/.test(r.headers.get('www-authenticate') ?? ''));
r = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`);
const prm = await r.json();
ok('protected resource metadata', prm.resource === `${BASE}/mcp`, JSON.stringify(prm.scopes_supported));
const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
ok('authorization server metadata has DCR + PKCE S256', !!as.registration_endpoint && as.code_challenge_methods_supported?.includes('S256'));

// 2. Dynamic client registration
r = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
const client = await r.json();
ok('client registered', !!client.client_id);

// 3. Authorize with PKCE
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'st123', scope: 'qbank offline_access', resource: `${BASE}/mcp` });
const getPage = async (url) => { const res = await fetch(url, { headers: { Cookie: cookieHeader() }, redirect: 'manual' }); keep(res); return { res, html: await res.text() }; };
let { res, html } = await getPage(`${BASE}/authorize?${q}`);
ok('consent page shows', res.status === 200 && html.includes('Connect Claude to your Q-Bank?') && html.includes('claude.ai'));
const field = (h, n) => h.match(new RegExp(`name="${n}" value="([^"]*)"`))?.[1]?.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c));
const post = async (h, passphrase) => {
  const body = new URLSearchParams({ handle: field(h, 'handle'), query: field(h, 'query'), passphrase, decision: 'approve' });
  const res = await fetch(`${BASE}/authorize`, { method: 'POST', body, headers: { Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }, redirect: 'manual' });
  keep(res);
  return res;
};
r = await post(html, 'wrong');
ok('wrong passphrase sends you back', r.status === 303 && /retry=1/.test(r.headers.get('location') ?? ''));
({ res, html } = await getPage(r.headers.get('location')));
ok('retry page shows the error', html.includes('Wrong passphrase'));
r = await post(html, PASSPHRASE);
const loc = new URL(r.headers.get('location') ?? 'http://x');
ok('right passphrase redirects to Claude with a code', r.status === 302 && loc.origin === 'https://claude.ai' && !!loc.searchParams.get('code') && loc.searchParams.get('state') === 'st123');

// 4. Token exchange + refresh
r = await fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: client.client_id, code_verifier: verifier, resource: `${BASE}/mcp` }) });
const tok = await r.json();
ok('access + refresh token', !!tok.access_token && !!tok.refresh_token, `scope=${tok.scope}`);
r = await fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id, resource: `${BASE}/mcp` }) });
const tok2 = await r.json();
ok('refresh works', !!tok2.access_token);

// 5. MCP over Streamable HTTP
let id = 0;
const rpc = async (method, params) => {
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tok2.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const t = await res.text();
  try { return JSON.parse(t); } catch { return { raw: t, status: res.status }; }
};
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
ok('initialize', init.result?.serverInfo?.name === 'qbank', `protocol ${init.result?.protocolVersion}; has instructions: ${!!init.result?.instructions}`);
const tools = await rpc('tools/list', {});
ok('tools/list', tools.result?.tools?.length === 9, tools.result?.tools?.map((t) => t.name).join(', '));
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const txt = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? r); try { return JSON.parse(txt); } catch { return txt; } };

const ov = await call('qbank_overview');
ok('overview reads the real bank', typeof ov.questions === 'number', `questions=${ov.questions} due=${ov.due_today} acc=${ov.overall_accuracy}`);
if (WRITE) {
  const sample = readFileSync(new URL('../../public/sample/B2_W6_D1_2026-10-05.json', import.meta.url), 'utf8');
  const imp = await call('qbank_import', { file_json: sample, file_name: 'sample.json' });
  ok('import', imp.saved === true || imp.already_in_bank === 10, JSON.stringify({ imported: imp.imported, already: imp.already_in_bank, saved: imp.saved }));
}
const quiz = await call('qbank_quiz_start', { count: 2, focus: 'smart' });
const first = quiz.questions?.[0];
ok('quiz hides answers', !!first && !('correct_option' in first) && first.options.every((o) => !('explanation' in o)), first?.qid);
if (WRITE) {
const ans = await call('qbank_answer', { qid: first.qid, choice: 'A', confidence: 'unsure', seconds: 42 });
ok('answer recorded with explanations', ans.recorded === true && ans.options?.length === 5 && !!ans.explanation, `correct=${ans.correct} key=${ans.correct_answer}`);
const upd = await call('qbank_update_question', { qid: first.qid, flagged: true, note: 'from test' });
ok('flag + note', /Updated/.test(upd));
const got = await call('qbank_get_questions', { qids: [first.qid] });
ok('flag visible', got[0]?.status?.includes('flagged') && got[0]?.note === 'from test');
}
const srch = await call('qbank_search', { query: 'acetazolamide', limit: 3 });
ok('search', srch.total >= 1);
const ex = await call('qbank_existing_questions', { course: 'Block 2', week: 6 });
ok('existing list', typeof ex === 'string' && ex.includes('B2-W6-D1'));
const lec = await call('qbank_list_lectures', {});
ok('list lectures', Array.isArray(lec) && lec.length >= 2);
console.log('first quizzed qid:', first.qid);
