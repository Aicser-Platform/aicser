"""
Enhanced Chart Service with comprehensive Group By and Sorting functionality.

This service supports:

AGGREGATION:
- count: COUNT(*) - count records
- sum: SUM(field) - sum numeric field values  
- avg: AVG(field) - average of numeric field values
- max: MAX(field) - maximum field value
- min: MIN(field) - minimum field value

GROUPING:
- x (xField): Primary grouping field (required)
- groupField: Secondary grouping field (optional)

SORTING:
- sortBy: 'x' (field values), 'y' (aggregated values), 'record_order' (original)
- sortOrder: 'asc' (ascending), 'desc' (descending)
- groupSortBy: 'field' (by group field), 'order' (keep current order)
- groupOrder: 'asc' (ascending), 'desc' (descending)

EXAMPLES:
1. Count by region, sorted by region name ascending:
   { x: 'region', aggregate: 'count', sortBy: 'x', sortOrder: 'asc' }

2. Sum sales by region, sorted by total sales descending:
   { x: 'region', aggregate: 'sum', yMetric: 'sales', sortBy: 'y', sortOrder: 'desc' }

3. Multi-level grouping with sorting:
   { x: 'region', groupField: 'product', aggregate: 'sum', yMetric: 'amount', 
     sortBy: 'y', sortOrder: 'desc', groupSortBy: 'field', groupOrder: 'asc' }
"""

import uuid
import json
from typing import List, Optional, Dict, Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.charts.models import Chart
from src.modules.data.models import DataSource
from src.modules.data.services.multi_engine_query_service import MultiEngineQueryService


