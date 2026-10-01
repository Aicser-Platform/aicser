/* Python for notebooks, running in the viewer's browser (Pyodide, MPL-2.0, unmodified).
 * No code ever runs on the server. Data arrives from query results the viewer is already
 * allowed to see. One namespace per notebook, shared by its cells, like a Jupyter kernel.
 *
 * Messages in:  {id, op: 'init', indexURL}
 *               {id, op: 'run', code, frames: {name: {columns, rows}}}
 *               {id, op: 'frames'}                 → DataFrames in the namespace
 *               {id, op: 'get', name, limit}       → one DataFrame's rows
 * Messages out: {id, ok, ...result} or {id, ok: false, error}
 *
 * aicser.* (tables, SQL, models, forecasts, decisions) asks the page ({op: 'data', req, kind,
 * payload}); the page calls the same governed APIs the rest of Aicser uses, with the viewer's
 * permissions and row security, and answers {op: 'data_reply', req, ok, json | error}.
 */
/* eslint-disable no-restricted-globals */
let pyodide = null;
let loading = null;

async function ensure(indexURL) {
  if (pyodide) return pyodide;
  if (!loading) {
    loading = (async () => {
      importScripts(`${indexURL}pyodide.js`);
      const py = await self.loadPyodide({ indexURL });
      await py.loadPackage(['pandas', 'numpy']);
      py.registerJsModule('_aicser_js', { call: askPage });
      // Shared with the scheduled-run runner, so both run the same helpers.
      py.runPython(await (await fetch(new URL('aicser_helpers.py', self.location.href))).text());
      pyodide = py;
      return py;
    })();
  }
  return loading;
}

let indexURLSaved = '';
const dataWaits = new Map();
let dataSeq = 0;

/** aicser.* asks the page (which holds the viewer's session) to do one allowed thing: run a
 * query, list or use models and decisions. Payload and result travel as JSON text. */
function askPage(kind, payload) {
  dataSeq += 1;
  const req = dataSeq;
  return new Promise((resolve, reject) => {
    dataWaits.set(req, { resolve, reject });
    self.postMessage({ op: 'data', req, kind: String(kind), payload: String(payload) });
  });
}

const NAME_ERROR = /NameError: name '([A-Za-z_][A-Za-z0-9_]*)' is not defined/;

self.onmessage = async (event) => {
  const { id, op } = event.data || {};
  if (op === 'data_reply') {
    const wait = dataWaits.get(event.data.req);
    if (!wait) return;
    dataWaits.delete(event.data.req);
    if (event.data.ok) wait.resolve(event.data.json);
    else wait.reject(new Error(event.data.error || 'Could not load the data'));
    return;
  }
  try {
    if (op === 'init') {
      indexURLSaved = event.data.indexURL;
      await ensure(indexURLSaved);
      self.postMessage({ id, ok: true });
      return;
    }
    const py = await ensure(indexURLSaved);
    if (op === 'run') {
      const { code, frames, sources } = event.data;
      if (Array.isArray(sources)) {
        py.globals.set('_aicser_in', py.toPy(sources.map((x) => [x.name, x.type || '', x.id])));
        py.runPython('_aicser_sources = [tuple(x) for x in _aicser_in]; del _aicser_in');
      }
      for (const [name, frame] of Object.entries(frames || {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name)) continue;
        py.globals.set('_aicser_in', py.toPy({ columns: frame.columns, rows: frame.rows }));
        py.runPython(`${name} = pd.DataFrame(_aicser_in["rows"], columns=_aicser_in["columns"]); del _aicser_in`);
      }
      let stdout = '';
      py.setStdout({ batched: (s) => { stdout += `${s}\n`; } });
      py.setStderr({ batched: (s) => { stdout += `${s}\n`; } });
      if (/\bmatplotlib\b|\bplt\b/.test(code)) {
        await py.loadPackage('matplotlib');
        py.runPython("import matplotlib\nmatplotlib.use('AGG')");
      }
      await py.loadPackagesFromImports(code);
      const started = performance.now();
      py.globals.set('_aicser_src', code);
      const prepared = py.runPython('_aicser_prepare(_aicser_src)');
      py.runPython('del _aicser_src');
      const value = await py.runPythonAsync(prepared);
      let result = null;
      if (value !== undefined && value !== null) {
        py.globals.set('_aicser_last', value);
        const isFrame = py.runPython('isinstance(_aicser_last, (pd.DataFrame, pd.Series))');
        if (isFrame) {
          result = { kind: 'table', ...py.runPython('_aicser_frame(_aicser_last, 200)').toJs({ dict_converter: Object.fromEntries }) };
        } else {
          result = { kind: 'text', text: String(py.runPython('repr(_aicser_last)')).slice(0, 20000) };
        }
        py.runPython('del _aicser_last');
        if (value && typeof value.destroy === 'function') value.destroy();
      }
      const images = py.runPython('_aicser_figures()').toJs();
      self.postMessage({
        id, ok: true, stdout: stdout.slice(0, 20000), result, images,
        duration_ms: Math.round(performance.now() - started),
        frames: py.runPython('_aicser_frames()').toJs({ dict_converter: Object.fromEntries }),
      });
      return;
    }
    if (op === 'frames') {
      self.postMessage({ id, ok: true, frames: py.runPython('_aicser_frames()').toJs({ dict_converter: Object.fromEntries }) });
      return;
    }
    if (op === 'get') {
      const { name, limit } = event.data;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Unknown table');
      const frame = py.runPython(`_aicser_frame(${name}, ${Math.max(1, Math.min(Number(limit) || 200, 200000))})`)
        .toJs({ dict_converter: Object.fromEntries });
      self.postMessage({ id, ok: true, frame });
      return;
    }
    throw new Error(`Unknown operation ${op}`);
  } catch (err) {
    const text = String((err && err.message) || err);
    // Python tracebacks are long; the last lines say what went wrong.
    const lines = text.trim().split('\n').slice(-12);
    // A table name used as a variable: say how Python loads a table.
    const missing = text.match(NAME_ERROR);
    if (missing) lines.push(`Hint: if ${missing[1]} is a table, load it with ${missing[1]} = aicser.table("schema.table", source="Data source name"), or click the table in the Data panel.`);
    self.postMessage({ id, ok: false, error: lines.join('\n') });
  }
};
