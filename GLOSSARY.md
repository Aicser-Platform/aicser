# Aicser

AI-powered analytics platform: connect data, ask in natural language, build charts and dashboards. This glossary covers the extension model; add terms as other areas are clarified.

## Plug-ins

**Plug-in**:
A separately installable package that adds one or more Contributions to Aicser, described by a single manifest.
_Avoid_: Extension, add-on (add-on is a SKU layer), app, integration (as a package name)

**Contribution**:
One capability a Plug-in adds: a Visual, a Connector, an AI Skill or an MCP Connection.
_Avoid_: Feature, module

**Core**:
Visuals and Connectors built into Aicser itself rather than shipped as Plug-ins (the eight basic chart types and the Geo map; PostgreSQL, MySQL, DuckDB).
_Avoid_: Built-in plug-in, native

**Visual**:
A chart type that renders query results inside a widget.
_Avoid_: Custom visual, chart plug-in, widget (a widget is the dashboard slot a Visual renders into)

**Connector**:
A Contribution that lets Aicser connect to and query one kind of external data system.
_Avoid_: Driver, adapter, integration

**AI Skill**:
A named action the AI analyst can invoke, subject to permission, entitlement and action policy.
_Avoid_: Tool, function, agent

**MCP Connection**:
A link from an org to a remote MCP server whose tools become AI Skills for that org.
_Avoid_: MCP plug-in, MCP integration

## Plug-in availability

**Installed**:
A Plug-in whose package is present on this Aicser instance.
_Avoid_: Available, deployed

**Entitled**:
An org whose plan includes the feature a Plug-in requires; Plug-ins requiring no feature are Entitled on every plan.
_Avoid_: Licensed, allowed

**Enabled**:
A Plug-in an org admin has switched on for that org (or the Plug-in's default when the admin has not chosen).
_Avoid_: Activated, turned on

**Active**:
A Plug-in that is Installed, Entitled and Enabled for an org; only Active Plug-ins load.
_Avoid_: Live, running
