# Deploying JARVIS to jarvisbykush.us

Everything runs on the Mac mini. The only way in from the internet is the Cloudflare Tunnel,
and Cloudflare Access plus the in-app passphrase guard it (CLAUDE.md §2–3).

```
Browser → Cloudflare Access (your email + one-time PIN) → Tunnel → 127.0.0.1:4100 (jarvis-web)
                                                                     └→ 127.0.0.1:8642 (Hermes)
```

Steps marked **(you)** happen in a browser or need your Mac password; the rest can be done by
Claude Code running in `~/jarvis` on the Mac mini.

---

## 1. Hermes API server

`~/.hermes/.env` must contain:

```sh
API_SERVER_ENABLED=true
API_SERVER_KEY=<long random value>     # e.g. openssl rand -hex 32
```

Do **not** set `API_SERVER_CORS_ORIGINS`. Restart the gateway, then:

```sh
curl -s http://127.0.0.1:8642/health                                    # {"status": "ok"}
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/v1/capabilities
```

Hermes is managed separately; don't create a second launchd job for it.

## 2. Build jarvis-web and fill in `server/.env`

```sh
cd ~/jarvis && npm install && npm run build
npm run hash-passphrase        # (you) choose the lock-screen passphrase; saves hash + SESSION_SECRET
```

`HERMES_API_KEY` in `server/.env` = Hermes' `API_SERVER_KEY`. ElevenLabs key and voice id as
before. Leave `NODE_ENV=development` / `DEV_BYPASS_ACCESS=true` until step 6.

## 3. Run it as a service

```sh
ops/install-service.sh
```

Installs `~/Library/LaunchAgents/com.jarvisbykush.web.plist`: starts at login, restarts if it
exits, logs to `~/Library/Logs/jarvis-web/`. Useful commands:

```sh
launchctl kickstart -k gui/$(id -u)/com.jarvisbykush.web     # restart
tail -f ~/Library/Logs/jarvis-web/jarvis-web.log             # logs
ops/deploy.sh                                                # pull, build, restart
```

## 4. Tunnel: route jarvisbykush.us to 127.0.0.1:4100

First find out what already exists. **Don't create a second tunnel if one is running.**

```sh
cloudflared --version
cloudflared tunnel list                     # locally managed tunnels (needs ~/.cloudflared/cert.pem)
ls ~/.cloudflared/                          # config.yml, <uuid>.json, cert.pem?
brew services list | grep cloudflared
launchctl list | grep -i cloudflared
ps aux | grep '[c]loudflared'               # a "--token" argument means dashboard-managed
```

Then one of:

**A. Dashboard-managed tunnel** (runs with `--token`, no local `config.yml`). **(you)**
In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels**, open the tunnel, and
choose **Public hostnames → Add a public hostname**:

- Subdomain: *(blank)*
- Domain: `jarvisbykush.us`
- Service: `HTTP` → `127.0.0.1:4100`

Cloudflare creates the DNS record itself.

**B. Locally managed tunnel** (`~/.cloudflared/config.yml`). Add the rule from
`ops/cloudflared-config.example.yml` above the catch-all, then:

```sh
cloudflared tunnel ingress validate
cloudflared tunnel route dns <tunnel-name> jarvisbykush.us
# restart cloudflared the way it is run here (brew services restart cloudflared / launchctl kickstart)
```

**C. No tunnel yet.**

```sh
brew install cloudflared
cloudflared tunnel login                      # (you) pick the jarvisbykush.us zone in the browser
cloudflared tunnel create jarvis
cloudflared tunnel route dns jarvis jarvisbykush.us
```

Write `~/.cloudflared/config.yml` from the example, then `sudo cloudflared service install`.

If `jarvisbykush.us` already has an A/AAAA/CNAME record (e.g. a parking page), delete it first
so the tunnel's record can take the apex.

> Until step 5 is done, don't leave the hostname routed with `DEV_BYPASS_ACCESS=true`.

## 5. Cloudflare Access application (you)

In the Cloudflare dashboard, go to **Zero Trust → Access → Applications → Add an application →
Self-hosted**:

1. **Name:** `JARVIS`. **Session duration:** `1 month`.
2. **Public hostname / domain:** `jarvisbykush.us` (no path).
3. **Login methods:** make sure **One-time PIN** is enabled. It's under
   **Zero Trust → Settings → Authentication** if it isn't listed.
4. **Policy:** name it `Only me`, **Action = Allow**, **Include → Emails →** your email address.
   Add nothing else; no "Everyone" rules.
5. Save.
6. Open the application's overview and copy the **Application Audience (AUD) Tag**.
7. Find your **team domain** under **Zero Trust → Settings → Custom Pages** (or General). It
   looks like `something.cloudflareaccess.com`.

## 6. Switch to production

In `server/.env`:

```sh
NODE_ENV=production
DEV_BYPASS_ACCESS=false
CF_ACCESS_TEAM_DOMAIN=something.cloudflareaccess.com
CF_ACCESS_AUD=<AUD tag from step 5>
```

```sh
chmod 600 server/.env
launchctl kickstart -k gui/$(id -u)/com.jarvisbykush.web
tail -n 20 ~/Library/Logs/jarvis-web/jarvis-web.err.log     # "Refusing to start ..." lists anything missing
```

From now on, `http://127.0.0.1:4100` answers **403 Forbidden** (no Access token). That's
expected: use `https://jarvisbykush.us` everywhere, including at home.

## 7. Keep the Mac mini awake (you)

```sh
sudo pmset -a sleep 0 disksleep 0      # never sleep (the display may still turn off)
sudo pmset -a autorestart 1            # power back on after an outage
```

Or use **System Settings → Energy**: "Prevent automatic sleeping when the display is off" and
"Start up automatically after a power failure".

The service is a user agent, so it starts when you're logged in. After a power cut the Mac
waits at the login screen (FileVault) until someone logs in. If that matters, enable automatic
login (**System Settings → Users & Groups**; requires FileVault off).

## 8. Verify

```sh
ops/verify.sh
```

It checks:
- the service is running
- ports 4100 and 8642 listen on loopback only
- production settings are on
- no key or secret is in the web bundle
- a direct request is refused
- the public URL redirects to the Access login
- sleep settings

Then by hand:
- A private window at https://jarvisbykush.us shows the Cloudflare Access login, not the app.
- After the email PIN, the passphrase screen appears; 5 wrong tries lock you out.
- On iPhone Safari: log in, then **Share → Add to Home Screen**.
