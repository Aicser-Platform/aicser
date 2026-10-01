# Python helpers for notebook cells (browser worker and scheduled-run runner share this file).
import sys, io, base64, json, math, datetime, decimal, re
import pandas as pd
import numpy as np

def _aicser_cell(v):
    if v is None: return None
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.bool_,)): return bool(v)
    if isinstance(v, (pd.Timestamp, datetime.datetime, datetime.date)): return v.isoformat()
    if isinstance(v, decimal.Decimal): return float(v)
    if isinstance(v, (int, float, str, bool)): return v
    return str(v)

def _aicser_frame(df, limit):
    if isinstance(df, pd.Series):
        df = df.to_frame()
    if not isinstance(df.index, pd.RangeIndex):
        df = df.reset_index()
    head = df.head(limit)
    return {
        "columns": [str(c) for c in head.columns],
        "rows": [[_aicser_cell(v) for v in row] for row in head.itertuples(index=False, name=None)],
        "row_count": int(len(df)),
    }

def _aicser_frames():
    out = []
    for k, v in list(globals().items()):
        if k.startswith("_"): continue
        if isinstance(v, pd.DataFrame):
            out.append({"name": k, "rows": int(v.shape[0]), "columns": [str(c) for c in v.columns][:200]})
    return out

import ast as _ast

class _Aicser:
    """Your organisation's data, models and decisions, with your permissions: tables and SQL
    from any data source (databases, warehouses, uploaded files, APIs) through the same
    governed path as a SQL cell; approved prediction models; forecasts; saved AI decisions."""

    async def _call(self, kind, **payload):
        import _aicser_js
        return json.loads(await _aicser_js.call(kind, json.dumps(payload, default=str)))

    def sources(self):
        """The data sources you can load from."""
        return pd.DataFrame(list(_aicser_sources), columns=["name", "type", "id"])

    async def sql(self, query, source=None):
        """Run SQL on a data source and return a DataFrame."""
        out = await self._call("query", query=str(query), source=None if source is None else str(source))
        return pd.DataFrame(out["rows"], columns=out["columns"])

    async def table(self, name, source=None, limit=10000):
        """Load a table (up to limit rows) from a data source as a DataFrame."""
        if not isinstance(name, str) or not name.strip() or ";" in name:
            raise ValueError("Give the table as 'schema.table', as shown in the Data panel.")
        return await self.sql(f"SELECT * FROM {name.strip()} LIMIT {max(1, int(limit))}", source)

    async def models(self):
        """Prediction and forecast models you can use (approved versions serve predictions)."""
        items = (await self._call("models"))["items"]
        return pd.DataFrame([{"name": m.get("name"), "task": m.get("task"), "predicts": m.get("output_column"),
                              "approved_version": (m.get("production") or {}).get("version"), "id": m.get("id")}
                             for m in items], columns=["name", "task", "predicts", "approved_version", "id"])

    async def predict(self, model, df):
        """Score each row of df with a model's approved version; returns df with its prediction."""
        _aicser_need_frame(df)
        frame = _aicser_frame(df, _AICSER_MAX_ROWS)
        _aicser_check_size(df)
        out = await self._call("predict", model=str(model), columns=frame["columns"], rows=frame["rows"])
        res = df.reset_index(drop=True).copy()
        res[out["output_column"]] = [p.get("prediction") for p in out["predictions"]]
        probs = [p.get("probabilities") for p in out["predictions"]]
        if any(probs):
            res[out["output_column"] + "_probability"] = [max(p.values()) if p else None for p in probs]
        for w in out.get("warnings") or []:
            print("Note:", w if isinstance(w, str) else w.get("message", w))
        return res

    async def forecast(self, data, periods=12, time=None, value=None, every=None, how="sum"):
        """Forecast a saved forecast model by name, or a DataFrame (give time= and value=) with the
        same engine. Returns history and forecast in one frame (column 'kind'), with the method and
        its measured error in df.attrs."""
        if isinstance(data, pd.DataFrame):
            if not time or not value:
                raise ValueError("Say which columns to use: aicser.forecast(df, time='date', value='sales').")
            _aicser_check_size(data)
            frame = _aicser_frame(data[[time, value]], _AICSER_MAX_ROWS)
            out = await self._call("forecast_frame", columns=frame["columns"], rows=frame["rows"], time_col=time,
                                   value_col=value, periods=int(periods), resample_to=every, agg_func=how)
        else:
            out = await self._call("forecast_model", model=str(data), periods=int(periods))
        hist = pd.DataFrame(out.get("historical") or []).assign(kind="history")
        fc = pd.DataFrame(out.get("forecast") or []).assign(kind="forecast")
        res = pd.concat([hist, fc], ignore_index=True)
        res.attrs.update({"method": out.get("method"), "metrics": out.get("metrics"), "notes": out.get("notes")})
        m = out.get("metrics") or {}
        err = m.get("wmape") if m.get("wmape") is not None else m.get("mape")
        print(f"Forecast by {out.get('method')}" + (f" · typical error {err}%" if err is not None else "")
              + "".join(f"\n{n}" for n in (out.get("notes") or [])[:3] if isinstance(n, str)))
        return res

    async def save_forecast(self, name, sql, time, value, source=None, periods=12):
        """Keep a forecast as a versioned model (approve it to serve dashboards, Chat and the API)."""
        out = await self._call("save_forecast", name=str(name), sql=str(sql), time_col=str(time),
                               value_col=str(value), source=None if source is None else str(source), periods=int(periods))
        print(f"Saved forecast model {out.get('name')!r}; it is fitting now. Approve its version in Prediction models.")
        return out.get("id")

    async def decisions(self):
        """Your organisation's saved AI decisions."""
        items = (await self._call("decisions"))["definitions"]
        return pd.DataFrame([{"name": d.get("name"), "type": d.get("question_type"), "threshold": d.get("threshold"),
                              "id": d.get("id")} for d in items], columns=["name", "type", "threshold", "id"])

    async def decide(self, decision, df, text):
        """Apply a saved AI decision to the text in df (one or more columns). Adds the answer, its
        confidence and whether it needs a person to review it (below the decision's threshold)."""
        _aicser_need_frame(df)
        cols = [text] if isinstance(text, str) else list(text)
        missing = [c for c in cols if c not in df.columns]
        if missing:
            raise ValueError(f"Not columns of the DataFrame: {', '.join(missing)}")
        _aicser_check_size(df, 20000)
        frame = _aicser_frame(df[cols], 20000)
        rows = [dict(zip(frame["columns"], r)) for r in frame["rows"]]
        out = await self._call("decide", decision=str(decision), rows=rows, text_columns=cols)
        key = re.sub(r"[^a-z0-9]+", "_", str(out.get("definition") or "decision").lower()).strip("_")[:40] or "decision"
        res = df.reset_index(drop=True).copy()
        res[key] = [r.get("value") for r in out["results"]]
        res[key + "_confidence"] = [r.get("confidence") for r in out["results"]]
        res[key + "_needs_review"] = [None if r.get("band") is None else r.get("band") != "act" for r in out["results"]]
        return res

    def __repr__(self):
        return ("aicser: table, sql, sources · models, predict, forecast, save_forecast · decisions, decide "
                "— help(aicser.<name>) for details")

