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

Production build, served entirely by the Node server:

```sh
npm run build
npm start                            # http://127.0.0.1:4100
```

### Orb debug switches

Append to the URL while tuning the look:

- `?fx=0` disables post-processing (bloom, grain, vignette)
- `?layers=shell,globe,bands,streaks,core,panels` renders only the listed layers

## Milestones

- [x] 1. Scaffold: server health route, frontend with FPS meter
- [x] 2. Orb v1 (idle): **awaiting Kush's review against the reference** ([desktop](docs/orb-v1-desktop.jpg), [iPhone](docs/orb-v1-iphone.jpg))
- [ ] 3. Chat plumbing
- [ ] 4. State-driven animation
- [ ] 5. Voice
- [ ] 6. Auth
- [ ] 7. Ops
- [ ] 8. Polish
