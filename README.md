# J.A.R.V.I.S.

A private, holographic web front end for Hermes Agent on the Mac mini, served at
`jarvisbykush.us`. Hermes remains the brain; this repo is the interface. The full build spec
is in [`CLAUDE.md`](CLAUDE.md).

```
web/     Vite + React + TypeScript + three.js (react-three-fiber) frontend
server/  Node + Hono backend (binds 127.0.0.1:4100, proxies Hermes and ElevenLabs)
ops/     launchd, cloudflared and setup notes
```

## Development

Requires Node 20.12+.

```sh
npm install
cp server/.env.example server/.env   # set NODE_ENV=development, DEV_BYPASS_ACCESS=true locally
npm run dev                          # server on :4100, Vite on http://127.0.0.1:5173 (proxies /api)
```

Without Hermes running, a mock gateway that speaks the same wire format is available:

```sh
node server/dev/mock-hermes.mjs      # listens on 127.0.0.1:8642; set HERMES_API_KEY=test-key
```

Production build, served entirely by the Node server:

```sh
npm run build
npm start                            # http://127.0.0.1:4100
```

### Hermes

The server reads `GET /v1/capabilities` at boot and streams through the Sessions API
(`/api/sessions/{id}/chat/stream`) when advertised, else Chat Completions with
`X-Hermes-Session-Id`. The dashboard's session id is kept in `server/data/session.json`.
Stop uses `POST /v1/runs/{run_id}/stop`; commands Hermes flags for approval show an
authorization card in the conversation.

> Until milestone 6 (auth) lands, `/api/*` is unauthenticated. The server only listens on
> 127.0.0.1, so do not point cloudflared at it yet.

### Orb debug switches

Append to the URL while tuning the look:

- `?fx=0` disables post-processing (bloom, grain, vignette)
- `?layers=shell,globe,bands,streaks,core,panels` renders only the listed layers

## Milestones

- [x] 1. Scaffold: server health route, frontend with FPS meter
- [x] 2. Orb v1 (idle): approved ([desktop](docs/orb-v1-desktop.jpg), [iPhone](docs/orb-v1-iphone.jpg))
- [x] 3. Chat plumbing
- [ ] 4. State-driven animation
- [ ] 5. Voice
- [ ] 6. Auth
- [ ] 7. Ops
- [ ] 8. Polish
