import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest


def test_compiles_a_bare_column_reference():
    from src.modules.pipeline.formula.compiler import compile_formula

    assert compile_formula("=[price]", ["price", "qty"]) == '"price"'


def test_compiles_arithmetic():
    from src.modules.pipeline.formula.compiler import compile_formula

    sql = compile_formula("=[price] * 1.1", ["price"])
    assert sql == '("price" * 1.1)'


def test_compiles_a_string_literal_as_a_bound_sql_literal():
    from src.modules.pipeline.formula.compiler import compile_formula

    sql = compile_formula('=[status] = "active"', ["status"])
    assert sql == "(\"status\" = 'active')"


def test_compiles_round():
    from src.modules.pipeline.formula.compiler import compile_formula

    sql = compile_formula("=ROUND([price] * [qty], 2)", ["price", "qty"])
    assert sql == 'ROUND(("price" * "qty"), 2)'


def test_compiles_if():
    from src.modules.pipeline.formula.compiler import compile_formula

    sql = compile_formula('=IF([qty] > 0, "in stock", "out")', ["qty"])
    assert sql == "CASE WHEN (\"qty\" > 0) THEN 'in stock' ELSE 'out' END"


def test_compiles_string_and_numeric_functions():
    from src.modules.pipeline.formula.compiler import compile_formula

    assert compile_formula("=UPPER([name])", ["name"]) == 'UPPER("name")'
    assert compile_formula("=ABS([delta])", ["delta"]) == 'ABS("delta")'
    assert compile_formula("=TRIM([name])", ["name"]) == 'TRIM("name")'


def test_quotes_a_column_name_containing_a_double_quote():
    from src.modules.pipeline.formula.compiler import compile_formula

    sql = compile_formula('=[weird"col]', ['weird"col'])
    assert sql == '"weird""col"'


def test_rejects_a_function_outside_the_allowlist():
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula

    with pytest.raises(CompileError, match="unsupported function"):
        compile_formula("=EVAL([price])", ["price"])


def test_rejects_a_column_not_in_available_columns():
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula

    with pytest.raises(CompileError, match="unknown column"):
        compile_formula("=[pricee]", ["price"])


def test_rejects_wrong_argument_count_for_round():
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula

    with pytest.raises(CompileError, match="ROUND"):
        compile_formula("=ROUND([price])", ["price"])


def test_rejects_the_p1_injection_example():
    """Same permanent regression as test_formula_parser.py's version, exercised
    through the full compile path this time -- the injection example must
    never produce SQL, whether it fails at parse or at compile. It actually
    fails at parse (a bare '(' at the top level isn't valid grammar), so the
    real exception is FormulaSyntaxError, not CompileError -- pytest.raises
    accepts either since which layer rejects it is an implementation detail,
    but it must be one of these two, not an unrelated crash."""
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula
    from src.modules.pipeline.formula.parser import FormulaSyntaxError

    with pytest.raises((CompileError, FormulaSyntaxError)):
        compile_formula("=(SELECT secret FROM other_table LIMIT 1)", ["price"])


def test_rejects_a_semicolon_disguised_as_a_column_name_reference():
    """The parser's [column] token grammar is deliberately wide (see this
    task's parser.py change above -- it accepts any character except ']',
    needed for real column names containing quotes) -- so this formula DOES
    tokenize successfully into ColumnRef(name='price; DROP TABLE users').
    It is still safely rejected, one layer later: compile_formula's
    available_columns check raises CompileError because that exact string is
    never a real column. This is the compiler's actual security boundary --
    the allowlist check plus _quote_ident's unconditional escaping, not a
    narrow tokenizer -- verified directly: compile_formula never returns SQL
    for this input, whichever of the two exception types fires."""
    from src.modules.pipeline.formula.compiler import CompileError, compile_formula
    from src.modules.pipeline.formula.parser import FormulaSyntaxError

    with pytest.raises((CompileError, FormulaSyntaxError)):
        compile_formula("=[price; DROP TABLE users]", ["price"])
