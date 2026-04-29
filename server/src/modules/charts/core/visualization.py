import logging
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from src.modules.charts.repository import ChatVisualizationRepository
# from src.modules.files.services.factory import get_upload_service  # module removed
def get_upload_service(): return None

from src.modules.charts.schemas import (
    ChartFormData,
    ChatVisualizationResponseSchema,
    DataSource,
    EchartsAxis,
    EchartsAxisLabel,
    EchartsConfig,
    EchartsDataZoom,
    EchartsGrid,
    EchartsLegend,
    EchartsSeries,
    EchartsSeriesEmphasis,
    EchartsSeriesEmphasisLabel,
    EchartsTitle,
    EchartsToolbox,
    EchartsToolboxFeature,
    EchartsTooltip,
    Metric,
    ChatVisualizationCreateSchema,
)

logger = logging.getLogger(__name__)


class VisualizationGeneration:
    """Base class for all visualizations with common functionality"""

    DEFAULT_TOOLBOX_FEATURES = {
        "mark": {"show": True},
        "dataView": {"show": True, "readOnly": False},
        "magicType": {"show": True, "type": ["stack"]},
        "restore": {"show": True},
        "saveAsImage": {"show": True},
    }

    def __init__(
        self, form_data: ChartFormData, datasource: DataSource, message_id: str
    ):
        self.form_data = form_data.model_copy()
        self.datasource = datasource.model_copy()
        self.viz_type = form_data.vizType
        self.dimensions = form_data.dimensions.copy()
        self.metrics = form_data.metrics.copy()
        self.rowLimit = form_data.rowLimit
        self.status: Optional[str] = None
        self.errors: List[str] = []
        self.result: Optional[Dict[str, Any]] = None

        self.chart_response: Optional[ChatVisualizationResponseSchema] = None

        self.message_id = message_id

    def validate(self) -> bool:
        """Main validation method"""
        if not self._validate_datasource() or not self._validate_form_data():
            self.status = "failed"
            return False
        return True

    def _validate_datasource(self) -> bool:
        """Validate data source configuration"""
        if not self.datasource.file and not self.datasource.database:
            self.errors.append("No data source provided")
            return False
        if self.datasource.file and self.datasource.database:
            self.errors.append("Multiple data sources provided")
            return False
        return True

    def _validate_form_data(self) -> bool:
        """Validate form data configuration"""
        if not self.dimensions:
            self.errors.append("No dimensions provided")
            return False
        if not self.metrics:
            self.errors.append("No metrics provided")
            return False
        return True

    async def load_data(self) -> Optional[pd.DataFrame]:
        """Load data from files using storage service"""
        if not self.datasource.file:
            return None

        try:
            # Get upload service
            upload_service = get_upload_service()

            # Load and combine all files
            dfs = []
            if self.datasource.file:
                file = self.datasource.file
                # Get file content as bytes
                file_response = await upload_service.repository.get_by_uuid_filename(
                    file.uuid_filename
                )

                logger.info(f"Loading data from file: {file_response.uuid_filename}")

                # Convert to DataFrame based on file type
                if file.content_type == "text/csv":
                    df = pd.read_csv(file_response.file_path)
                elif (
                    file.content_type
                    == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ):
                    df = pd.read_excel(file_response.file_path)
                else:
                    logger.error(f"Unsupported file type: {file.content_type}")
                    self.errors.append(f"Unsupported file type: {file.content_type}")

                dfs.append(df)

            if not dfs:
                logger.error("No data loaded from files")
                return None

            return pd.concat(dfs, ignore_index=True)

        except Exception as e:
            self.errors.append(f"Error loading data: {str(e)}")
            return None

    # Professional color palette for interactive charts
    CHART_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4']

    def transform_df_to_echarts(self, df: pd.DataFrame) -> EchartsConfig:
        """Transform DataFrame to ECharts configuration with full interactivity"""
        df = self._apply_filters(df)
        df = self._limit_rows(df)
        dimension_values, legend_values = self._get_axis_values(df)
        series = self._create_series(df, dimension_values, legend_values)
        
        row_count = len(dimension_values)
        
        # Create dataZoom for large datasets
        data_zoom = None
        if row_count > 15:
            data_zoom = [
                EchartsDataZoom(type="inside", start=0, end=100),
                EchartsDataZoom(type="slider", start=0, end=100)
            ]
        
        # Create grid with proper spacing
        grid = EchartsGrid(
            top=60,
            bottom=80 if row_count > 15 else 60,
            left="8%",
            right="8%",
            containLabel=True
        )

        result = EchartsConfig(
            title=EchartsTitle(text=self.form_data.title),
            color=self.CHART_COLORS,
            tooltip=self._create_tooltip(),
            toolbox=self._create_toolbox(),
            grid=grid,
            xAxis=self._create_x_axis(dimension_values),
            yAxis=self._create_y_axis(),
            series=series,
            legend=EchartsLegend(data=[s.name for s in series]),
            dataZoom=data_zoom,
        )

        self.result = result.dict()

        return result

    async def generate_echarts_config(self) -> Optional[EchartsConfig]:
        """Generate ECharts configuration"""
        try:
            df = await self.load_data()
            if df is None or not self.validate():
                return None

            echarts_config = self.transform_df_to_echarts(df)
            return echarts_config
        except Exception as e:
            logger.error(f"Error generating ECharts config: {str(e)}")
            self.errors.append(f"Error generating chart: {str(e)}")
            return None

    async def save_result(self) -> Optional[ChatVisualizationResponseSchema]:
        """Save visualization result to database"""
        try:
            if self.result is None:
                raise ValueError("No result to save")

            repository = ChatVisualizationRepository()

            # Save result to database
            visualization = ChatVisualizationCreateSchema(
                title=self.form_data.title,
                form_data=self.form_data.dict(),
                result=self.result,
                datasource=self.datasource.dict(),
                message_id=str(self.message_id),
            )

            result = await repository.create(visualization)

            self.chart_response = ChatVisualizationResponseSchema.model_validate(
                result.__dict__
            )

            return self.chart_response

        except Exception as e:
            logger.error(f"Error saving visualization result: {str(e)}")
            self.errors.append(f"Error saving visualization: {str(e)}")
            return None

    async def get_result(self) -> Optional[Dict[str, Any]]:
        """Get visualization result"""
        if self.result is None:
            await self.generate_echarts_config()

        return self.result

    async def get_chart_response(self) -> Optional[ChatVisualizationResponseSchema]:
        """Get chart response"""
        if self.chart_response is None:
            await self.save_result()

        return self.chart_response

    def _apply_filters(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply filters to DataFrame"""
        for filter in self.form_data.filters:
            df = df[df[filter.column] == filter.value]
        return df

    def _get_axis_values(self, df: pd.DataFrame) -> Tuple[List[str], List[str]]:
        """Get axis and legend values from dataframe"""
        # Use first dimension as x-axis
        if not self.form_data.dimensions:
            raise ValueError("At least one dimension is required for visualization")

        dimension_column = self.form_data.dimensions[0].column
        if dimension_column not in df.columns:
            raise KeyError(
                f"Dimension column '{dimension_column}' not found in dataframe"
            )

        dimension_values = sorted(
            [x for x in df[dimension_column].unique() if pd.notna(x) and str(x).strip()]
        )

        # Get legend values if breakdowns exist
        legend_values = []
        if self.form_data.legend:
            legend_values = df[self.form_data.legend.column].unique().tolist()
            legend_values = [str(x) for x in legend_values if pd.notna(x)]

        return dimension_values, legend_values

    def _create_series(
        self, df: pd.DataFrame, dimension_values: List[str], legend_values: List[str]
    ) -> List[EchartsSeries]:
        """Create series data for chart"""
        series = []
        for metric in self.metrics:
            if legend_values:
                series.extend(
                    self._create_legend_series(
                        df, metric, dimension_values, legend_values
                    )
                )
            else:
                series.append(self._create_single_series(df, metric, dimension_values))
        return series

    def _create_legend_series(
        self,
        df: pd.DataFrame,
        metric: Metric,
        dimension_values: List[str],
        legend_values: List[str],
    ) -> List[EchartsSeries]:
        """Create series data with legend"""
        return [
            EchartsSeries(
                type=self.viz_type.value.lower(),
                name=str(legend_val),
                data=self._get_series_data(
                    df[df[self.form_data.legend.column] == legend_val],
                    metric,
                    dimension_values,
                ),
                emphasis=self._create_series_emphasis(metric),
            )
            for legend_val in legend_values
        ]

    def _create_single_series(
        self, df: pd.DataFrame, metric: Metric, dimension_values: List[str]
    ) -> EchartsSeries:
        """Create single series data"""
        return EchartsSeries(
            type=self.viz_type.value.lower(),
            name=metric.label,
            data=self._get_series_data(df, metric, dimension_values),
            emphasis=self._create_series_emphasis(metric),
        )

    def _get_series_data(
        self, df: pd.DataFrame, metric: Metric, dimension_values: List[str]
    ) -> List[float]:
        """Get data points for a series"""
        return [
            round(
                self._null_to_zero(
                    df[df[self.form_data.dimensions[0].column] == dim_val][
                        metric.column
                    ].agg(metric.aggregation.value)
                ),
                3,
            )
            for dim_val in dimension_values
        ]

    def _create_tooltip(self) -> EchartsTooltip:
        """Create styled tooltip configuration with interactivity"""
        return EchartsTooltip(
            trigger="axis",
            axisPointer={"type": "shadow"},
            backgroundColor="rgba(255, 255, 255, 0.95)",
            borderWidth=1,
            borderColor="#e0e0e0",
            textStyle={"color": "#333", "fontSize": 12},
            extraCssText="box-shadow: 0 2px 8px rgba(0,0,0,0.15); border-radius: 4px;"
        )

    def _create_toolbox(self) -> EchartsToolbox:
        """Create toolbox configuration"""
        return EchartsToolbox(
            show=True,
            orient="vertical",
            left="right",
            top="center",
            feature=EchartsToolboxFeature(**self.DEFAULT_TOOLBOX_FEATURES),
        )

    def _create_x_axis(self, dimension_values: List[str]) -> EchartsAxis:
        """Create x-axis configuration"""
        return EchartsAxis(type="category", data=dimension_values, boundaryGap=True)

    def _create_y_axis(self) -> EchartsAxis:
        """Create y-axis configuration"""
        # Guard None for prefix/suffix on metric
        prefix = self.metrics[0].prefix or ""
        suffix = self.metrics[0].suffix or ""
        return EchartsAxis(
            type="value",
            axisLabel=EchartsAxisLabel(
                formatter=f"{prefix}{{value}}{suffix}"
            ),
        )

    def _create_series_emphasis(self, metric: Metric) -> EchartsSeriesEmphasis:
        """Create series emphasis configuration"""
        return EchartsSeriesEmphasis(
            focus="series",
            label=EchartsSeriesEmphasisLabel(
                show=True,
                position="top",
                formatter=f"{metric.prefix}{{c}}{metric.suffix}",
            ),
        )

    def _limit_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        """Limit the number of rows in the dataframe"""
        if (self.rowLimit or 0) > 0:
            return df.head(self.rowLimit)
        return df

    @staticmethod
    def _null_to_zero(value: Any) -> Any:
        """Convert None to 0"""
        return 0 if value is None else value
