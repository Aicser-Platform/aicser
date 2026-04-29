from enum import Enum
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

from src.shared.schemas import BaseSchema
from pydantic import BaseModel, Field


class ChatVisualizationBaseSchema(BaseModel):
    """Base schema for chat visualization with detailed field validation"""

    title: Optional[str] = Field(None, description="Chart title", max_length=255)
    chart_type: Optional[str] = Field(
        None, description="Chart type (bar, line, pie, etc.)", max_length=100
    )
    chart_library: str = Field(
        "echarts", description="Chart library used", max_length=50
    )
    status: str = Field("pending", description="Chart status", max_length=50)
    complexity_score: int = Field(5, description="Chart complexity score", ge=1, le=10)
    data_source: Optional[str] = Field(
        None, description="Data source identifier", max_length=255
    )

    # Chat integration fields
    form_data: Optional[Dict] = Field(
        None,
        description="Chart configuration including metrics, dimensions, and visualization settings",
    )
    datasource: Optional[Dict] = Field(
        None,
        description="Data source configuration (file or database connection details)",
    )
    result: Optional[Dict] = Field(
        None, description="Generated chart configuration and rendering data"
    )
    message_id: Optional[Union[str, UUID]] = Field(
        None,
        description="Reference to the chat message that generated this visualization",
    )

    # User ownership
    user_id: Optional[int] = Field(None, description="User ID who created the chart")
    conversation_id: Optional[Union[str, UUID]] = Field(
        None, description="Conversation ID"
    )


class ChatVisualizationCreateSchema(ChatVisualizationBaseSchema):
    pass


class ChatVisualizationUpdateSchema(ChatVisualizationBaseSchema):
    pass


class ChatVisualizationResponseSchema(ChatVisualizationBaseSchema, BaseSchema):
    pass


"""
AISER Charts Configuration Module

This module defines comprehensive schemas for chart configuration and visualization settings,
specifically designed for the AISER charting system.

Key Components:
1. Chart Configuration:
    - VizType: Supports line, bar, pie, donut, and mixed charts
    - MetricType: Handles simple metrics and SQL-based calculations
    - AggregationType: Provides sum, avg, count, min, max operations
    - FilterOperator: Extensive filtering options (=, !=, >, <, like, in, etc.)

2. Data Structure:
    - Metric: Defines measurement calculations and visual properties
    - Dimension: Specifies data grouping and categorization
    - Filter: Enables data filtering and conditions
    - DataSource: Supports both file-based and SQL database sources

3. Echarts Integration:
    - Full support for ECharts configuration
    - Customizable visual properties
    - Interactive features (tooltip, zoom, toolbox)
    - Advanced styling options

Implementation follows Pydantic BaseModel for robust validation and serialization.
Designed for flexibility and extensibility in data visualization applications.
"""


class VizType(str, Enum):
    LINE = "line"
    BAR = "bar"
    PIE = "pie"
    DONUT = "donut"
    MIX = "mix"


class MixChartType(str, Enum):
    LINE = "line"
    BAR = "bar"


class AggregationType(str, Enum):
    AVG = "avg"
    COUNT = "count"
    COUNT_DISTINCT = "count_distinct"
    MAX = "max"
    MIN = "min"
    SUM = "sum"


class FilterOperator(str, Enum):
    EQUAL = "="
    NOT_EQUAL = "!="
    GREATER_THAN = ">"
    LESS_THAN = "<"
    GREATER_EQUAL = ">="
    LESS_EQUAL = "<="
    LIKE = "like"
    LIKE_INSENSITIVE = "ilike"
    IN = "in"
    NOT_IN = "not in"
    IS_NULL = "is null"
    IS_NOT_NULL = "is not null"
    REGEX = "regex"


class Metric(BaseModel):
    label: str
    column: str
    aggregation: AggregationType
    prefix: Optional[str] = None
    suffix: Optional[str] = None
    chartType: Optional[MixChartType] = None


class Dimension(BaseModel):
    label: str
    column: str


class Filter(BaseModel):
    label: str
    column: str
    operator: FilterOperator
    value: str


class FileSource(BaseModel):
    filename: str
    uuid_filename: str
    content_type: str


class DatabaseSource(BaseModel):
    id: str
    schema_name: str
    sql: str


class DataSource(BaseModel):
    file: Optional[FileSource] = None
    database: Optional[DatabaseSource] = None


class Legend(BaseModel):
    label: str
    column: str


class ChartFormData(BaseModel):
    vizType: VizType
    title: str
    metrics: List[Metric]
    dimensions: List[Dimension]
    rowLimit: Optional[int] = Field(default=0, ge=0)
    filters: Optional[List[Filter]] = None
    legend: Optional[Legend] = None


