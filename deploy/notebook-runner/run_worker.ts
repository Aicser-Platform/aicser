/**
 * One scheduled notebook run, in its own Deno worker. main.ts starts it with narrowed
 * permissions: read the runner's own files, reach only the Aicser server's run callback, no
 * environment, no writes, no subprocesses. It runs the notebook's SQL and Python cells in order
 * with the same Python helpers as the browser (aicser_helpers.py) and the same aicser.* bridge
 * (pythonBridge.ts); every data, model and decision call goes back to the server, which makes it
 * as the notebook's owner through the governed APIs.
 *
 * in:  {cells, callback, secret, sources, projectId}
 * out: {status: 'ok' | 'failed', outputs: {cellId: CellOutput}, failed_cell?, error?}
 */
import { createPythonBridge } from "/runner/pythonBridge.ts";

import { createRequire } from "node:module";

// Pyodide runs on Deno through its Node path, whose core file expects CommonJS globals. They
// only reach what this worker's permissions allow: reading /runner, calling the server.
const g = globalThis as Record<string, unknown>;
g.require = createRequire("file:///runner/pyodide/");
g.__dirname = "/runner/pyodide";
g.__filename = "/runner/pyodide/pyodide.asm.js";
// @ts-ignore: Pyodide's ES module, vendored in the image
const { loadPyodide } = await import("/runner/pyodide/pyodide.mjs");

type Cell = { id: string; type: string; source: string; name?: string | null; data_source_id?: string | null };
type Frame = { columns: string[]; rows: unknown[][] };
type Output = Record<string, unknown>;

const OUTPUT_ROWS = 200;
const NAME_ERROR = /NameError: name '([A-Za-z_][A-Za-z0-9_]*)' is not defined/;

function cleanError(err: unknown): string {
  const text = String((err as Error)?.message ?? err);
  const lines = text.trim().split("\n");
  // Python tracebacks start with the runtime's own frames; the user's code is at the end.
  const start = lines.findIndex((l) => l.includes('File "<exec>"'));
  const out = (start >= 0 ? ["Traceback (most recent call last):", ...lines.slice(start)] : lines).slice(-14);
  const missing = text.match(NAME_ERROR);
  if (missing) out.push(`Hint: if ${missing[1]} is a table, load it with ${missing[1]} = aicser.table("schema.table", source="Data source name").`);
  return out.join("\n");
}

