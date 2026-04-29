class MCPEChartsService:
    def __init__(self):
        pass

    async def generate_chart_from_cube_data(
        self, cube_data, query_analysis, options=None
    ):
        """
        Generate an Apache ECharts-compatible configuration from cube-style data.
        - cube_data: {'data': List[Dict], 'annotation': ...}
        - query_analysis: information about query and chosen dimensions/metrics
        """
        try:
            rows = cube_data.get("data", []) or []
            # Normalize dict-of-arrays to list-of-dicts
            if isinstance(rows, dict):
                try:
                    keys = [k for k, v in rows.items() if isinstance(v, list)]
                    length = len(rows[keys[0]]) if keys else 0
                    normalized = []
                    for i in range(length):
                        item = {}
                        for k, v in rows.items():
                            if isinstance(v, list) and i < len(v):
                                item[k] = v[i]
                            else:
                                item[k] = None
                        normalized.append(item)
                    rows = normalized
                except Exception:
                    rows = []

            if not rows:
                return {
                    "success": True,
                    "chart_type": options.get("chart_type", "bar") if isinstance(options, dict) and options.get("chart_type") else "bar",
                    "chart_config": {
                        "title": {"text": "No data", "left": "center"},
                        "tooltip": {"trigger": "axis"},
                        "xAxis": {"type": "category", "data": []},
                        "yAxis": {"type": "value"},
                        "series": [],
                    },
                }

            # helpers
            def safe_num(v):
                if v is None:
                    return None
                if isinstance(v, (int, float)):
                    return float(v)
                s = str(v).strip()
                if s == "":
                    return None
                try:
                    return float(s.replace(",", ""))
                except Exception:
                    return None

            def is_numeric_col(col):
                for r in rows[:10]:
                    v = r.get(col)
                    if v is None:
                        continue
                    if safe_num(v) is not None:
                        return True
                return False

            cols = list(rows[0].keys())

            # determine chart_type, x_col, and series fields
            chart_type = None
            if isinstance(options, dict):
                chart_type = options.get("chart_type")
            chart_type = (chart_type or query_analysis.get("chart_type") or "auto").lower()

            # choose x_col
            x_col = None
            for cand in ("year", "date", "timestamp", "registration_year", "order_year"):
                if cand in cols:
                    x_col = cand
                    break
            if not x_col:
                for c in cols:
                    if not is_numeric_col(c):
                        x_col = c
                        break
            if not x_col and cols:
                x_col = cols[0]

            # choose numeric series
            series_cols = [c for c in cols if c != x_col and is_numeric_col(c)]
            if not series_cols and len(cols) > 1:
                series_cols = [cols[1]]

            # construct series
            series = []
            x_data = [rows[i].get(x_col) for i in range(len(rows))] if x_col else []

            if chart_type == "pie":
                # pie expects category/value pairs; pick first numeric measure
                val_col = series_cols[0] if series_cols else (cols[1] if len(cols) > 1 else None)
                if val_col:
                    pie_data = [{"name": str(r.get(x_col) if x_col else idx), "value": safe_num(r.get(val_col)) or 0} for idx, r in enumerate(rows)]
                    series = [{"name": val_col, "type": "pie", "data": pie_data}]
            else:
                for col in series_cols:
                    series.append({"name": col, "type": ("line" if chart_type == "line" else "bar"), "data": [safe_num(r.get(col)) for r in rows]})

            # fallback ensure at least one series
            if not series and len(cols) > 1:
                fallback_col = cols[1]
                series = [{"name": fallback_col, "type": "bar", "data": [safe_num(r.get(fallback_col)) for r in rows]}]

            # Dash-studio-aligned defaults
            color_palette = (options.get("colorPalette") if isinstance(options, dict) and options.get("colorPalette") else None) or ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc']
            title_text = query_analysis.get("chart_title") or query_analysis.get("original_query") or "Chart Analysis"

            chart_config = {
                "animation": True,
                "animationDuration": 1000,
                "backgroundColor": "transparent",
                "color": color_palette,
                "title": {"show": False, "text": title_text},
                "tooltip": {"show": True, "trigger": "axis"},
                "legend": {"show": True, "top": "top", "data": [s["name"] for s in series]} if series else {"show": False},
                "xAxis": {"type": "category", "data": [str(x) for x in x_data], "name": x_col} if chart_type != "pie" else None,
                "yAxis": {"type": "value"} if chart_type != "pie" else None,
                "series": series,
            }

            # remove None entries (pie charts don't need x/y axis)
            chart_config = {k: v for k, v in chart_config.items() if v is not None}

            return {"success": True, "chart_type": chart_type or "bar", "chart_config": chart_config, "data_analysis": {"rows": len(rows), "columns": cols}}
        except Exception as e:
            return {"success": False, "error": str(e), "chart_config": {"title": {"text": "Chart Generation Error"}, "series": []}}
