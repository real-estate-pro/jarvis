# J.A.R.V.I.S.

A private, holographic web front end for Hermes Agent on the Mac mini, served at
`jarvisbykush.us`. Hermes remains the brain; this repo is the interface. The full build spec
is in [`CLAUDE.md`](CLAUDE.md).

```
web/     Vite + React + TypeScript + three.js (react-three-fiber) frontend
server/  Node + Hono backend (binds 127.0.0.1:4100, proxies Hermes and ElevenLabs)
ops/     launchd service, deploy + verify scripts, cloudflared example, SETUP.md
```

## Development

Requires Node 20.12+.

```sh
npm install
cp server/.env.example server/.env   # set NODE_ENV=development, DEV_BYPASS_ACCESS=true locally
npm run hash-passphrase              # choose the lock-screen passphrase
npm run dev                          # server on :4100, Vite on http://127.0.0.1:5173 (proxies /api)
```

Without Hermes running, a mock gateway that speaks the same wire format is available:

```sh
node server/dev/mock-hermes.mjs      # listens on 127.0.0.1:8642; set HERMES_API_KEY=test-key
                                     # (voice: ELEVENLABS_API_KEY=el-test ELEVENLABS_API_URL=http://127.0.0.1:8642)
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


### Security

Two layers, both enforced by the server:

1. **Cloudflare Access**: every request (page and API) must carry a valid
   `Cf-Access-Jwt-Assertion` signed by the team's keys for `CF_ACCESS_AUD`; anything else gets
   403. `DEV_BYPASS_ACCESS=true` skips this for local work and is refused when
   `NODE_ENV=production`.
2. **Passphrase**: the lock screen verifies against an argon2id hash and sets a signed,
   HttpOnly, SameSite=Strict (and Secure in production) session cookie for 30 days. Five wrong
   attempts in 15 minutes lock that IP out for 15 minutes, doubling each time (max 24 h).
   Changing the passphrase signs out every session.

```sh
npm run hash-passphrase   # prompts twice (hidden), saves the hash + a SESSION_SECRET to server/.env
```

In production the server refuses to start unless the passphrase hash, session secret and
both Cloudflare Access values are set. Responses carry a strict Content-Security-Policy.

### Voice

With `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` set in `server/.env`, the **VOICE** toggle
(top right) speaks replies as they stream: text is split into sentences, stripped of markdown,
code (read as "I've put the code on screen."), URLs (domain only) and emoji, then fetched from
`/api/tts` (which streams from ElevenLabs) at most two at a time and played back gaplessly. The
orb follows the real audio amplitude. The server logs a running per-day character count
(`[tts] 2026-09-27: 1,234 chars today`) to keep an eye on credits.

### Talking to JARVIS

The mic button in the input line listens with the browser's built-in speech recognition
(falling back to recording + ElevenLabs Scribe via `/api/stt` where that isn't available).
Words appear as you speak and send when you pause. Answers to spoken questions are spoken back,
and the mic then reopens for a follow-up, so a conversation needs no clicks after the first.

### Orb debug switches

Append to the URL while tuning the look:

- `?fx=0` disables post-processing (bloom, grain, vignette)
- `?layers=shell,globe,bands,streaks,core,panels,sweep` renders only the listed layers
- `?mode=idle|attentive|listening|thinking|responding|speaking|error` pins the orb in one state

## Milestones

- [x] 1. Scaffold: server health route, frontend with FPS meter
- [x] 2. Orb v1 (idle): approved ([desktop](docs/orb-v1-desktop.jpg), [iPhone](docs/orb-v1-iphone.jpg))
- [x] 3. Chat plumbing
- [x] 4. State-driven animation
- [x] 5. Voice
- [x] 6. Auth
- [x] 7. Ops: see [ops/SETUP.md](ops/SETUP.md)
- [ ] 8. Polish
