#!/usr/bin/env node

/**
 * Lightweight WS soak runner for P1-06.
 * Node.js >= 20 required.
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const baseUrl = args["base-url"] || "ws://localhost:8080";
const token = args["token"] || "";
const convId = args["conv-id"] || "conv_demo_001";
const pointId = args["point-id"] || "pt_demo_001";
const durationSec = Number(args["duration-sec"] || 300);
const chatClients = Number(args["chat-clients"] || 10);
const notifClients = Number(args["notif-clients"] || 10);
const spotyouClients = Number(args["spotyou-clients"] || 10);

if (!token) {
  console.error("Missing required --token");
  process.exit(1);
}

const metrics = {
  connections_opened: 0,
  connections_closed: 0,
  messages_sent: 0,
  messages_received: 0,
  errors: 0,
  close_codes: new Map()
};

const sockets = [];
let stopping = false;

function incCloseCode(code) {
  const current = metrics.close_codes.get(code) || 0;
  metrics.close_codes.set(code, current + 1);
}

function mkUrl(kind) {
  if (kind === "chat") return `${baseUrl}/api/ws/chat/${convId}`;
  if (kind === "notif") return `${baseUrl}/api/ws/notifications`;
  return `${baseUrl}/api/ws/spot-you/${pointId}`;
}

function openClient(kind, idx) {
  return new Promise((resolve) => {
    const ws = new WebSocket(mkUrl(kind));
    const state = { kind, idx, ws, open: false, pingTimer: null };
    sockets.push(state);
    let settled = false;
    const settleOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const openTimeout = setTimeout(() => {
      settleOnce();
    }, 2000);

    ws.addEventListener("open", () => {
      clearTimeout(openTimeout);
      metrics.connections_opened++;
      state.open = true;
      ws.send(JSON.stringify({ token }));
      metrics.messages_sent++;

      state.pingTimer = setInterval(() => {
        if (stopping || ws.readyState !== WebSocket.OPEN) return;
        const payload = kind === "chat"
          ? { type: "message", body: `soak-${idx}-${Date.now()}` }
          : { type: "ping", ts: Date.now() };
        ws.send(JSON.stringify(payload));
        metrics.messages_sent++;
      }, 5000);
      settleOnce();
    });

    ws.addEventListener("message", () => {
      metrics.messages_received++;
    });

    ws.addEventListener("error", () => {
      metrics.errors++;
      settleOnce();
    });

    ws.addEventListener("close", (ev) => {
      clearTimeout(openTimeout);
      if (state.pingTimer) clearInterval(state.pingTimer);
      metrics.connections_closed++;
      incCloseCode(ev.code);
      settleOnce();
    });
  });
}

async function main() {
  const start = Date.now();
  const tasks = [];
  for (let i = 0; i < chatClients; i++) tasks.push(openClient("chat", i));
  for (let i = 0; i < notifClients; i++) tasks.push(openClient("notif", i));
  for (let i = 0; i < spotyouClients; i++) tasks.push(openClient("spotyou", i));
  await Promise.all(tasks);

  const reportTimer = setInterval(() => {
    const elapsedSec = Math.max(1, Math.floor((Date.now() - start) / 1000));
    const mps = ((metrics.messages_sent + metrics.messages_received) / elapsedSec).toFixed(2);
    const rssMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
    console.log(JSON.stringify({
      t_sec: elapsedSec,
      connections_opened: metrics.connections_opened,
      connections_closed: metrics.connections_closed,
      messages_sent: metrics.messages_sent,
      messages_received: metrics.messages_received,
      errors: metrics.errors,
      messages_per_sec: Number(mps),
      rss_mb: Number(rssMb),
      close_codes: Object.fromEntries(metrics.close_codes.entries())
    }));
  }, 10000);

  await new Promise((r) => setTimeout(r, durationSec * 1000));
  stopping = true;
  clearInterval(reportTimer);

  for (const s of sockets) {
    try {
      if (s.pingTimer) clearInterval(s.pingTimer);
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.close(1000, "soak_end");
      }
    } catch (_) {
      // ignore
    }
  }

  setTimeout(() => {
    const elapsedSec = Math.max(1, Math.floor((Date.now() - start) / 1000));
    const mps = ((metrics.messages_sent + metrics.messages_received) / elapsedSec).toFixed(2);
    const rssMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
    console.log("FINAL_REPORT");
    console.log(JSON.stringify({
      duration_sec: elapsedSec,
      ...metrics,
      messages_per_sec: Number(mps),
      rss_mb: Number(rssMb),
      close_codes: Object.fromEntries(metrics.close_codes.entries())
    }, null, 2));
    process.exit(0);
  }, 1500);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