class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================
    # CRUD
    # =========================================================
    async def create(self, data: dict, commit: bool = True) -> Chart:
        chart = Chart(**data)
        self.db.add(chart)
        await self.db.flush()
        await self.db.refresh(chart)
        if commit:
            await self.db.commit()
        return chart

    async def get(self, chart_id: uuid.UUID) -> Optional[Chart]:
        if not isinstance(chart_id, uuid.UUID):
            chart_id = uuid.UUID(str(chart_id))
        stmt = select(Chart).where(Chart.id == chart_id)
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def list(self) -> List[Chart]:
        stmt = select(Chart)
        res = await self.db.execute(stmt)
        return res.scalars().all()

    async def update(self, chart: Chart, data: dict) -> Chart:
        for key, value in data.items():
            if hasattr(chart, key) and value is not None:
                setattr(chart, key, value)
        await self.db.flush()
        await self.db.refresh(chart)
        return chart

    async def delete(self, chart: Chart) -> None:
        await self.db.delete(chart)
        await self.db.flush()
        await self.db.commit()

    async def list_by_user_id_and_project_id(self, user_id: uuid.UUID, project_id: uuid.UUID) -> List[Chart]:
        stmt = select(Chart).where(Chart.user_id == user_id, Chart.project_id == project_id)
        res = await self.db.execute(stmt)
        return res.scalars().all()

    def _resolve_table_and_schema(self, schema_info: Any) -> tuple[Optional[str], str]:
        """Resolves (table, schema) from schema_info, supporting various formats."""
        if not schema_info:
            return None, "public"

        # Handle case where schema_info is a JSON string
        if isinstance(schema_info, str):
            try:
                schema_info = json.loads(schema_info)
            except:
                return None, "public"
        
        if not isinstance(schema_info, dict):
            return None, "public"
        
        # 1. Direct 'table' and 'schema' keys
        table = schema_info.get("table")
        schema = schema_info.get("schema", "public")
        if table:
            return table, schema
            
        # 2. 'tables' list
        tables = schema_info.get("tables")
        if isinstance(tables, list) and len(tables) > 0:
            target = tables[0]
            for t in tables:
                if t.get("active") or t.get("is_active"):
                    target = t
                    break
            return target.get("name"), target.get("schema") or schema_info.get("schema") or "public"
            
        return None, "public"

    async def _ensure_data_source_schema(self, data_source: DataSource) -> None:
        """Lazily fetch schema for types that might not have it pre-populated (database, sample_duckdb, google_sheets)."""
        # If schema already exists and has tables, we're good
        if data_source.schema:
            try:
                schema_info = data_source.schema
                if isinstance(schema_info, str):
                    schema_info = json.loads(schema_info)
                
                if isinstance(schema_info, dict) and schema_info.get("tables"):
                    return
            except:
                pass

        # If it's a file, it should already have it.
        if data_source.type not in ("database", "warehouse", "sample_duckdb", "google_sheets"):
            return

        try:
            from src.modules.data.services.data_connectivity_service import DataConnectivityService
            ds_service = DataConnectivityService()
            
            # Simple dict for schema fetching methods
            ds_dict = {
                "id": str(data_source.id),
                "type": data_source.type,
                "db_type": data_source.db_type,
                "format": data_source.format,
                "connection_config": data_source.connection_config,
            }

            schema_result = None
            if data_source.type == "sample_duckdb":
                schema_result = await ds_service.get_sample_duckdb_schema(ds_dict)
            elif data_source.type == "google_sheets":
                schema_result = await ds_service.get_google_sheets_schema(ds_dict)
            elif data_source.type in ("database", "warehouse"):
                schema_result = await ds_service.get_database_schema(str(data_source.id))

            if schema_result and schema_result.get("success") and schema_result.get("schema"):
                data_source.schema = schema_result["schema"]
                # Save back to DB for future use
                try:
                    self.db.add(data_source)
                    await self.db.commit()
                except Exception as save_err:
                    pass
        except Exception as e:
            pass
    # =========================================================
    # EXECUTE CHART (DB OR FILE)
    # =========================================================
    async def execute(self, chart: Chart) -> Dict[str, Any]:
        if chart.chart_type == 'text':
            return {"x": [], "y": [], "series": []}

        # Template charts store a pre-built JOIN query in chart_options.sample_sql.
        # Use it directly so JOINed fields (e.g. status_name) render correctly.
        chart_options = chart.chart_options or {}
        if isinstance(chart_options, str):
            try:
                chart_options = json.loads(chart_options)
            except Exception:
                chart_options = {}
        sample_sql = chart_options.get("sample_sql") if isinstance(chart_options, dict) else None
        if sample_sql and isinstance(sample_sql, str) and sample_sql.strip():
            return await self._execute_with_sample_sql(chart, sample_sql)

        chart_query = chart.chart_query or {}
        filters = chart_query.get("filters", [])
        metric_filters = chart_query.get("metricFilters", [])

        # -------------------------
        # 1. Normalize query
        # -------------------------
        x_field = chart_query.get("x") or chart_query.get("xField")
        x_grain = chart_query.get("xGrain") # date bucketing (year, month, day, etc)
        # x_field is optional now for multi-metric charts
            
        # Basic validation for field names (SQL injection protection)
        if x_field and not self._is_valid_field_name(x_field):
            raise ValueError(f"Invalid x_field name: {x_field}")

        aggregate = chart_query.get("aggregate")
        y_metric = chart_query.get("yMetric")  # Field to aggregate
        y_metrics = chart_query.get("yMetrics") # Array of {field, aggregation}
        has_y_metrics_defined = "yMetrics" in chart_query
        group_field = chart_query.get("groupField")  # Secondary grouping field
        
        # Validate additional field names
        if y_metric and not self._is_valid_field_name(y_metric):
            raise ValueError(f"Invalid yMetric field name: {y_metric}")
        if group_field and not self._is_valid_field_name(group_field):
            raise ValueError(f"Invalid groupField name: {group_field}")
        
        y_metrics_secondary = chart_query.get("yMetricsSecondary") or []
        
        for ym in (y_metrics or []):
            field = ym.get("field")
            if field and not self._is_valid_field_name(field):
                raise ValueError(f"Invalid yMetric field name: {field}")

        for ym in y_metrics_secondary:
            field = ym.get("field")
            if field and not self._is_valid_field_name(field):
                raise ValueError(f"Invalid yMetric field name: {field}")
            
        sort_by = self._normalize_sort_by(chart_query.get("sortBy"))
        sort_order = chart_query.get("sortOrder", "desc")  # Default to desc
        group_sort_by = chart_query.get("groupSortBy", "field")  # field or order
        group_order = chart_query.get("groupOrder", "desc")  # Default to desc
        limit = chart_query.get("limit")
        if limit is not None:
            try: 
                limit = int(limit)
                if limit < 1: limit = 1
            except: 
                limit = 5000
        else:
            limit = 5000

        series_limit = chart_query.get("seriesLimit")
        if series_limit is not None:
            try: series_limit = int(series_limit)
            except: series_limit = None
            
        y_metrics_list = (y_metrics or []) + y_metrics_secondary
        n_primary = len(y_metrics) if y_metrics is not None else 1
        order_clause = self._build_order_clause(sort_by, sort_order, x_field, has_y_metrics=len(y_metrics_list) > 0)

        # -------------------------
        # 3. Handle Scatter Chart
        # -------------------------
        if chart.chart_type == 'scatter':
            x_metrics = chart_query.get("xMetrics") or []
            y_metrics = chart_query.get("yMetrics") or []
            legend_field = chart_query.get("legend")

            # Fallback for old charts/migration
            if not x_metrics and chart_query.get("x"):
                x_metrics = [{"field": chart_query.get("x"), "aggregation": "none"}]
            if not y_metrics and chart_query.get("y"):
                y_metrics = [{"field": chart_query.get("y"), "aggregation": "none"}]

            # Validate field names
            for ym in x_metrics + y_metrics:
                f = ym.get("field")
                if f and not self._is_valid_field_name(f):
                    raise ValueError(f"Invalid field name: {f}")
            if legend_field and not self._is_valid_field_name(legend_field):
                raise ValueError(f"Invalid legend field name: {legend_field}")

            stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
            res = await self.db.execute(stmt)
            data_source = res.scalar_one_or_none()

            if not data_source:
                raise ValueError("Data source not found")

            # Lazily fetch schema for databases/sample_duckdb if missing
            await self._ensure_data_source_schema(data_source)

            if data_source.type == "file":
                return self._execute_scatter_file(data_source, x_metrics, y_metrics, legend_field, filters=filters, metric_filters=metric_filters, limit=limit, series_limit=series_limit)
            else:
                return await self._execute_scatter_db(data_source, x_metrics, y_metrics, legend_field, filters=filters, metric_filters=metric_filters, limit=limit, series_limit=series_limit)

        # -------------------------
        # 4. Execute Standard Charts
        # -------------------------
        stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
        res = await self.db.execute(stmt)
        data_source = res.scalar_one_or_none()

        if not data_source:
            raise ValueError("Data source not found")

        # Lazily fetch schema for databases/sample_duckdb if missing
        await self._ensure_data_source_schema(data_source)

        if data_source.type == "file":
            result = self._execute_file_source(
                data_source, x_field, aggregate, y_metric, y_metrics_list,
                has_y_metrics_defined, group_field, sort_by, sort_order,
                group_sort_by, group_order, n_primary=n_primary,
                x_grain=x_grain, filters=filters,
                metric_filters=metric_filters, limit=limit,
                series_limit=series_limit
            )
        else:
            result = await self._execute_db_source(
                data_source, x_field, aggregate, y_metric, y_metrics_list,
                has_y_metrics_defined, group_field, order_clause,
                n_primary=n_primary, x_grain=x_grain,
                filters=filters, metric_filters=metric_filters,
                limit=limit,
                series_limit=series_limit
            )

        # Stat charts must return {"value": N}. Normalize if the execution path
        # returned the generic {"x": [...], "y": [...]} shape instead.
        if chart.chart_type == "stat" and "value" not in result:
            y_data = result.get("y") or []
            series = result.get("series") or []
            val = y_data[0] if y_data else (series[0]["data"][0] if series and series[0].get("data") else None)
            if val is not None:
                result = {"value": val}

        return result

    # =========================================================
    # SCATTER EXECUTION
    # =========================================================
    async def _execute_scatter_db(self, data_source: DataSource, x_metrics: List[Dict], y_metrics: List[Dict], legend_field: Optional[str] = None, filters: List[Dict] = [], metric_filters: List[Dict] = [], limit: int = 5000, series_limit: Optional[int] = None) -> Dict[str, Any]:
        if not x_metrics or not y_metrics: return {"series": []}
        
        xm, ym = x_metrics[0], y_metrics[0]
        x_field, y_field = xm.get("field"), ym.get("field")
        x_agg, y_agg = xm.get("aggregation", "none"), ym.get("aggregation", "none")
        if not x_field or not y_field: return {"series": []}

        # Determine grouping and aggregation requirements
        is_x_agg, is_y_agg = x_agg != 'none', y_agg != 'none'
        is_fully_raw = not is_x_agg and not is_y_agg
        
        select_fields, group_by = [], []
        if legend_field:
            select_fields.append(f"{legend_field} as legend")
            if not is_fully_raw: group_by.append(legend_field)

        # X column/agg
        if is_x_agg:
            select_fields.append(f"{self._get_aggregate_func(x_agg, x_field)} as x")
        else:
            select_fields.append(f"{x_field} as x")
            if not is_fully_raw: group_by.append(x_field)

        # Y column/agg
        if is_y_agg:
            select_fields.append(f"{self._get_aggregate_func(y_agg, y_field)} as y")
        else:
            select_fields.append(f"{y_field} as y")
            if not is_fully_raw: group_by.append(y_field)

        schema_info = data_source.schema or {}
        table, schema = self._resolve_table_and_schema(schema_info)
        
        if not table:
            raise ValueError("Table name missing in data source schema")

        table_full_name = f"{schema}.{table}"
        where_clause = self._apply_filters_db(filters)
        having_clause = self._apply_metric_filters_db(metric_filters)
        group_by_clause = f"GROUP BY {', '.join(set(group_by))}" if group_by else ""
        sql = f"SELECT {', '.join(select_fields)} FROM {table_full_name} {where_clause} {group_by_clause} {having_clause} LIMIT {limit}"
        
        # USE MultiEngineQueryService for external databases
        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": schema_info,
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None
        }
        
        multi = MultiEngineQueryService()
        exec_res = await multi.execute_query(sql, ds_dict)
        
        if not exec_res.get("success"):
            raise Exception(f"Query execution failed: {exec_res.get('error')}")
            
        rows = exec_res.get("data", [])
        
        # Apply series limit if requested
        if legend_field and series_limit:
            series_sums = {}
            for r in rows:
                leg = r.get("legend")
                y = r.get("y", 0)
                try: y = float(y)
                except: y = 0
                series_sums[leg] = series_sums.get(leg, 0) + abs(y)
            
            top_legends = sorted(series_sums.keys(), key=lambda k: series_sums[k], reverse=True)[:series_limit]
            rows = [r for r in rows if r.get("legend") in top_legends]

        # Build efficient payload
        data = []
        for row in rows:
            # MultiEngineQueryService returns list of DICTs
            data.append([row.get("x"), row.get("y"), row.get("legend")])

        y_label = f"{y_agg.capitalize()} of {y_field}" if is_y_agg else y_field
        return {
            "series": [{"name": y_label, "data": data}],
            "xAxisLabel": f"{x_agg.capitalize()} of {x_field}" if is_x_agg else x_field,
            "yAxisLabel": y_label
        }

    def _execute_scatter_file(self, data_source: DataSource, x_metrics: List[Dict], y_metrics: List[Dict], legend_field: Optional[str] = None, filters: List[Dict] = [], metric_filters: List[Dict] = [], limit: int = 5000, series_limit: Optional[int] = None) -> Dict[str, Any]:
        if not data_source.sample_data or not x_metrics or not y_metrics: return {"series": []}
        
        xm, ym = x_metrics[0], y_metrics[0]
        x_field, y_field = xm.get("field"), ym.get("field")
        x_agg, y_agg = xm.get("aggregation", "none"), ym.get("aggregation", "none")
        
        import pandas as pd
        df = pd.DataFrame(json.loads(data_source.sample_data) if isinstance(data_source.sample_data, str) else data_source.sample_data)
        
        # Apply filters
        df = self._apply_filters_pandas(df, filters)
        
        # Clean numeric data before aggregation for scatter
        for m in x_metrics + y_metrics:
            f = m.get("field")
            if f and f in df.columns:
                df[f] = pd.to_numeric(df[f], errors='coerce').fillna(0)

        is_x_agg, is_y_agg = x_agg != 'none', y_agg != 'none'
        is_fully_raw = not is_x_agg and not is_y_agg
        
        # Clean numeric data
        for f in [x_field, y_field]: df[f] = pd.to_numeric(df[f], errors='coerce').fillna(0)

        if is_fully_raw:
            final_df = df
            # Map raw columns to standardized names for the data loop
            final_df = final_df.assign(x=final_df[x_field], y=final_df[y_field])
        else:
            agg_map = {'sum':'sum','avg':'mean','min':'min','max':'max','count':'count','distinct_count':'nunique','none':'first'}
            group_cols = list(set([legend_field] if legend_field and legend_field in df.columns else []))
            if not is_x_agg: group_cols.append(x_field)
            if not is_y_agg: group_cols.append(y_field)
            group_cols = list(set(group_cols))
            
            if group_cols:
                final_df = df.groupby(group_cols).agg(
                    x=pd.NamedAgg(column=x_field, aggfunc=agg_map.get(x_agg, 'first')),
                    y=pd.NamedAgg(column=y_field, aggfunc=agg_map.get(y_agg, 'first'))
                ).reset_index()
            else:
                # Global aggregation (Scenario 3 with no legend)
                # Compute aggregates and force into a DataFrame with consistent columns
                x_val = df[x_field].agg(agg_map.get(x_agg, 'sum'))
                y_val = df[y_field].agg(agg_map.get(y_agg, 'sum'))
                final_df = pd.DataFrame([{'x': x_val, 'y': y_val}])

        # Apply metric filters (HAVING)
        # In scatter, metrics are explicitly mapped to x and y aliases
        output_metrics_scatter = [
            {"alias": "x", "name": "X", "field": x_field, "aggregation": x_agg},
            {"alias": "y", "name": "Y", "field": y_field, "aggregation": y_agg}
        ]
        final_df = self._apply_metric_filters_pandas(final_df, metric_filters, output_metrics_scatter)

        # Apply comprehensive sorting
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)
        
        if sort_by == "x" and "x" in final_df.columns:
            final_df = final_df.sort_values(by="x", ascending=(sort_order == "asc"))
        elif sort_by == "y" and "y" in final_df.columns:
            final_df = final_df.sort_values(by="y", ascending=(sort_order == "asc"))

        # Apply series limit if requested
        if legend_field and series_limit and legend_field in final_df.columns:
            top_series = final_df.groupby(legend_field)['y'].sum().abs().sort_values(ascending=False).head(series_limit).index
            final_df = final_df[final_df[legend_field].isin(top_series)]

        # Protect frontend rendering performance with cap
        final_df = final_df.head(limit)

        data = []
        has_legend_col = legend_field and legend_field in final_df.columns
        for _, row in final_df.iterrows():
            # Use .get() or direct access after ensuring we have a DataFrame
            data.append([row['x'], row['y'], row[legend_field] if has_legend_col else None])

        y_label = f"{y_agg.capitalize()} of {y_field}" if is_y_agg else y_field
        return {
            "series": [{"name": y_label, "data": data}],
            "xAxisLabel": f"{x_agg.capitalize()} of {x_field}" if is_x_agg else x_field,
            "yAxisLabel": y_label
        }

    # =========================================================
    # SAMPLE SQL EXECUTION (template charts with JOINs)
    # =========================================================
    async def _execute_with_sample_sql(self, chart: Chart, sample_sql: str) -> Dict[str, Any]:
        stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
        res = await self.db.execute(stmt)
        data_source = res.scalar_one_or_none()
        if not data_source:
            raise ValueError("Data source not found")

        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": data_source.schema or {},
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None,
        }

        multi = MultiEngineQueryService()
        exec_res = await multi.execute_query(sample_sql, ds_dict)
        if not exec_res.get("success"):
            raise Exception(f"Query execution failed: {exec_res.get('error')}")

        rows = exec_res.get("data", [])
        if not rows:
            return {"x": [], "y": [], "series": []}

        first_row = rows[0]
        if "value" in first_row:
            return {"value": first_row["value"]}

        x_vals = [row.get("x") for row in rows]
        y_vals = [row.get("y") for row in rows]
        return {
            "x": x_vals,
            "y": y_vals,
            "series": [{"name": "Value", "data": y_vals}],
        }

    # =========================================================
    # DATABASE EXECUTION
    # =========================================================
    async def _execute_db_source(
        self, data_source: DataSource, x_field: Optional[str], aggregate: Optional[str], 
        y_metric: Optional[str], y_metrics: List[Dict],
        has_y_metrics_defined: bool,
        group_field: Optional[str], order_clause: str,
        n_primary: int = 1,
        x_grain: Optional[str] = None,
        filters: List[Dict] = [],
        metric_filters: List[Dict] = [],
        limit: int = 5000,
        series_limit: Optional[int] = None
    ) -> Dict[str, Any]:
        schema_info = data_source.schema or {}
        table, schema = self._resolve_table_and_schema(schema_info)

        if not table:
            raise ValueError("Table name missing in data source schema")

        table_name = f"{schema}.{table}"
        
        # USE MultiEngineQueryService for external databases
        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": schema_info,
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None
        }
        multi = MultiEngineQueryService()

        # If we have multiple y_metrics and no x_field, we calculate them as standalone values
        if not x_field and y_metrics:
            select_fields = []
            for i, ym in enumerate(y_metrics):
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                agg_func = self._get_aggregate_func(agg_type, field)
                select_fields.append(f"{agg_func} AS val_{i}")
            
            where_clause = self._apply_filters_db(filters)
            having_clause = self._apply_metric_filters_db(metric_filters)
            sql = f"SELECT {', '.join(select_fields)} FROM {table_name} {where_clause} {having_clause}"
            exec_res = await multi.execute_query(sql, ds_dict)
            if not exec_res.get("success"):
                raise Exception(f"Query execution failed: {exec_res.get('error')}")
            
            rows = exec_res.get("data", [])
            row = rows[0] if rows else {}
            
            # For Pie chart with multiple metrics but no x: 
            # x values are the metric names, y values are the results
            labels = []
            values = []
            for i, ym in enumerate(y_metrics):
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                label = f"{agg_type.capitalize()} of {field}" if field else "Count"
                labels.append(label)
                values.append(row.get(f"val_{i}", 0))
            
            return {"x": labels, "y": values}

        # Standard grouping logic
        agg_func = self._get_aggregate_func(aggregate, y_metric)
        
        # Override with first y_metric if available for single-metric view
        if y_metrics:
            first_ym = y_metrics[0]
            agg_func = self._get_aggregate_func(first_ym.get("aggregation", "count"), first_ym.get("field"))

        # Build GROUP BY clause
        group_by_fields = []
        if x_field:
            if x_grain:
                db_type = data_source.db_type or "postgres"
                transformed_x = self._get_date_trunc(x_field, x_grain, db_type)
                group_by_fields.append(transformed_x)
            else:
                group_by_fields.append(x_field)
        if group_field and group_field != x_field:
            group_by_fields.append(group_field)
        
        group_by_clause = f"GROUP BY {', '.join(group_by_fields)}" if group_by_fields else ""

        # Build SELECT clause
        select_fields = []
        if x_field:
            if x_grain:
                db_type = data_source.db_type or "postgres"
                transformed_x = self._get_date_trunc(x_field, x_grain, db_type)
                select_fields.append(f"{transformed_x} AS x")
            else:
                select_fields.append(f"{x_field} AS x")
        else:
            select_fields.append("'Total' AS x")
            
        if group_field and group_field != x_field:
            select_fields.append(f"{group_field} AS group_field")
            
        # Support multiple metrics
        metric_aliases = []
        if y_metrics:
            for i, ym in enumerate(y_metrics):
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                agg_func = self._get_aggregate_func(agg_type, field)
                alias = f"y_{i}"
                select_fields.append(f"{agg_func} AS {alias}")
                metric_aliases.append({
                    "alias": alias,
                    "name": field if field else agg_type.capitalize()
                })
        elif has_y_metrics_defined:
            # yMetrics explicitly provided but empty - return 0s so we see labels but no values
            select_fields.append("0 AS y")
            metric_aliases.append({"alias": "y", "name": "Value"})
        else:
            # Fallback for old charts / simple aggregate mode
            agg_func = self._get_aggregate_func(aggregate or "count", y_metric)
            select_fields.append(f"{agg_func} AS y")
            metric_aliases.append({"alias": "y", "name": "Value"})
        
        select_clause = ", ".join(select_fields)
        where_clause = self._apply_filters_db(filters)
        having_clause = self._apply_metric_filters_db(metric_filters)

        sql = f"SELECT {select_clause} FROM {table_name} {where_clause} {group_by_clause} {having_clause} {order_clause} LIMIT {limit}"


        exec_res = await multi.execute_query(sql, ds_dict)
        if not exec_res.get("success"):
            raise Exception(f"Query execution failed: {exec_res.get('error')}")
            
        rows = exec_res.get("data", [])

        result = {
            "x": [row.get("x") for row in rows],
        }

        all_series = [
            {"name": m["name"], "data": [row.get(m["alias"]) for row in rows]}
            for m in metric_aliases
        ]

        # Use n_primary to split into series and secondarySeries
        result["series"] = all_series[:n_primary]
        result["secondarySeries"] = all_series[n_primary:]

        # Provide x, y, y2 for simple cases or backward compatibility
        if result["series"]:
            result["y"] = result["series"][0]["data"]
        
        if result["secondarySeries"]:
            result["y2"] = result["secondarySeries"][0]["data"]

        if group_field and group_field != x_field:
            result["group_field"] = [row.get("group_field") for row in rows]

        return result

    # =========================================================
    # FILE (PANDAS) EXECUTION
    # =========================================================
    def _execute_file_source(
        self, data_source: DataSource, x_field: Optional[str], aggregate: Optional[str], 
        y_metric: Optional[str], y_metrics: List[Dict],
        has_y_metrics_defined: bool,
        group_field: Optional[str], sort_by: str, sort_order: str, 
        group_sort_by: str, group_order: str,
        n_primary: int = 1,
        x_grain: Optional[str] = None,
        filters: List[Dict] = [],
        metric_filters: List[Dict] = [],
        limit: int = 5000,
        series_limit: Optional[int] = None
    ) -> Dict[str, Any]:
        if not data_source.sample_data:
            raise ValueError("No sample data available")

        import pandas as pd

        data = (
            json.loads(data_source.sample_data)
            if isinstance(data_source.sample_data, str)
            else data_source.sample_data
        )
        df = pd.DataFrame(data)

        # Apply filters
        df = self._apply_filters_pandas(df, filters)

        if x_field and x_field not in df.columns:
            raise ValueError(f"Field {x_field} not found in file data")

        # Apply x_grain (date bucketing) if requested
        if x_field and x_grain:
            try:
                # Try to convert to datetime
                df[x_field] = pd.to_datetime(df[x_field], errors='coerce')
                # Drop rows where datetime conversion failed if they existed
                df = df.dropna(subset=[x_field])
                
                # Apply grain
                if x_grain == 'year':
                    df[x_field] = df[x_field].dt.to_period('Y').dt.to_timestamp()
                elif x_grain == 'quarter':
                    df[x_field] = df[x_field].dt.to_period('Q').dt.to_timestamp()
                elif x_grain == 'month':
                    df[x_field] = df[x_field].dt.to_period('M').dt.to_timestamp()
                elif x_grain == 'week':
                    df[x_field] = df[x_field].dt.to_period('W').dt.to_timestamp()
                elif x_grain == 'day':
                    df[x_field] = df[x_field].dt.to_period('D').dt.to_timestamp()
                elif x_grain == 'hour':
                    df[x_field] = df[x_field].dt.to_period('H').dt.to_timestamp()
            except Exception as e:
                # Fallback to raw if date conversion fails
                pass

        # Multi-metric no-x case
        if not x_field and y_metrics:
            labels = []
            values = []
            for ym in y_metrics:
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                
                val = 0
                if agg_type == "count":
                    val = len(df)
                elif agg_type == "distinct_count":
                    val = df[field].nunique() if field in df.columns else 0
                elif field in df.columns:
                    col_data = pd.to_numeric(df[field], errors='coerce').dropna()
                    if not col_data.empty:
                        if agg_type == "sum": val = col_data.sum()
                        elif agg_type == "avg": val = col_data.mean()
                        elif agg_type == "max": val = col_data.max()
                        elif agg_type == "min": val = col_data.min()
                
                label = f"{agg_type.capitalize()} of {field}" if field else "Count"
                labels.append(label)
                values.append(val)
            return {"x": labels, "y": values}
        
        # Explicit empty metrics case for no-x
        if not x_field and has_y_metrics_defined and not y_metrics:
            return {"x": ["Total"], "y": [0]}

        # Determine grouping fields
        group_by_fields = []
        if x_field:
            group_by_fields.append(x_field)
        if group_field and group_field != x_field:
            group_by_fields.append(group_field)

        # Determine aggregator
        agg_to_use = aggregate
        metric_to_use = y_metric
        if y_metrics:
            agg_to_use = y_metrics[0].get("aggregation", "count")
            metric_to_use = y_metrics[0].get("field")

        # Apply grouping if x_field exists
        output_metrics = []
        if x_field:
            if not y_metrics:
                if has_y_metrics_defined:
                    # Explicitly no metrics, return 0s
                    grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    grouped["y"] = 0
                else:
                    # Single metric fallback (old style)
                    metric_to_use = y_metric
                    agg_to_use = aggregate or "count"
                    
                    if agg_to_use == "count":
                        if metric_to_use and metric_to_use in df.columns:
                            grouped = df.groupby(group_by_fields)[metric_to_use].count().reset_index(name="y")
                        else:
                            grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    elif agg_to_use == "distinct_count" and metric_to_use:
                        grouped = df.groupby(group_by_fields)[metric_to_use].nunique().reset_index(name="y")
                    elif metric_to_use and metric_to_use in df.columns:
                        df[metric_to_use] = pd.to_numeric(df[metric_to_use], errors='coerce')
                        df_clean = df.dropna(subset=[metric_to_use])
                        if agg_to_use == "sum": grouped = df_clean.groupby(group_by_fields)[metric_to_use].sum().reset_index(name="y")
                        elif agg_to_use == "avg": grouped = df_clean.groupby(group_by_fields)[metric_to_use].mean().reset_index(name="y")
                        elif agg_to_use == "max": grouped = df_clean.groupby(group_by_fields)[metric_to_use].max().reset_index(name="y")
                        elif agg_to_use == "min": grouped = df_clean.groupby(group_by_fields)[metric_to_use].min().reset_index(name="y")
                        else: grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    else:
                        grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                output_metrics.append({
                    "alias": "y", 
                    "name": y_metric if y_metric else (aggregate.capitalize() if aggregate else "Count"),
                    "field": y_metric,
                    "aggregation": aggregate or "count"
                })
            else:
                # Multiple metrics
                agg_map = {}
                numeric_fields_to_cast = set()

                for i, ym in enumerate(y_metrics):
                    agg_type = ym.get("aggregation", "count")
                    field = ym.get("field")
                    alias = f"y_{i}"
                    
                    if agg_type == "count":
                        # If field is provided, count non-nulls. Otherwise count all rows (size).
                        agg_map[alias] = (field, "count") if field and field in df.columns else (df.columns[0], "size")
                    elif agg_type == "distinct_count":
                        agg_map[alias] = (field, "nunique")
                    else:
                        # Normalize common aggregations for Pandas
                        pandas_agg = agg_type
                        if agg_type == "avg":
                            pandas_agg = "mean"
                        
                        agg_map[alias] = (field, pandas_agg)
                        
                        # Collect fields that need numeric casting
                        if field and field in df.columns and pandas_agg in ("sum", "mean", "min", "max"):
                            numeric_fields_to_cast.add(field)
                    
                    output_metrics.append({
                        "alias": alias,
                        "name": field if field else agg_type.capitalize(),
                        "field": field,
                        "aggregation": agg_type
                    })

                # Cast required fields to numeric to avoid "no numeric types" errors in Pandas
                for field in numeric_fields_to_cast:
                    df[field] = pd.to_numeric(df[field], errors='coerce')
                
                # Build aggregation dict
                agg_dict = {}
                for alias, (field, agg) in agg_map.items():
                    if agg == "size":
                        continue # size is handled separately
                    agg_dict[alias] = pd.NamedAgg(column=field, aggfunc=agg)

                if not agg_dict:
                    # Only size-based counts
                    grouped = df.groupby(group_by_fields).size().reset_index(name="y_0")
                    # If there were multiple size-based counts (weird but possible), they'd all be the same anyway
                else:
                    grouped = df.groupby(group_by_fields).agg(**agg_dict).reset_index()
                    # Add size-based counts if any
                    for alias, (field, agg) in agg_map.items():
                        if agg == "size":
                            # We need to compute size and join or assign
                            # Since it's the same grouping, we can just assign the values from a size() call
                            sizes = df.groupby(group_by_fields).size().values
                            grouped[alias] = sizes
        else:
            # Fallback for no-x if y_metrics didn't handle it (handled by early return in _execute_file_source)
            grouped = pd.DataFrame([{"x": "Total", "y": len(df)}])
            x_field = "x"
            output_metrics.append({"alias": "y", "name": "Value"})

        # Apply comprehensive sorting
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)

        # Apply series limit if grouped
        if group_field and series_limit and group_field in grouped.columns:
            # Find top N series by total value of the first metric
            metric_col = output_metrics[0]["alias"]
            if metric_col in grouped.columns:
                top_series = grouped.groupby(group_field)[metric_col].sum().abs().sort_values(ascending=False).head(series_limit).index
                grouped = grouped[grouped[group_field].isin(top_series)]
        
        # Apply metric filters
        grouped = self._apply_metric_filters_pandas(grouped, metric_filters, output_metrics)

        if sort_by == "x" and x_field in grouped.columns:
            grouped = grouped.sort_values(by=x_field, ascending=(sort_order == "asc"))
        elif sort_by == "y":
            primary_y = "y" if "y" in grouped.columns else "y_0"
            if primary_y in grouped.columns:
                grouped = grouped.sort_values(by=primary_y, ascending=(sort_order == "asc"))
            
        # Group field secondary sort
        if group_field and group_field != x_field and group_field in grouped.columns:
            if group_sort_by == "field":
                group_ascending = self._normalize_sort_order(group_order) == "asc"
                primary_sort = x_field if sort_by=="x" else ( "y" if "y" in grouped.columns else "y_0")
                if primary_sort in grouped.columns:
                    grouped = grouped.sort_values(by=[primary_sort, group_field], 
                                               ascending=[sort_order=="asc", group_ascending])

        # Prevent massive unpaginated responses
        grouped = grouped.head(limit)


        result = {
            "x": grouped[x_field].astype(str).tolist(),
        }

        all_series = [
            {"name": m["name"], "data": grouped[m["alias"]].tolist()}
            for m in output_metrics
        ]

        # Use n_primary to split into series and secondarySeries
        result["series"] = all_series[:n_primary]
        result["secondarySeries"] = all_series[n_primary:]

        # Provide x, y, y2 for simple cases or backward compatibility
        if result["series"]:
            result["y"] = result["series"][0]["data"]
        
        if result["secondarySeries"]:
            result["y2"] = result["secondarySeries"][0]["data"]

        if group_field and group_field != x_field and group_field in grouped.columns:
            result["group_field"] = grouped[group_field].astype(str).tolist()

        return result

    # =========================================================
    # HELPERS
    # =========================================================
    def _is_valid_field_name(self, field_name: str) -> bool:
        if not field_name or not isinstance(field_name, str): return False
        import re
        return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_.-]*$', field_name))
    
    def _build_order_clause(self, sort_by: str, sort_order: str, x_field: Optional[str], has_y_metrics: bool = False) -> str:
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)
        if sort_by == "x" and x_field:
            return f"ORDER BY {x_field} {'ASC' if sort_order == 'asc' else 'DESC'}"
        if sort_by == "y":
            # If multiple metrics, sort by the first one y_0, else y
            alias = "y_0" if has_y_metrics else "y"
            return f"ORDER BY {alias} {'DESC' if sort_order == 'desc' else 'ASC'}"
        return ""

    def _normalize_sort_by(self, sort_by: Optional[str]) -> str:
        if sort_by in (None, "", "order", "record_order"): return "record_order"
        return sort_by if sort_by in ("x", "y") else "record_order"
    
    def _normalize_sort_order(self, sort_order: Optional[str]) -> str:
        if not sort_order: return "desc"
        return "asc" if sort_order.lower() in ("asc", "ascending") else "desc"
    
    def _apply_filters_db(self, filters: List[Dict]) -> str:
        if not filters:
            return ""
        
        clauses = []
        for f in filters:
            field = f.get("field")
            operator = f.get("operator", "=")
            value = f.get("value")
            f_type = f.get("type", "simple")

            if not field or not self._is_valid_field_name(field):
                continue
            
            if f_type == 'sql' and f.get('sql'):
                clauses.append(f"({f.get('sql')})")
                continue

            # Basic SQL injection protection for operator
            valid_operators = ["=", "!=", ">", ">=", "<", "<=", "like", "like_case", "in", "not_in", "is_null", "is_not_null"]
            if operator not in valid_operators:
                continue
            
            # Format value
            if operator == "is_null":
                clauses.append(f"{field} IS NULL")
            elif operator == "is_not_null":
                clauses.append(f"{field} IS NOT NULL")
            elif operator in ("in", "not_in"):
                # Expecting a comma-separated string or list
                if isinstance(value, str):
                    vals = [v.strip() for v in value.split(",")]
                elif isinstance(value, list):
                    vals = value
                else:
                    vals = [value]
                
                formatted_vals = []
                for v in vals:
                    if isinstance(v, (int, float)):
                        formatted_vals.append(str(v))
                    else:
                        safe_v = str(v).replace("'", "''")
                        formatted_vals.append(f"'{safe_v}'")
                
                op_sql = "IN" if operator == "in" else "NOT IN"
                clauses.append(f"{field} {op_sql} ({', '.join(formatted_vals)})")
            elif operator in ("like", "like_case"):
                val_str = str(value).replace("'", "''")
                clauses.append(f"{field} {'ILIKE' if operator == 'like' else 'LIKE'} '%{val_str}%'")
            else:
                if isinstance(value, (int, float)):
                    clauses.append(f"{field} {operator} {value}")
                else:
                    val_str = str(value).replace("'", "''")
                    clauses.append(f"{field} {operator} '{val_str}'")
        
        if not clauses:
            return ""
        
        return "WHERE " + " AND ".join(clauses)

    def _apply_filters_pandas(self, df, filters: List[Dict]):
        if not filters:
            return df
        
        import pandas as pd
        
        for f in filters:
            field = f.get("field")
            operator = f.get("operator", "=")
            value = f.get("value")
            
            if not field or field not in df.columns:
                continue
                
            # Handle is_null/is_not_null
            if operator == "is_null":
                df = df[df[field].isna()]
            elif operator == "is_not_null":
                df = df[df[field].notna()]
            elif operator == "in":
                vals = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
                df = df[df[field].astype(str).isin([str(v) for v in vals])]
            elif operator == "not_in":
                vals = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
                df = df[~df[field].astype(str).isin([str(v) for v in vals])]
            elif operator in ("like", "like_case"):
                case = operator == "like_case"
                df = df[df[field].astype(str).str.contains(str(value), case=case, na=False)]
            else:
                # Comparison operators
                try:
                    # Try to compare as numbers if possible
                    if operator == "=": df = df[df[field].astype(str) == str(value)]
                    elif operator == "!=": df = df[df[field].astype(str) != str(value)]
                    elif operator == ">": df = df[pd.to_numeric(df[field], errors='coerce') > float(value)]
                    elif operator == ">=": df = df[pd.to_numeric(df[field], errors='coerce') >= float(value)]
                    elif operator == "<": df = df[pd.to_numeric(df[field], errors='coerce') < float(value)]
                    elif operator == "<=": df = df[pd.to_numeric(df[field], errors='coerce') <= float(value)]
                except:
                    # Fallback to string comparison
                    if operator == "=": df = df[df[field].astype(str) == str(value)]
                    elif operator == "!=": df = df[df[field].astype(str) != str(value)]
        
        return df

        # If no y_metric but agg_type is a function that needs it, 
        # it might be that agg_type itself is "count" or we fallback
        return "COUNT(*)"

    def _get_aggregate_func(self, aggregate: Any, y_metric: Optional[str] = None) -> str:
        """Generate SQL aggregate function based on aggregate type and metric field."""
        # Normalize aggregate type if it's a boolean or string "true"/"false"
        agg_type = aggregate
        if agg_type is True or agg_type == "true":
            # If it's just a toggle, we look at y_metric. 
            # If y_metric is one of the valid functions, we use it.
            if y_metric in ["count", "sum", "avg", "max", "min", "distinct_count"]:
                agg_type = y_metric
                y_metric = None # It was the function, not the field
            else:
                agg_type = "count"
        elif agg_type is False or agg_type == "false":
            return "COUNT(*)" # Default fallback

        valid_aggregates = ["count", "sum", "avg", "max", "min", "distinct_count"]
        if agg_type not in valid_aggregates:
            agg_type = "count"
            
        if agg_type == "count":
            return f"COUNT({y_metric})" if y_metric else "COUNT(*)"
        if agg_type == "distinct_count":
            return f"COUNT(DISTINCT {y_metric})" if y_metric else "COUNT(*)"
            
        if y_metric and self._is_valid_field_name(y_metric):
            if agg_type == "sum": return f"SUM({y_metric})"
            if agg_type == "avg": return f"AVG({y_metric})"
            if agg_type == "max": return f"MAX({y_metric})"
            if agg_type == "min": return f"MIN({y_metric})"
            
        # If no y_metric but agg_type is a function that needs it, 
        # it might be that agg_type itself is "count" or we fallback
        return "COUNT(*)"

    def _apply_metric_filters_db(self, filters: List[Dict]) -> str:
        if not filters:
            return ""
        
        clauses = []
        for f in filters:
            field = f.get("field")
            agg_type = f.get("aggregation", "sum")
            operator = f.get("operator", "=")
            value = f.get("value")

            if not field or not self._is_valid_field_name(field):
                continue
            
            # Simple SQL injection protection for operator
            valid_operators = ["=", "!=", ">", ">=", "<", "<="]
            if operator not in valid_operators:
                continue
            
            agg_func = self._get_aggregate_func(agg_type, field)
            
            if isinstance(value, (int, float)):
                clauses.append(f"{agg_func} {operator} {value}")
            else:
                try:
                    num_val = float(value)
                    clauses.append(f"{agg_func} {operator} {num_val}")
                except:
                    continue
        
        if not clauses:
            return ""
        
        return "HAVING " + " AND ".join(clauses)

    def _apply_metric_filters_pandas(self, df, filters: List[Dict], output_metrics: List[Dict] = []):
        if not filters or df.empty:
            return df
        
        import pandas as pd
        for f in filters:
            field = f.get("field")
            agg_type = str(f.get("aggregation", "sum")).lower()
            operator = f.get("operator", "=")
            value = f.get("value")
            
            if value is None or value == "":
                continue

            # Try to identify the target column in the aggregated DataFrame
            target_col = None
            
            # 1. Match against output_metrics metadata
            if output_metrics:
                for m in output_metrics:
                    m_field = m.get("field")
                    m_agg = str(m.get("aggregation", "count")).lower()
                    if m_field == field and m_agg == agg_type:
                        target_col = m.get("alias")
                        break

            # 2. Fallback to direct field name (for scatter or simple raw charts)
            if not target_col and field in df.columns:
                target_col = field
            
            # 3. Last resort fallback
            if not target_col and "y" in df.columns:
                target_col = "y"
            
            if not target_col:
                continue

            try:
                num_val = float(value)
                col_data = pd.to_numeric(df[target_col], errors='coerce')
                if operator == "=": df = df[col_data == num_val]
                elif operator == "!=": df = df[col_data != num_val]
                elif operator == ">": df = df[col_data > num_val]
                elif operator == ">=": df = df[col_data >= num_val]
                elif operator == "<": df = df[col_data < num_val]
                elif operator == "<=": df = df[col_data <= num_val]
            except Exception as e:
                continue

        return df

    def _get_date_trunc(self, field: str, grain: str, db_type: str) -> str:
        if db_type == "postgres":
            return f"DATE_TRUNC('{grain}', {field})"
        if db_type == "mysql":
            if grain == "year": return f"DATE_FORMAT({field}, '%Y-01-01')"
            if grain == "month": return f"DATE_FORMAT({field}, '%Y-%m-01')"
            if grain == "day": return f"DATE_FORMAT({field}, '%Y-%m-%d')"
            return field
        if db_type == "sqlite":
            if grain == "year": return f"strftime('%Y-01-01', {field})"
            if grain == "month": return f"strftime('%Y-%m-01', {field})"
            if grain == "day": return f"strftime('%Y-%m-%d', {field})"
            return field
        return field



