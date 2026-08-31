import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def test_parses_a_bare_column_reference():
    from src.modules.pipeline.formula.parser import ColumnRef, parse_formula

    node = parse_formula("=[price]")
    assert node == ColumnRef(name="price")


def test_parses_a_numeric_literal():
    from src.modules.pipeline.formula.parser import Literal, parse_formula

    node = parse_formula("=1.1")
    assert node == Literal(value=1.1)


def test_parses_a_string_literal():
    from src.modules.pipeline.formula.parser import Literal, parse_formula

    node = parse_formula('="active"')
    assert node == Literal(value="active")


def test_parses_arithmetic_with_column_refs():
    from src.modules.pipeline.formula.parser import (
        BinaryOp,
        ColumnRef,
        Literal,
        parse_formula,
    )

    node = parse_formula("=[price] * 1.1")
    assert node == BinaryOp(
        op="*", left=ColumnRef(name="price"), right=Literal(value=1.1)
    )


def test_parses_a_function_call():
    from src.modules.pipeline.formula.parser import (
        ColumnRef,
        FunctionCall,
        Literal,
        parse_formula,
    )

    node = parse_formula("=ROUND([price], 2)")
    assert node == FunctionCall(
        name="ROUND", args=[ColumnRef(name="price"), Literal(value=2)]
    )


def test_parses_nested_calls_and_arithmetic():
    from src.modules.pipeline.formula.parser import (
        BinaryOp,
        ColumnRef,
        FunctionCall,
        Literal,
        parse_formula,
    )

    node = parse_formula("=ROUND([price] * [qty], 2)")
    assert node == FunctionCall(
        name="ROUND",
        args=[
            BinaryOp(op="*", left=ColumnRef(name="price"), right=ColumnRef(name="qty")),
            Literal(value=2),
        ],
    )


def test_rejects_a_formula_missing_the_leading_equals_sign():
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    with pytest.raises(FormulaSyntaxError):
        parse_formula("[price] * 1.1")


def test_rejects_the_p1_injection_example_as_unparseable():
    """Permanent regression test for the exact example named in the P1 design
    spec's §11 constraint: this must fail to PARSE, not merely fail to execute."""
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    with pytest.raises(FormulaSyntaxError):
        parse_formula("=(SELECT secret FROM other_table LIMIT 1)")


def test_rejects_unbalanced_parentheses():
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    with pytest.raises(FormulaSyntaxError):
        parse_formula("=ROUND([price], 2")


def test_rejects_an_empty_formula():
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    with pytest.raises(FormulaSyntaxError):
        parse_formula("=")


def test_syntax_error_carries_a_position():
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    with pytest.raises(FormulaSyntaxError) as exc_info:
        parse_formula("=[price] $ 1")
    assert exc_info.value.position >= 0


def test_parses_a_comparison():
    from src.modules.pipeline.formula.parser import BinaryOp, ColumnRef, Literal, parse_formula

    node = parse_formula("=[qty] > 0")
    assert node == BinaryOp(op=">", left=ColumnRef(name="qty"), right=Literal(value=0))


def test_parses_a_comparison_as_a_function_argument():
    from src.modules.pipeline.formula.parser import FunctionCall, parse_formula

    node = parse_formula('=IF([qty] > 0, "in stock", "out")')
    assert node.name == "IF"
    assert len(node.args) == 3


def test_position_for_an_unclosed_paren_is_within_the_formula_length():
    from src.modules.pipeline.formula.parser import FormulaSyntaxError, parse_formula

    expr = "=ROUND([price], 2"
    with pytest.raises(FormulaSyntaxError) as exc_info:
        parse_formula(expr)
    assert 0 <= exc_info.value.position <= len(expr)