async function run(input: {
  cells: Cell[]; callback: string; secret: string; sources: Array<{ id: string; name: string; type?: string }>; projectId?: string | null;
}) {
  // Every call leaves through one door: the server's proxy for this run.
  const api = async <T>(endpoint: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${input.callback}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Run-Secret": input.secret },
      body: JSON.stringify({ method: init?.method ?? "GET", path: endpoint.startsWith("/") ? endpoint : `/${endpoint}`, body: init?.body ?? null }),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = (data as { detail?: unknown })?.detail;
      const msg = typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `Request failed (${res.status})`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data as T;
  };
  const sourceId = (source: string | null, fallback: string | null) => {
    if (!source) {
      if (fallback) return fallback;
      if (input.sources.length === 1) return input.sources[0].id;
      throw new Error("Say which data source to load from: source=\"name\".");
    }
    const want = source.trim().toLowerCase();
    const hit = input.sources.filter((s) => s.id === source.trim() || s.name.trim().toLowerCase() === want);
    if (hit.length !== 1) throw new Error(hit.length ? `More than one data source is named "${source}".` : `No data source is named "${source}".`);
    return hit[0].id;
  };
  const query = async (sql: string, dsId: string): Promise<Frame & { total: number }> => {
    const res = await api<{ success?: boolean; error?: string; data?: unknown[]; columns?: Array<string | { name: string }>; row_count?: number }>(
      "/data/query/execute",
      { method: "POST", body: JSON.stringify({ query: sql, data_source_id: dsId, optimization: true, project_id: input.projectId ?? undefined }) },
    );
    if (res.success === false) throw new Error(res.error || "The query failed.");
    const named = (res.columns ?? []).map((c) => (typeof c === "string" ? c : c.name));
    const columns = named.length ? named : Object.keys((res.data?.[0] as Record<string, unknown>) ?? {});
    const rows = (res.data ?? []).map((r) => (Array.isArray(r) ? r : columns.map((c) => (r as Record<string, unknown>)[c])));
    return { columns, rows, total: Math.max(res.row_count ?? 0, rows.length) };
  };

  const py = await loadPyodide({ indexURL: "/runner/pyodide/" });
  await py.loadPackage(["pandas", "numpy"], { messageCallback: () => {}, errorCallback: () => {} });
  let lastSqlSource: string | null = null;
  const bridge = createPythonBridge({
    api,
    projectId: input.projectId ?? null,
    sourceId: (source: string | null) => sourceId(source, lastSqlSource),
    query: (sql: string, source: string | null) => query(sql, sourceId(source, lastSqlSource)),
    text: {
      enterpriseOnly: "Prediction models and AI decisions are part of Aicser Enterprise.",
      notFound: (what: string, name: string) => `No ${what} is named "${name}".`,
      ambiguous: (what: string, name: string) => `More than one ${what} is named "${name}"; use its id.`,
    },
  });
  py.registerJsModule("_aicser_js", {
    call: async (kind: string, payload: string) => JSON.stringify((await bridge(String(kind), JSON.parse(String(payload)))) ?? null),
  });
  py.runPython(await Deno.readTextFile("/runner/aicser_helpers.py"));
  py.globals.set("_aicser_in", py.toPy(input.sources.map((s) => [s.name, s.type ?? "", s.id])));
  py.runPython("_aicser_sources = [tuple(x) for x in _aicser_in]; del _aicser_in");

  const outputs: Record<string, Output> = {};
  const results: Record<string, Frame> = {};
  for (const cell of input.cells) {
    const ranAt = new Date().toISOString();
    const started = performance.now();
    try {
      if (cell.type === "sql" && cell.source.trim()) {
        if (!cell.data_source_id) throw new Error("This SQL cell has no data source.");
        lastSqlSource = cell.data_source_id;
        const res = await query(cell.source, cell.data_source_id);
        if (cell.name) results[cell.name] = res;
        outputs[cell.id] = { kind: "table", columns: res.columns, rows: res.rows.slice(0, OUTPUT_ROWS), row_count: res.total, ran_at: ranAt,
          duration_ms: Math.round(performance.now() - started) };
      } else if (cell.type === "python" && cell.source.trim()) {
        for (const [name, frame] of Object.entries(results)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name)) continue;
          py.globals.set("_aicser_in", py.toPy({ columns: frame.columns, rows: frame.rows }));
          py.runPython(`${name} = pd.DataFrame(_aicser_in["rows"], columns=_aicser_in["columns"]); del _aicser_in`);
        }
        let stdout = "";
        py.setStdout({ batched: (s: string) => { stdout += `${s}\n`; } });
        py.setStderr({ batched: (s: string) => { stdout += `${s}\n`; } });
        // Package loading reports progress on stdout; keep it out of the cell's output.
        const quiet = { messageCallback: () => {}, errorCallback: () => {} };
        if (/\bmatplotlib\b|\bplt\b/.test(cell.source)) {
          await py.loadPackage("matplotlib", quiet);
          py.runPython("import matplotlib\nmatplotlib.use('AGG')");
        }
        await py.loadPackagesFromImports(cell.source, quiet);
        py.globals.set("_aicser_src", cell.source);
        const prepared = py.runPython("_aicser_prepare(_aicser_src)");
        py.runPython("del _aicser_src");
        const value = await py.runPythonAsync(prepared);
        let out: Output = { kind: "text" };
        if (value !== undefined && value !== null) {
          py.globals.set("_aicser_last", value);
          if (py.runPython("isinstance(_aicser_last, (pd.DataFrame, pd.Series))")) {
            out = { kind: "table", ...py.runPython(`_aicser_frame(_aicser_last, ${OUTPUT_ROWS})`).toJs({ dict_converter: Object.fromEntries }) };
          } else {
            out = { kind: "text", text: String(py.runPython("repr(_aicser_last)")).slice(0, 20000) };
          }
          py.runPython("del _aicser_last");
          if (typeof value.destroy === "function") value.destroy();
        }
        const images = py.runPython("_aicser_figures()").toJs() as string[];
        const text = [stdout.trim(), out.kind === "text" ? out.text : null].filter(Boolean).join("\n").slice(0, 20000);
        if (out.kind === "table") out = { ...out, text: stdout.trim() || undefined };
        else out = { kind: images.length ? "image" : "text", text: text || undefined, image: images[0] };
        outputs[cell.id] = { ...out, ran_at: ranAt, duration_ms: Math.round(performance.now() - started) };
      }
    } catch (err) {
      const message = cell.type === "python" ? cleanError(err) : String((err as Error)?.message ?? err);
      outputs[cell.id] = { kind: "error", text: message, ran_at: ranAt };
      // Like "Run all": stop at the first failing cell, so later cells don't run on stale data.
      // The run's one-line reason: the exception line ("ModuleNotFoundError: …"), not a trailing hint.
      const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
      const reason = [...lines].reverse().find((l) => /^[A-Za-z_.]*(Error|Exception)\b/.test(l)) ?? lines[lines.length - 1];
      return { status: "failed", outputs, failed_cell: cell.id, error: reason };
    }
  }
  return { status: "ok", outputs };
}

self.onmessage = async (event: MessageEvent) => {
  try {
    self.postMessage(await run(event.data));
  } catch (err) {
    self.postMessage({ status: "failed", outputs: {}, error: String((err as Error)?.message ?? err).slice(0, 2000) });
  }
};