class ChartConfiguration(BaseModel):
    formData: ChartFormData
    dataSource: DataSource


"""
# Echarts Specific Configuration Classes:
The following classes define the structure for Echarts visualization properties:
- EchartsTitle: Title and subtitle configuration
- EchartsTooltip: Tooltip display settings
- EchartsLegend: Legend positioning and data
- EchartsGrid: Chart grid layout settings
- EchartsAxis: Axis configuration for x and y
- EchartsSeriesLabel: Data label settings
- EchartsSeries: Series data and styling
- EchartsVisualMap: Visual mapping settings
- EchartsToolbox: Chart tools configuration
- EchartsDataZoom: Zoom and pan controls
- EchartsDataset: Data source configuration
- EchartsConfig: Main echarts configuration container
Classes follow Pydantic BaseModel structure for data validation and serialization.
Each component is designed to be modular and reusable across different chart types.
Example:
    chart_config = ChartConfiguration(
        formData=ChartFormData(...),
        dataSource=DataSource(...)
    echarts_config = EchartsConfig(
        title=EchartsTitle(text="My Chart"),
        series=[EchartsSeries(...)]
This schema supports both basic chart configuration and advanced Echarts-specific
visualization settings, providing a flexible system for chart generation.
"""


class EchartsTitle(BaseModel):
    text: Optional[str] = Field(None, description="Main title text.")
    subtext: Optional[str] = Field(None, description="Subtitle text.")
    left: Optional[str] = Field(
        None, description="Horizontal alignment ('left', 'center', 'right')."
    )


class EchartsTooltip(BaseModel):
    trigger: Optional[str] = Field(
        None, description="Type of trigger ('item' or 'axis')."
    )
    formatter: Optional[Union[str, Any]] = Field(
        None, description="Custom formatter for tooltip content."
    )
    axisPointer: Optional[Dict[str, Any]] = Field(
        None, description="Axis pointer configuration (e.g., {'type': 'shadow'})."
    )
    backgroundColor: Optional[str] = Field(
        None, description="Background color of the tooltip."
    )
    borderWidth: Optional[int] = Field(
        None, description="Border width of the tooltip."
    )
    borderColor: Optional[str] = Field(
        None, description="Border color of the tooltip."
    )
    textStyle: Optional[Dict[str, Any]] = Field(
        None, description="Text style configuration."
    )
    padding: Optional[Union[int, List[int]]] = Field(
        None, description="Tooltip padding."
    )
    extraCssText: Optional[str] = Field(
        None, description="Extra CSS text for tooltip styling."
    )


class EchartsLegend(BaseModel):
    data: Optional[List[str]] = Field(None, description="Array of legend item names.")
    orient: Optional[str] = Field(
        None, description="Layout orientation ('horizontal', 'vertical')."
    )
    left: Optional[str] = Field(
        None, description="Horizontal alignment ('left', 'center', 'right')."
    )


class EchartsGrid(BaseModel):
    left: Optional[Union[int, str]] = Field(
        None, description="Left margin (number or percentage)."
    )
    right: Optional[Union[int, str]] = Field(
        None, description="Right margin (number or percentage)."
    )
    top: Optional[Union[int, str]] = Field(
        None, description="Top margin (number or percentage)."
    )
    bottom: Optional[Union[int, str]] = Field(
        None, description="Bottom margin (number or percentage)."
    )
    containLabel: Optional[bool] = Field(
        False, description="Whether grid should fit labels (default: False)."
    )


class EchartsAxisLabel(BaseModel):
    show: Optional[bool] = Field(None, description="Whether to show the axis label.")
    formatter: Optional[Union[str, Any]] = Field(
        None, description="Custom formatter for axis labels."
    )
    interval: Optional[Union[int, str]] = Field(
        None, description="Interval of axis labels."
    )
    rotate: Optional[int] = Field(None, description="Rotation angle of axis labels.")
    margin: Optional[int] = Field(
        None, description="Margin between axis label and axis line."
    )
    color: Optional[str] = Field(None, description="Color of axis labels.")
    fontStyle: Optional[str] = Field(
        None, description="Font style of axis labels ('normal', 'italic', 'oblique')."
    )
    fontWeight: Optional[str] = Field(
        None,
        description="Font weight of axis labels ('normal', 'bold', 'bolder', 'lighter').",
    )
    fontFamily: Optional[str] = Field(None, description="Font family of axis labels.")
    fontSize: Optional[int] = Field(None, description="Font size of axis labels.")


