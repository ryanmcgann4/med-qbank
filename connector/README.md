# Q-Bank connector for Claude

A remote MCP server (Cloudflare Workers, free tier) that lets Claude on the web
and phone read and write your Q-Bank. It uses the same private GitHub sync repo
as your devices and the app's own code for the file format, merging, scheduling,
validation, and quiz selection, so whatever Claude does shows up on your devices
at their next sync.

## Tools Claude gets

| Tool | What it does |
| --- | --- |
| `qbank_overview` | Totals, due today, accuracy, upcoming exams with today's plan, weakest lectures/tags |
| `qbank_list_lectures` | Lectures by course/week/day with counts and accuracy |
| `qbank_search` | Full-text search |
| `qbank_get_questions` | Full questions with answers and explanations |
| `qbank_existing_questions` | "qid \| stem" lines, to avoid duplicates when writing new ones |
| `qbank_import` | Add a day file (new questions only; repeats skipped, clashes reported) |
| `qbank_quiz_start` | Pick questions without answers (smart / due / missed / unseen / weak / flagged) |
| `qbank_answer` | Record your answer + confidence; returns every option's explanation |
| `qbank_update_question` | Flag, note, archive, or report a question |

## Deploy (once)

1. Create a free Cloudflare account and sign in: `npx wrangler login`.
2. `npx wrangler kv namespace create OAUTH_KV` and put the id in `wrangler.jsonc`.
3. `npx wrangler deploy` → `https://qbank-connector.<you>.workers.dev`.
4. In the Cloudflare dashboard (Workers → qbank-connector → Settings → Variables and Secrets), add two **secrets**:
   - `GITHUB_TOKEN`: a fine-grained token with Contents read & write on the sync repo only.
   - `PASSPHRASE`: something long that you'll type when connecting Claude.
5. In claude.ai: **Settings → Connectors → Add custom connector**, URL `https://qbank-connector.<you>.workers.dev/mcp`. Click **Connect** and enter the passphrase.

`REPO`, `BRANCH`, and `TIMEZONE` are plain vars in `wrangler.jsonc`.

## Local test

```bash
npx wrangler dev --port 8788 --var GITHUB_TOKEN:<token> --var PASSPHRASE:test --var BRANCH:<throwaway-branch>
BASE=http://localhost:8788 PASSPHRASE=test node scripts/smoke-test.mjs --write
```
