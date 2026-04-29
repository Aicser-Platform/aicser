from src.shared.service import BaseService
from src.modules.charts.core.visualization import VisualizationGeneration
from src.modules.charts.models import ChatVisualization
from src.modules.charts.repository import ChatVisualizationRepository
from src.modules.charts.schemas import (
    ChartConfiguration,
    ChatVisualizationCreateSchema,
    ChatVisualizationResponseSchema,
    ChatVisualizationUpdateSchema,
)


class ChatVisualizationService(
    BaseService[
        ChatVisualization,
        ChatVisualizationCreateSchema,
        ChatVisualizationUpdateSchema,
        ChatVisualizationResponseSchema,
    ]
):
    def __init__(self):

        super().__init__(ChatVisualizationRepository())

    async def save(self, data: ChartConfiguration):
        try:
            _data = data.model_copy()
            viz = VisualizationGeneration(
                datasource=_data.dataSource, form_data=_data.formData
            )

            await viz.generate_echarts_config()
            await viz.save_result()

            result = await viz.get_result()

            return result
        except Exception as e:
            # Log the error or handle it appropriately
            raise Exception(f"Failed to save visualization: {str(e)}")
