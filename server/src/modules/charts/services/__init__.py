# Chart services module

from .mcp_echarts_service import MCPEChartsService

# Simple approach - define minimal classes here to avoid import issues
from .chart_generation_service import ChartGenerationService

# Add ChatVisualizationService for backward compatibility
class ChatVisualizationService:
    def __init__(self):
        pass
    
    async def get_all(self):
        return {"success": True, "charts": []}
    
    async def get(self, id: str):
        return {"success": True, "chart": {"id": id}}
    
    async def save(self, data):
        return {"success": True, "id": "chart_123"}

__all__ = ['ChartGenerationService', 'MCPEChartsService', 'ChatVisualizationService']