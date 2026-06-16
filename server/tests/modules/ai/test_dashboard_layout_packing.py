"""Dashboard geometry must always come from the row-aware packer, never raw LLM x/y/w/h.

Root cause being fixed: synthesize_widget_specs preserved each LLM widget's own
`layout` verbatim, so Gemini's geometry passed straight through — producing
oversized stat cards (h:10), horizontal gaps (a 3-wide stat leaving 9 empty
columns), and uneven y-bands. The result was the "layout so messy after create"
complaint. The deterministic _pack_grid_layout (calibrated to the 40px designer
row height: stat h:4, charts h:5) should own all geometry.
"""

from ee.modules.ai.services.dashboard_generation_service import _repack_spec_geometry
from ee.modules.ai.services.dashboard_pesd_service import synthesize_widget_specs

SCHEMA = {
    "tables": [
        {
            "name": "sales",
            "columns": [
                {"name": "order_date", "type": "date"},
                {"name": "revenue", "type": "double"},
                {"name": "region", "type": "varchar"},
            ],
        }
    ]
}


def _llm_sections_with_bad_layouts():
    """Mimic LLM-planned sections that carry oversized / gappy geometry."""
    bad = {"x": 0, "y": 0, "w": 3, "h": 10}  # stat 10 rows tall, 3 wide → gap + too tall
    return [
        {"title": "KPIs", "chart_type": "stat", "chart_query": {"tableName": "sales"},
         "layout": dict(bad), "status": "complete"},
        {"title": "Revenue Trend", "chart_type": "line", "chart_query": {"tableName": "sales"},
         "layout": {"x": 3, "y": 15, "w": 9, "h": 12}, "status": "complete"},
        {"title": "Revenue by Region", "chart_type": "bar", "chart_query": {"tableName": "sales"},
         "layout": {"x": 0, "y": 30, "w": 6, "h": 12}, "status": "complete"},
        {"title": "Revenue Share", "chart_type": "pie", "chart_query": {"tableName": "sales"},
         "layout": {"x": 6, "y": 45, "w": 6, "h": 12}, "status": "complete"},
    ]


def _rects(specs):
    return [(s["layout"]["x"], s["layout"]["y"], s["layout"]["w"], s["layout"]["h"]) for s in specs]


def _overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def test_stat_cards_are_not_oversized():
    specs, _ = synthesize_widget_specs(_llm_sections_with_bad_layouts(), SCHEMA, "sales", min_widgets=4)
    for s in specs:
        if s["chart_type"] == "stat":
            assert s["layout"]["h"] <= 4, f"stat card too tall: {s['layout']}"


def test_no_widget_overflows_grid_width():
    specs, _ = synthesize_widget_specs(_llm_sections_with_bad_layouts(), SCHEMA, "sales", min_widgets=4)
    for s in specs:
        lay = s["layout"]
        assert lay["x"] + lay["w"] <= 12, f"widget overflows 12-col grid: {lay}"


def test_no_widgets_overlap():
    specs, _ = synthesize_widget_specs(_llm_sections_with_bad_layouts(), SCHEMA, "sales", min_widgets=4)
    rects = _rects(specs)
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            assert not _overlap(rects[i], rects[j]), f"overlap: {rects[i]} & {rects[j]}"


def test_geometry_is_repacked_not_taken_from_llm():
    # The LLM gave y values like 15/30/45; the packer must compact these to a dense top.
    specs, _ = synthesize_widget_specs(_llm_sections_with_bad_layouts(), SCHEMA, "sales", min_widgets=4)
    max_y = max(s["layout"]["y"] for s in specs)
    assert max_y < 15, f"layout not repacked (raw LLM y-bands leaked through): max_y={max_y}"


# ── _repack_spec_geometry: the single geometry authority used by create_dashboard_from_plan ──

def _llm_plan_specs_with_bad_geometry():
    """Mirror the real stored dashboard: oversized stats + gaps + a details page."""
    return [
        {"name": "KPIs", "chart_type": "stat", "page_role": "overview",
         "layout": {"x": 0, "y": 0, "w": 3, "h": 10}},
        {"name": "Trend", "chart_type": "area", "page_role": "overview",
         "layout": {"x": 0, "y": 10, "w": 6, "h": 5}},
        {"name": "Detail by region", "chart_type": "line", "page_role": "overview",
         "layout": {"x": 3, "y": 15, "w": 9, "h": 10}},
        {"name": "Waterfall", "chart_type": "waterfall", "page_role": "overview",
         "layout": {"x": 0, "y": 35, "w": 6, "h": 12}},
        {"name": "Detail table", "chart_type": "table", "page_role": "details",
         "layout": {"x": 0, "y": 59, "w": 12, "h": 12}},
    ]


def test_repack_fixes_oversized_stats_and_gaps():
    specs = _llm_plan_specs_with_bad_geometry()
    _repack_spec_geometry(specs)
    # stat no longer 10 rows tall
    stat = next(s for s in specs if s["chart_type"] == "stat")
    assert stat["layout"]["h"] <= 4, stat["layout"]
    # nothing overflows the 12-col grid
    for s in specs:
        assert s["layout"]["x"] + s["layout"]["w"] <= 12, s["layout"]


def test_repack_packs_each_page_from_the_top():
    specs = _llm_plan_specs_with_bad_geometry()
    _repack_spec_geometry(specs)
    # The details page widget (was y:59) must restart near the top of its own page.
    detail = next(s for s in specs if s["page_role"] == "details")
    assert detail["layout"]["y"] == 0, detail["layout"]
    # Overview widgets must not overlap.
    ov = [s["layout"] for s in specs if s["page_role"] == "overview"]
    rects = [(l["x"], l["y"], l["w"], l["h"]) for l in ov]
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            assert not _overlap(rects[i], rects[j]), f"overlap: {rects[i]} & {rects[j]}"
