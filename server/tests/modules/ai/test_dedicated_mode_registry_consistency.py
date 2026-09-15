"""Guard-rail test: every mode in _DEDICATED_PIPELINE_MODES must be honored
by ALL THREE independent routing dispatchers, not just one.

Architectural gap this closes: there is no single capability registry for
"which modes have a dedicated pipeline" — that fact is instead encoded
independently in three places that must be kept in sync by hand:
  1. goal_resolver._DEDICATED_PIPELINE_MODES (excludes these from agent_kernel)
  2. supervisor_node.py's Phase -1 (excludes these from soft skill-matching)
  3. routing_utils.fast_route_query (gives each its own fast-route branch)
  4. supervisor_routing.route_after_supervisor (dispatches by current_stage,
     with an analysis_mode fallback for when current_stage wasn't set)

This is exactly how executive_report and business_journey went missing from
(1) this session: they were correctly wired into (3) and (4) the whole
time, so routing "looked" fine on casual reading, but silently regressed
out of (1) at some point (should_use_agent_kernel's own docstring confirms
they used to be covered) with nothing to catch the drift until a live
reproduction happened to hit it. A full capability-registry rewrite
(consolidating 1-4 into one source of truth object) is a larger, separate
architectural project (see README.md / the "excellence" audit for a
discussion of why it wasn't attempted as a same-session rewrite on a live
system) — this test is the pragmatic, low-risk version: it can't stop the
lists from existing independently, but it guarantees any future drift
between them fails CI immediately instead of waiting for the next live
customer session to find it.
"""

from ee.modules.ai.kernel.goal_resolver import _DEDICATED_PIPELINE_MODES
from ee.modules.ai.utils.routing_utils import fast_route_query

# "deep" is deliberately excluded from _DEDICATED_PIPELINE_MODES — it is
# inferred from query *text* via a regex (_DEEP_FILE_ANALYSIS_RE), never a
# UI-selectable analysis_mode string, so it has no business appearing in a
# mode-name registry keyed by analysis_mode.
_NON_MODE_FAST_ROUTES = {"deep"}


def test_every_dedicated_pipeline_mode_gets_a_real_fast_route():
    """fast_route_query must never fall through to a generic/conversational
    answer for a mode goal_resolver considers dedicated-pipeline-worthy."""
    generic_agents = {"conversational_end", "nl2sql"}  # nl2sql is fine for diagnostic/predictive/etc only
    engine_modes = {"diagnostic", "predictive", "prescriptive", "animate"}

    for mode in sorted(_DEDICATED_PIPELINE_MODES):
        decision = fast_route_query("test query", analysis_mode=mode, data_source_id="ds-1")
        assert decision is not None, f"{mode}: fast_route_query returned None (no dedicated route at all)"
        primary = decision.get("primary_agent")
        if mode in engine_modes:
            # These correctly route through nl2sql with analytics_type set —
            # that's their real dedicated engine, not a generic fallback.
            assert primary == "nl2sql" and decision.get("analytics_type") == mode, (
                f"{mode}: expected nl2sql+analytics_type={mode}, got {decision}"
            )
        else:
            assert primary not in ("conversational_end",), (
                f"{mode}: fast_route_query fell through to a generic route ({decision}) "
                f"instead of a dedicated one — this mode needs its own branch."
            )


def test_dedicated_pipeline_modes_set_has_no_accidental_non_mode_entries():
    """The inverse check: nothing in the registry should be a route name
    that was never meant to be a UI-selectable analysis_mode (e.g. an
    internal stage string accidentally added instead of a mode name)."""
    assert _DEDICATED_PIPELINE_MODES.isdisjoint(_NON_MODE_FAST_ROUTES)
