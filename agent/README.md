# ProjectPortfolio agent server

Connect any MCP agent — **Hermes**, **Claude Code**, **Codex**, or anything else that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) — to a ProjectPortfolio workspace. The agent can do
everything a person can do on the board: add and update projects, milestones and tasks, move status, write notes,
pages, checklists, tables and swimlane workflows, fill in PMBOK project plans (charter, risk register, …), link
task dependencies, draw arrows, mention teammates. It can tell you where the work is stuck, and send a picture of it.

This folder is a **recipe**: self-contained, no sibling repos, meant to be read, run and extended.

```
 Hermes · Claude Code · Codex           (stdio: the agent starts the server itself)
            │                           (HTTP:  one hosted endpoint, a token per agent)
            ▼
   agent/  MCP server ── auth.ts ──── who is calling, re-checked on every call
            │           workspace.ts  load → run the app's own tool → diff → check → write + log
            │           health.ts     bottlenecks, critical chain, stale / blocked / late work
            ▼
   ../src  the web app's own code: ai/tools.ts, lib/board.ts (roll-up), lib/anc.ts (access stamping), stores
            ▼
   Firestore  workspaces/{wid}/nodes, elements   (+ agentTokens/, workspaces/{wid}/agentLog/ — server-only)
```

## How it works

The web app already defines its agent tools in [`../src/ai/tools.ts`](../src/ai/tools.ts), written against the
app's in-memory stores. This server **runs those exact tools** instead of re-implementing them:

1. load the workspace from Firestore and put it into the app's stores (as if the member had opened the board);
2. run the tool;
3. compare the stores before and after;
4. check the caller is allowed to make those changes (the admin SDK skips `firestore.rules`, so the server
   enforces the same rules itself — `authorize()` in `workspace.ts`);
5. write the changes in one transaction, merged field-by-field with anything a teammate changed meanwhile
   (`src/lib/merge.ts`, the same merge the web app uses), each stamped with `anc` (`src/lib/anc.ts`, shared with
   the web app) so card-level access keeps working;
6. record them in the change log, so any agent change can be reverted.

So an agent can never do something the app wouldn't let a person do, and progress, health, formulas and search
always agree between the app and the agent. **Add a tool to `src/ai/tools.ts` and the agent gets it too.**

Browser-only modules are swapped at build time (`build.mjs`, `src/shims/`): `canvas-kit` → just its roll-up engine,
`services/inbox` → an admin-SDK version. Any other `@/services/*` import fails the build on purpose.

### Pictures

`render_view` renders the real app, not a lookalike. `vite.render.config.ts` (repo root) builds the app with no
Firebase config at all, so it starts in its single-browser mode with no sign-in and nothing to write to. The server
serves that build on `127.0.0.1` only, puts the caller's already-permission-checked workspace into the page's
localStorage, opens the view through the app's own `?view=` link, hides the editing chrome, and screenshots it in
headless Chrome. Requests to any other origin (except fonts) are blocked.

### Tools

Everything in `src/ai/tools.ts` except `undo`/`redo` (they belong to one browser tab), plus:

| Tool | What |
|---|---|
| `project_health` | Bottlenecks (open tasks the most other work waits on, via finish-to-start `after` links), the longest open dependency chain, blocked / late / out-of-sequence / stale tasks, unassigned work, load per person, milestones and projects not on track. Computed, not guessed. |
| `render_view` | A PNG of the board exactly as the app draws it — tree (WBS), timeline (planned vs actual, Gantt-style), boards by project / milestone / priority — returned as MCP image content so the agent can post it to Discord, Telegram, Slack. |
| `list_changes` | Recent agent changes in the workspace. |
| `revert_change` | Put back everything one agent change touched. Refuses if someone edited those items since, unless `force: true`. |

## Security model

