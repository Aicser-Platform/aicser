"""add_reveal_checkpoint (graph_state.py) — the permanent, accumulating
"what we actually found" list shown above the live progress card."""

from ee.modules.ai.schemas.graph_state import add_reveal_checkpoint


def test_appends_new_checkpoints_in_order():
    state = {}
    add_reveal_checkpoint(state, "query_executed", "📊", "342 rows found")
    add_reveal_checkpoint(state, "chart_built", "📈", "Bar chart selected")
    assert state["reveal_checkpoints"] == [
        {"id": "query_executed", "icon": "📊", "text": "342 rows found"},
        {"id": "chart_built", "icon": "📈", "text": "Bar chart selected"},
    ]


def test_replaces_existing_checkpoint_with_same_id_in_place():
    """A node that reruns (e.g. chart_builder_node after an error_correction
    retry) must replace its own prior reveal, not append a duplicate."""
    state = {}
    add_reveal_checkpoint(state, "chart_built", "📈", "Bar chart selected")
    add_reveal_checkpoint(state, "insights_ready", "💡", "3 insights found")
    add_reveal_checkpoint(state, "chart_built", "📈", "Line chart selected")
    assert state["reveal_checkpoints"] == [
        {"id": "chart_built", "icon": "📈", "text": "Line chart selected"},
        {"id": "insights_ready", "icon": "💡", "text": "3 insights found"},
    ]


def test_never_mutates_a_previously_read_list_reference():
    """Downstream code may hold a reference to an earlier reveal_checkpoints
    list (e.g. a merged copy in a parent state dict) — mutating list contents
    in place instead of assigning a fresh list would silently corrupt it."""
    state = {}
    add_reveal_checkpoint(state, "query_executed", "📊", "1 row found")
    snapshot = state["reveal_checkpoints"]
    held_reference = list(snapshot)
    add_reveal_checkpoint(state, "chart_built", "📈", "Bar chart selected")
    assert held_reference == [{"id": "query_executed", "icon": "📊", "text": "1 row found"}]
