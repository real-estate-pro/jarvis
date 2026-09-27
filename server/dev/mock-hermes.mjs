// Mock Hermes gateway for UI development, following the real wire format
// (hermes-agent gateway/platforms/api_server.py). Run: node server/dev/mock-hermes.mjs
// then start the server with HERMES_API_KEY=test-key. Messages containing "approve" trigger an
// approval prompt; "stop" streams slowly so the Stop button can be tried. MODE=completions
// exercises the Chat Completions fallback.
import http from "node:http";
const KEY = "test-key";
const MODE = process.env.MODE || "sessions";
const sessions = new Map(); // id -> {title, messages:[]}
const runs = new Map(); // run_id -> {stop:boolean, approval:null|fn}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
async function body(req) { let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; }

const LONG_REPLY = "Here's what it looks like around **Lexington, KY**:\n\n**Right now:** ~83°F, partly cloudy, humidity 67%, feels like 88°F\n\n**Today:** Showers and thunderstorms possible (mainly after 2pm), high near 82°F, 90% chance of rain.\n\n**Tonight:** Showers likely before 10pm, low around 69°F.\n\n### Rest of the week\n- **Friday:** High 82°F, mostly cloudy\n- **Saturday:** High 85°F, showers likely\n- **Sunday:** High 87°F, mostly sunny\n- **Monday:** High 89°F, sunny\n- **Tuesday:** High 91°F, slight storm chance\n\nHot and humid heading into the weekend. Source: [weather.gov](https://weather.gov). Want the `hourly` forecast?";
const REPLY = "Good evening, sir. I checked the system: all services are nominal. The Mac mini has been up for three days.\n\n```sh\nuptime\n```\n\nAnything else?";

async function runTurn(res, sessionId, message, write) {
  const runId = `run_${++seq}`;
  const run = { stop: false, approval: null };
  runs.set(runId, run);
  const s = sessions.get(sessionId);
  s.messages.push({ role: "user", content: message, timestamp: Date.now() / 1000 });
  await write("run.started", { run_id: runId, user_message: { role: "user", content: message } });
  await write("message.started", { run_id: runId, message: { id: "msg_1", role: "assistant" } });
  await sleep(400);
  res.write(": keepalive\n\n");
  await write("tool.progress", { run_id: runId, tool_name: "_thinking", delta: "hmm" });
  await write("tool.started", { run_id: runId, tool_name: "terminal", preview: "uptime", args: { command: "uptime" } });
  await sleep(700);
  if (/approve/i.test(message)) {
    await write("approval.request", { run_id: runId, command: "rm -rf ~/tmp/cache", description: "recursive delete", choices: ["once", "session", "always", "deny"] });
    const choice = await new Promise((r) => (run.approval = r));
    await write(choice === "deny" ? "tool.failed" : "tool.completed", { run_id: runId, tool_name: "terminal", preview: choice });
  } else {
    await write("tool.completed", { run_id: runId, tool_name: "terminal", preview: "up 3 days" });
  }
  await write("tool.started", { run_id: runId, tool_name: "web_search", preview: "weather" });
  await sleep(300);
  await write("tool.completed", { run_id: runId, tool_name: "web_search", preview: "ok" });
  let text = "";
  const reply = /weather|long/i.test(message) ? LONG_REPLY : REPLY;
  for (const tok of reply.split(/(?<= )/)) {
    if (run.stop) {
      await write("assistant.completed", { run_id: runId, content: text, completed: false, interrupted: true });
      await write("run.cancelled", { run_id: runId, completed: false, interrupted: true });
      await write("done", {});
      return;
    }
    text += tok;
    await write("assistant.delta", { run_id: runId, message_id: "msg_1", delta: tok });
    await sleep(/stop/i.test(message) ? 250 : 15);
  }
  s.messages.push({ role: "assistant", content: text, timestamp: Date.now() / 1000 });
  await write("assistant.completed", { run_id: runId, content: text, completed: true });
  await write("run.completed", { run_id: runId, completed: true, usage: {} });
  await write("done", {});
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/health") return json(res, 200, { status: "ok" });
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: "Invalid API key" } });
  if (p === "/v1/capabilities") return json(res, 200, { object: "hermes.api_server.capabilities", features: { chat_completions: true, run_stop: true, session_chat_streaming: MODE === "sessions", session_resources: true } });
  if (p === "/api/sessions" && req.method === "POST") {
    const b = await body(req);
    for (const s of sessions.values()) if (s.title === b.title) return json(res, 400, { error: { message: "Title already in use by session x", code: "invalid_title" } });
    const id = `api_${Date.now()}_${++seq}`;
    sessions.set(id, { title: b.title, messages: [] });
    console.log("created", id, b.title);
    return json(res, 201, { object: "hermes.session", session: { id, title: b.title } });
  }
  let m;
  if ((m = p.match(/^\/api\/sessions\/([^/]+)$/))) return sessions.has(m[1]) ? json(res, 200, { session: { id: m[1] } }) : json(res, 404, { error: { message: "Session not found" } });
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/))) {
    const s = sessions.get(m[1]);
    if (!s) return json(res, 404, { error: { message: "Session not found" } });
    return json(res, 200, { object: "list", data: [...s.messages, { role: "tool", content: "x" }].reverse() });
  }
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/chat\/stream$/))) {
    const s = sessions.get(m[1]);
    if (!s) return json(res, 404, { error: { message: "Session not found" } });
    const b = await body(req);
    res.writeHead(200, { "content-type": "text/event-stream" });
    let n = 0;
    const write = async (name, payload) => { res.write(`event: ${name}\ndata: ${JSON.stringify({ ...payload, session_id: m[1], seq: ++n })}\n\n`); };
    return runTurn(res, m[1], b.message, write).then(() => res.end());
  }
  if ((m = p.match(/^\/v1\/runs\/([^/]+)\/stop$/))) { const r = runs.get(m[1]); if (!r) return json(res, 404, {}); r.stop = true; return json(res, 200, { status: "stopping" }); }
  if ((m = p.match(/^\/v1\/runs\/([^/]+)\/approval$/))) { const r = runs.get(m[1]); const b = await body(req); if (!r?.approval) return json(res, 409, { error: { message: "no approval" } }); r.approval(b.choice); r.approval = null; return json(res, 200, { choice: b.choice }); }
  if (p === "/v1/chat/completions") {
    const b = await body(req);
    const sid = req.headers["x-hermes-session-id"];
    if (!sessions.has(sid)) sessions.set(sid, { title: null, messages: [] });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const id = `chatcmpl-${++seq}`;
    res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { role: "assistant" } }] })}\n\n`);
    res.write(`event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: "terminal", label: "uptime", toolCallId: "call_1", status: "running" })}\n\n`);
    await sleep(300);
    res.write(`event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: "terminal", toolCallId: "call_1", status: "completed" })}\n\n`);
    for (const tok of "Fallback path reply, sir.".split(/(?<= )/)) { res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { content: tok } }] })}\n\n`); await sleep(30); }
    sessions.get(sid).messages.push({ role: "user", content: b.messages.at(-1).content, timestamp: Date.now()/1000 }, { role: "assistant", content: "Fallback path reply, sir.", timestamp: Date.now()/1000 + 1 });
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  json(res, 404, { error: { message: `no route ${p}` } });
}).listen(8642, "127.0.0.1", () => console.log("mock hermes on 8642", MODE));