class EchartsAxis(BaseModel):
    type: str = Field(
        ..., description="Axis type ('category', 'value', 'time', 'log')."
    )
    data: Optional[List[Union[str, int]]] = Field(
        None, description="Array of axis labels (required for 'category')."
    )
    boundaryGap: Optional[bool] = Field(
        None, description="Gap between axis and data (default: true for category axes)."
    )
    axisLabel: Optional[EchartsAxisLabel] = Field(
        None, description="Label settings for the axis."
    )


class EchartsSeriesLabel(BaseModel):
    show: Optional[bool] = Field(
        None, description="Whether to show labels on chart elements."
    )
    formatter: Optional[Union[str, Any]] = Field(
        None, description="Custom formatter for labels."
    )
    position: Optional[str] = Field(
        None, description="Position of labels ('top', 'bottom', 'inside', etc.)."
    )


class EchartsSeriesEmphasisLabel(EchartsSeriesLabel):
    pass


class EchartsSeriesEmphasis(BaseModel):
    focus: Optional[str] = Field(
        None, description="Emphasis focus ('none', 'self', or 'series')."
    )
    itemStyle: Optional[dict] = Field(
        None, description="Style settings for the element when emphasized."
    )
    label: Optional[EchartsSeriesEmphasisLabel] = Field(
        None, description="Label settings for the element when emphasized."
    )


class EchartsSeries(BaseModel):
    type: str = Field(
        ..., description="Chart type ('bar', 'line', 'scatter', 'pie', etc.)."
    )
    name: Optional[str] = Field(
        None, description="Name of the data series (used in tooltips and legend)."
    )
    data: List[Union[float, dict]] = Field(..., description="Array of data points.")
    label: Optional[EchartsSeriesLabel] = Field(
        None, description="Configures data labels on chart elements."
    )
    emphasis: Optional[EchartsSeriesEmphasis] = Field(
        None, description="Configures emphasis settings for the element."
    )


class EchartsVisualMap(BaseModel):
    type: Optional[str] = Field(
        None, description="Visual mapping type ('continuous', 'piecewise')."
    )
    min: int = Field(..., description="Minimum value for mapping.")
    max: int = Field(..., description="Maximum value for mapping.")
    inRange: Optional[dict] = Field(
        None, description="Defines styles for values within the range (e.g., colors)."
    )


class EchartsToolboxFeature(BaseModel):
    saveAsImage: Optional[dict] = Field(
        None, description="Configuration for the 'save as image' tool."
    )
    dataZoom: Optional[dict] = Field(
        None, description="Configuration for the zoom tool."
    )


class EchartsToolbox(BaseModel):
    feature: Optional[EchartsToolboxFeature] = Field(
        None, description="Features to include in the toolbox."
    )


class EchartsDataZoom(BaseModel):
    type: Optional[str] = Field(None, description="Zoom type ('slider' or 'inside').")
    start: Optional[int] = Field(0, description="Start percentage (default: 0).")
    end: Optional[int] = Field(100, description="End percentage (default: 100).")


class EchartsDataset(BaseModel):
    source: List[List[Union[str, int]]] = Field(
        ..., description="Array of arrays or objects representing data rows."
    )


class EchartsConfig(BaseModel):
    title: Optional[EchartsTitle] = Field(
        None, description="Chart title configuration."
    )
    tooltip: Optional[EchartsTooltip] = Field(
        None, description="Tooltip configuration."
    )
    legend: Optional[EchartsLegend] = Field(None, description="Legend configuration.")
    grid: Optional[EchartsGrid] = Field(None, description="Grid configuration.")
    xAxis: Optional[EchartsAxis] = Field(None, description="X-axis configuration.")
    yAxis: Optional[EchartsAxis] = Field(None, description="Y-axis configuration.")
    series: List[EchartsSeries] = Field(
        ..., description="Array of series data and configurations."
    )
    visualMap: Optional[EchartsVisualMap] = Field(
        None, description="Visual mapping configuration."
    )
    toolbox: Optional[EchartsToolbox] = Field(
        None, description="Toolbox configuration."
    )
    dataZoom: Optional[List[EchartsDataZoom]] = Field(
        None, description="Zooming and panning configuration."
    )
    dataset: Optional[EchartsDataset] = Field(
        None, description="Dataset configuration."
    )
    color: Optional[List[str]] = Field(
        None, description="Array of colors for the chart."
    )
    backgroundColor: Optional[str] = Field(
        None, description="Background color of the chart container."
    )


