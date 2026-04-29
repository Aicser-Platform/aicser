from src.shared.repository import BaseRepository
from src.modules.charts.models import ChatVisualization
from src.modules.charts.schemas import (
    ChatVisualizationCreateSchema,
    ChatVisualizationUpdateSchema,
)


class ChatVisualizationRepository(
    BaseRepository[
        ChatVisualization, ChatVisualizationCreateSchema, ChatVisualizationUpdateSchema
    ]
):
    def __init__(self):
        super().__init__(ChatVisualization)
