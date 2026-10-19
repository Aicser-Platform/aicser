from src.modules.notebooks.parameters import apply_parameters_to_cells, resolve_parameters
from src.modules.notebooks.schemas import Cell
from src.modules.notebooks.settings_schema import NotebookParameterDef, NotebookSettings


def test_resolve_and_substitute():
    settings = NotebookSettings(
        parameters=[
            NotebookParameterDef(name="market", type="string", default="US"),
            NotebookParameterDef(name="days", type="number", default=7),
        ]
    )
    values = resolve_parameters(settings, {"market": "EU"})
    cells = [Cell(id="a", type="sql", source="SELECT * FROM t WHERE region = '{{market}}' AND n = {{days}}")]
    out = apply_parameters_to_cells(cells, values, settings.parameters)
    assert "EU" in out[0].source
    assert "7" in out[0].source