# Dashboard Schemas
class DashboardBaseSchema(BaseModel):
    """Base schema for dashboard"""

    name: str = Field(..., description="Dashboard name", min_length=1, max_length=255)
    description: Optional[str] = Field(None, description="Dashboard description")
    project_id: Optional[int] = Field(None, description="Associated project ID")
    layout_config: Optional[Dict] = Field(None, description="Grid layout configuration")
    theme_config: Optional[Dict] = Field(None, description="Theme and styling")
    global_filters: Optional[Dict] = Field(
        None, description="Global filter configuration"
    )
    refresh_interval: int = Field(
        300, description="Auto-refresh interval in seconds", ge=10
    )
    is_public: bool = Field(False, description="Whether dashboard is public")
    is_template: bool = Field(False, description="Whether dashboard is a template")


class DashboardCreateSchema(DashboardBaseSchema):
    layout: Optional[str] = None
    chart_ids: Optional[List[UUID]] = None


class DashboardUpdateSchema(DashboardBaseSchema):
    name: Optional[str] = Field(
        None, description="Dashboard name", min_length=1, max_length=255
    )


class DashboardResponseSchema(DashboardBaseSchema, BaseSchema):
    id: str
    # Accept either legacy integer user ids or modern UUID/string ids during migration
    created_by: Optional[Union[int, str, UUID]] = None
    max_widgets: int = 10
    max_pages: int = 5
    created_at: str
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    is_deleted: bool = False
    last_viewed_at: Optional[str] = None


class DashboardWidgetBaseSchema(BaseModel):
    """Base schema for dashboard widget"""

    name: str = Field(..., description="Widget name", min_length=1, max_length=255)
    widget_type: str = Field(..., description="Widget type (chart, table, text, image)")
    chart_type: Optional[str] = Field(
        None, description="Chart type (bar, line, pie, etc.)"
    )
    config: Optional[Dict] = Field(None, description="Widget-specific configuration")
    data_config: Optional[Dict] = Field(
        None, description="Data source and query configuration"
    )
    style_config: Optional[Dict] = Field(None, description="Styling and appearance")
    x: int = Field(0, description="X position", ge=0)
    y: int = Field(0, description="Y position", ge=0)
    width: int = Field(4, description="Widget width", ge=1, le=12)
    height: int = Field(3, description="Widget height", ge=1, le=12)
    z_index: int = Field(0, description="Z-index for layering")
    is_visible: bool = Field(True, description="Whether widget is visible")
    is_locked: bool = Field(False, description="Whether widget is locked")
    is_resizable: bool = Field(True, description="Whether widget is resizable")
    is_draggable: bool = Field(True, description="Whether widget is draggable")


class DashboardWidgetCreateSchema(DashboardWidgetBaseSchema):
    dashboard_id: str = Field(..., description="Dashboard ID")


class DashboardWidgetUpdateSchema(DashboardWidgetBaseSchema):
    name: Optional[str] = Field(
        None, description="Widget name", min_length=1, max_length=255
    )


class DashboardWidgetResponseSchema(DashboardWidgetBaseSchema, BaseSchema):
    id: str
    dashboard_id: str
    created_at: str
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    is_deleted: bool = False


class DashboardShareBaseSchema(BaseModel):
    """Base schema for dashboard sharing"""

    permission: str = Field("view", description="Share permission (view, edit, admin)")
    expires_at: Optional[str] = Field(None, description="Expiration date")
    is_active: bool = Field(True, description="Whether share is active")


class DashboardShareCreateSchema(DashboardShareBaseSchema):
    dashboard_id: str = Field(..., description="Dashboard ID")
    shared_with: Optional[int] = Field(
        None, description="User ID to share with"
    )  # Changed to int


class DashboardShareResponseSchema(DashboardShareBaseSchema, BaseSchema):
    id: str
    dashboard_id: str
    shared_by: int  # Changed to int
    shared_with: Optional[int] = None  # Changed to int
    share_token: Optional[str] = None
    access_count: int = 0
    last_accessed_at: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    is_deleted: bool = False


class DashboardExportRequest(BaseModel):
    """Dashboard export request"""

    dashboard_id: str = Field(..., description="Dashboard ID")
    format: str = Field(..., description="Export format (png, pdf, html, excel)")
    include_data: bool = Field(True, description="Whether to include data in export")
    theme: Optional[str] = Field(None, description="Export theme")


class DashboardExportResponse(BaseModel):
    """Dashboard export response"""

    success: bool
    export_url: Optional[str] = None
    file_size: Optional[int] = None
    format: str
    message: str


class PlanLimitsResponse(BaseModel):
    """Plan limits response"""

    plan: str
    limits: Dict[str, Any]
    current_usage: Dict[str, int]
