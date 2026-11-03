# Aicser Plug-in Starter Template

Copy this folder to `server/plugins/<my_plugin>/` (or your own repository), rename `pyproject.toml.example` to `pyproject.toml`, and replace `<my_plugin>` with your plug-in identifier.

## Quick Start

1. Copy the template:
   ```bash
   cp -r server/plugins/template server/plugins/my_visual
   mv server/plugins/my_visual/pyproject.toml.example server/plugins/my_visual/pyproject.toml
   ```
2. Edit `pyproject.toml` and `aicser_plugin_my_visual/__init__.py`.
3. Install in editable mode inside the backend environment:
   ```bash
   pip install --no-deps -e server/plugins/my_visual
   ```

See [`docs/plugins/authoring-guide.md`](../../../docs/plugins/authoring-guide.md) for full details.