_AICSER_MAX_ROWS = 50000
_AICSER_ASYNC = {"sql", "table", "models", "predict", "forecast", "save_forecast", "decisions", "decide"}

def _aicser_need_frame(df):
    if not isinstance(df, pd.DataFrame):
        raise TypeError("Pass a DataFrame.")

def _aicser_check_size(df, cap=None):
    cap = cap or _AICSER_MAX_ROWS
    if len(df) > cap:
        raise ValueError(f"{len(df):,} rows is more than a notebook sends at once ({cap:,}). Filter or sample it first.")

aicser = _Aicser()
_aicser_sources = []

class _AicserAwait(_ast.NodeTransformer):
    """Lets cells write df = aicser.table(...) without await (cells run as async code)."""
    def _nested(self, node):
        for sub in _ast.walk(node):
            if isinstance(sub, _ast.Call) and _aicser_call(sub):
                raise SyntaxError("Load data with aicser at the top level of a cell, then use the DataFrame inside functions.")
        return node
    visit_FunctionDef = visit_Lambda = visit_ClassDef = _nested
    def visit_AsyncFunctionDef(self, node):
        return node
    def visit_Await(self, node):
        return node
    def visit_Call(self, node):
        self.generic_visit(node)
        return _ast.copy_location(_ast.Await(node), node) if _aicser_call(node) else node

def _aicser_call(node):
    f = node.func
    return isinstance(f, _ast.Attribute) and isinstance(f.value, _ast.Name) and f.value.id == "aicser" and f.attr in _AICSER_ASYNC

def _aicser_prepare(src):
    tree = _ast.parse(src)
    if not any(isinstance(n, _ast.Call) and _aicser_call(n) for n in _ast.walk(tree)):
        return src
    return _ast.unparse(_ast.fix_missing_locations(_AicserAwait().visit(tree)))

def _aicser_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return []
    images = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        images.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
        plt.close(fig)
    return images
