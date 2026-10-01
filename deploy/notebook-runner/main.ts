/**
 * Aicser notebook runner: runs a notebook's cells on a schedule, in Python compiled to
 * WebAssembly (Pyodide), the same engine as the browser.
 *
 * Isolation, from the outside in:
 * - the container has no secrets but its own key, sits on an internal network that reaches only
 *   the Aicser server, and runs read-only as an unprivileged user;
 * - Deno's permissions limit this process to reading /runner, serving :8200 and calling the server;
 * - each run gets a fresh worker with even fewer permissions (no environment — so not the key —
 *   no writes, no subprocesses, network only to the server) and is stopped at its time limit.
 *
 * POST /run   X-Runner-Key: <key>   {cells, callback, secret, sources, project_id, timeout_s}
 * GET  /health
 */
const KEY = Deno.env.get("RUNNER_KEY") ?? "";
const SERVER = Deno.env.get("RUNNER_CALLBACK_HOST") ?? "server:8000";
const MAX_CONCURRENT = 2;
const MAX_QUEUE = 20;
const MAX_TIMEOUT_S = 1800;

if (KEY.length < 24) {
  console.error("RUNNER_KEY must be set (at least 24 characters).");
  Deno.exit(1);
}

let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function runOnce(body: Record<string, unknown>, timeoutS: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./run_worker.ts", import.meta.url).href, {
      type: "module",
      // @ts-ignore: Deno worker permissions (--unstable-worker-options)
      deno: { permissions: { read: ["/runner"], net: [SERVER], env: false, write: false, run: false, ffi: false, sys: false } },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ status: "failed", outputs: {}, error: `The run was stopped after ${timeoutS} seconds.` });
    }, timeoutS * 1000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      e.preventDefault();
      resolve({ status: "failed", outputs: {}, error: String(e.message ?? e).slice(0, 2000) });
    };
    worker.postMessage(body);
  });
}

Deno.serve({ port: 8200, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true, running, waiting: waiting.length });
  }
  if (req.method !== "POST" || url.pathname !== "/run") return new Response("Not found", { status: 404 });
  if (!sameKey(req.headers.get("X-Runner-Key") ?? "", KEY)) return new Response("Forbidden", { status: 403 });
  if (waiting.length >= MAX_QUEUE) return Response.json({ detail: "The runner is busy; try again shortly." }, { status: 429 });
  const body = await req.json() as Record<string, unknown>;
  const callback = String(body.callback ?? "");
  if (!callback.startsWith(`http://${SERVER}/`)) return Response.json({ detail: "Bad callback." }, { status: 400 });
  const timeoutS = Math.max(10, Math.min(MAX_TIMEOUT_S, Number(body.timeout_s) || 600));
  const started = performance.now();
  const out = await slot(() => runOnce({
    cells: body.cells ?? [], callback, secret: String(body.secret ?? ""), sources: body.sources ?? [], projectId: body.project_id ?? null,
  }, timeoutS));
  return Response.json({ ...out, duration_ms: Math.round(performance.now() - started) });
});
