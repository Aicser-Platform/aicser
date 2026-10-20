from ee.modules.semantic.validator import validate_join_graph_acyclic


def j(a, b):
    return {"from_table": a, "from_column": "id", "to_table": b, "to_column": "id"}


def test_a_single_link_or_a_tree_is_fine():
    assert validate_join_graph_acyclic([j("loans", "branches")]) == (True, [])
    assert validate_join_graph_acyclic([j("orders", "customers"), j("orders", "products"), j("customers", "regions")])[0]


def test_the_same_link_twice_or_reversed_is_not_a_loop():
    assert validate_join_graph_acyclic([j("orders", "customers"), j("customers", "orders"), j("orders", "customers")])[0]


def test_a_real_loop_is_reported():
    ok, errors = validate_join_graph_acyclic([j("a", "b"), j("b", "c"), j("c", "a")])
    assert not ok and errors == ["cycle_detected:c->a"]
