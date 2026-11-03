"""Aicser Sankey Visual Plug-in."""

manifest = {
    "id": "sankey",
    "name": "Sankey Diagram",
    "version": "1.0.0",
    "api_version": "1",
    "description": "Visualize flows and multi-stage volume relationships between nodes",
    "author": "Aicser Core Team",
    "homepage": "https://aicser.com",
    "requires_feature": None,
    "default_enabled": True,
    "assets_dir": "static",
    "contributions": [
        {
            "kind": "visual",
            "chart_type": "sankey",
            "label": "Sankey Diagram",
            "bundle": "index.js",
            "icon": "NodeIndexOutlined",
        }
    ],
}