| | |
|---|---|
| Token = one member of one workspace | The agent acts with that member's rights. Owner/manager: anything. Operator: only the status of tasks assigned to them (same rule as `firestore.rules`). |
| Re-checked every call | Role and membership are re-read on every request; removing someone cuts their agent off immediately. |
| Only a hash is stored | `agentTokens/{sha256}`. The token itself is printed once. |
| Server-only collections | `agentTokens/` and `workspaces/{wid}/agentLog/` have no client rule; `npm run test:rules` (repo root) proves a browser can't read or write them. |
| Fails closed | No token, unknown token, revoked token, removed member → refused. The stdio server refuses to start. |
| Not yet | Members limited to certain cards (`scopes`) can't get a token yet — serving a partial board safely needs the web app's stand-in-portfolio handling ported first. |
| Credentials | Never in this repo. Application Default Credentials, a service-account key kept outside the repo (`chmod 600`), or Cloud Run's own identity. |

## Run it yourself

You need your own Firebase project running ProjectPortfolio (see the main README) and Node 20+.

```bash
cd agent
npm install
npm run build
npm run build:render      # only for pictures; needs Chrome (or set PP_CHROME_PATH)
gcloud auth application-default login        # or GOOGLE_APPLICATION_CREDENTIALS=/path/outside/repo/key.json
export PP_FIREBASE_PROJECT=<your-firebase-project-id>

# a token for one member of one workspace (workspace id = the owner's uid for a personal workspace)
npm run token -- create --workspace <wid> --member you@example.com --label hermes
npm run token -- list   --workspace <wid>
npm run token -- revoke --id <first 12+ chars from list>
```

### Connect an agent — stdio (the agent starts the server)

**Claude Code**
```bash
claude mcp add projectportfolio \
  -e PP_FIREBASE_PROJECT=<project-id> -e PP_AGENT_TOKEN=ppa_... \
  -- node /absolute/path/to/projectportfolio/agent/dist/stdio.js
```

**Codex**
```bash
codex mcp add projectportfolio \
  --env PP_FIREBASE_PROJECT=<project-id> --env PP_AGENT_TOKEN=ppa_... \
  -- node /absolute/path/to/projectportfolio/agent/dist/stdio.js
```

**Hermes** (`~/.hermes/config.yaml`)
```yaml
mcp_servers:
  projectportfolio:
    command: node
    args: ["/absolute/path/to/projectportfolio/agent/dist/stdio.js"]
    env:
      PP_FIREBASE_PROJECT: "<project-id>"
      PP_AGENT_TOKEN: "ppa_..."
```

### Connect an agent — HTTP (one hosted endpoint)

```bash
PORT=8787 PP_FIREBASE_PROJECT=<project-id> npm run start:http     # or deploy to Cloud Run with the Dockerfile
```

```bash
claude mcp add --transport http projectportfolio https://<host>/mcp -H "Authorization: Bearer ppa_..."
codex mcp add projectportfolio --url https://<host>/mcp --bearer-token-env-var PP_AGENT_TOKEN
```
```yaml
# Hermes
mcp_servers:
  projectportfolio:
    url: https://<host>/mcp
    headers:
      Authorization: "Bearer ppa_..."
```

Put HTTPS in front of it (Cloud Run does). Never expose it over plain HTTP: the token is a password.

## Test

End-to-end against the Firestore emulator — a real MCP client drives `dist/stdio.js` as a manager and as an
operator, checks `anc` stamping, health, revert, and every refusal:

```bash
npx firebase-tools@13 emulators:start --only firestore --project demo-projectportfolio   # another terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 PP_FIREBASE_PROJECT=demo-projectportfolio npm test
```

## Roadmap (pick one up)

- **Pictures in the Docker image** — `render_view` needs Chrome, which the image does not include yet; add
  `chromium` and set `PP_CHROME_PATH`. Pictures also show the current window only; fitting the whole board is next.
- **Card-scoped members** — port the stand-in portfolio card handling from `src/services/cloud.ts`, then lift the
  refusal in `auth.ts`.
- **Tokens from the app** — a "Connect an agent" sheet that mints and revokes tokens (needs a callable function;
  the browser must never write `agentTokens/` directly).
- **Docker image** — written, not yet built in CI; treat it as a starting point.
