"""
MCP ECharts Integration Service
Connects to MCP ECharts server for advanced chart generation
"""

import logging
import aiohttp
import os
from typing import Dict, List, Optional, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class MCPIntegrationService:
    """Service for integrating with MCP ECharts server"""

    def __init__(self):
        self.mcp_server_url = os.getenv(
            "MCP_ECHARTS_SERVER_URL", "http://localhost:3001"
        )
        self.mcp_enabled = os.getenv("MCP_ECHARTS_ENABLED", "true").lower() == "true"

        # Connection status
        self.is_connected = False
        self.server_capabilities = {}

    async def initialize_mcp_connection(self) -> Dict[str, Any]:
        """Initialize connection to MCP ECharts server"""
        try:
            if not self.mcp_enabled:
                return {
                    "success": False,
                    "error": "MCP ECharts is disabled",
                    "fallback_mode": True,
                }

            logger.info(f"🔗 Connecting to MCP ECharts server at {self.mcp_server_url}")

            # Test connection
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.mcp_server_url}/health") as response:
                    if response.status == 200:
                        data = await response.json()
                        self.is_connected = True
                        self.server_capabilities = data.get("capabilities", {})

                        logger.info("✅ Connected to MCP ECharts server")
                        return {
                            "success": True,
                            "connected": True,
                            "capabilities": self.server_capabilities,
                        }
                    else:
                        raise Exception(f"HTTP {response.status}")

        except Exception as error:
            logger.warning(f"⚠️ MCP ECharts server not available: {str(error)}")
            self.is_connected = False
            return {
                "success": False,
                "connected": False,
                "error": str(error),
                "fallback_mode": True,
            }

    async def generate_chart_with_mcp(
        self,
        data: List[Dict[str, Any]],
        chart_config: Dict[str, Any],
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate chart using MCP ECharts server"""
        try:
            if not self.is_connected:
                connection_result = await self.initialize_mcp_connection()
                if not connection_result["success"]:
                    return self._fallback_chart_generation(data, chart_config)

            logger.info("📊 Generating chart with MCP ECharts")

            # Prepare MCP request
            mcp_request = {
                "data": data,
                "config": chart_config,
                "options": options or {},
                "timestamp": datetime.now().isoformat(),
            }

            async with aiohttp.ClientSession() as session:
                headers = {"Content-Type": "application/json"}

                async with session.post(
                    f"{self.mcp_server_url}/generate-chart",
                    json=mcp_request,
                    headers=headers,
                ) as response:
                    if response.status == 200:
                        result = await response.json()

                        return {
                            "success": True,
                            "chart_id": result.get("chart_id"),
                            "chart_config": result.get("chart_config"),
                            "render_url": result.get("render_url"),
                            "svg_content": result.get("svg_content"),
                            "png_url": result.get("png_url"),
                            "mcp_enhanced": True,
                            "generation_time": result.get("generation_time"),
                        }
                    else:
                        error_text = await response.text()
                        raise Exception(
                            f"MCP generation failed: HTTP {response.status} - {error_text}"
                        )

        except Exception as error:
            logger.error(f"❌ MCP chart generation failed: {str(error)}")
            return self._fallback_chart_generation(data, chart_config)

    async def get_chart_recommendations_from_mcp(
        self, data_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Get chart recommendations from MCP server"""
        try:
            if not self.is_connected:
                connection_result = await self.initialize_mcp_connection()
                if not connection_result["success"]:
                    return self._fallback_recommendations(data_analysis)

            logger.info("💡 Getting chart recommendations from MCP")

            async with aiohttp.ClientSession() as session:
                headers = {"Content-Type": "application/json"}

                async with session.post(
                    f"{self.mcp_server_url}/recommend-charts",
                    json={"data_analysis": data_analysis},
                    headers=headers,
                ) as response:
                    if response.status == 200:
                        result = await response.json()

                        return {
                            "success": True,
                            "recommendations": result.get("recommendations", []),
                            "primary_recommendation": result.get(
                                "primary_recommendation"
                            ),
                            "reasoning": result.get("reasoning"),
                            "mcp_enhanced": True,
                        }
                    else:
                        raise Exception(f"HTTP {response.status}")

        except Exception as error:
            logger.error(f"❌ MCP recommendations failed: {str(error)}")
            return self._fallback_recommendations(data_analysis)

    async def render_chart_to_image(
        self,
        chart_config: Dict[str, Any],
        format: str = "png",
        width: int = 800,
        height: int = 600,
    ) -> Dict[str, Any]:
        """Render chart to image using MCP server"""
        try:
            if not self.is_connected:
                connection_result = await self.initialize_mcp_connection()
                if not connection_result["success"]:
                    return {
                        "success": False,
                        "error": "MCP server not available",
                        "fallback_mode": True,
                    }

            logger.info(f"🖼️ Rendering chart to {format} with MCP")

            render_request = {
                "config": chart_config,
                "format": format,
                "width": width,
                "height": height,
            }

            async with aiohttp.ClientSession() as session:
                headers = {"Content-Type": "application/json"}

                async with session.post(
                    f"{self.mcp_server_url}/render-chart",
                    json=render_request,
                    headers=headers,
                ) as response:
                    if response.status == 200:
                        if format == "png":
                            image_data = await response.read()
                            return {
                                "success": True,
                                "format": format,
                                "image_data": image_data,
                                "size": len(image_data),
                            }
                        else:
                            result = await response.json()
                            return {
                                "success": True,
                                "format": format,
                                "svg_content": result.get("svg_content"),
                                "render_url": result.get("render_url"),
                            }
                    else:
                        raise Exception(f"HTTP {response.status}")

        except Exception as error:
            logger.error(f"❌ MCP chart rendering failed: {str(error)}")
            return {"success": False, "error": str(error)}

    def _fallback_chart_generation(
        self, data: List[Dict[str, Any]], chart_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Fallback chart generation when MCP is not available"""
        logger.info("📊 Using fallback chart generation")

        return {
            "success": True,
            "chart_id": f"fallback_{int(datetime.now().timestamp())}",
            "chart_config": chart_config,
            "render_url": None,
            "svg_content": None,
            "png_url": None,
            "mcp_enhanced": False,
            "fallback_mode": True,
            "message": "Chart generated with fallback mode. MCP ECharts server not available.",
        }

    def _fallback_recommendations(
        self, data_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Fallback recommendations when MCP is not available"""
        logger.info("💡 Using fallback recommendations")

        # Simple rule-based recommendations
        numeric_cols = len(
            data_analysis.get("statistical_analysis", {}).get("numeric_columns", [])
        )
        categorical_cols = len(
            data_analysis.get("statistical_analysis", {}).get("categorical_columns", [])
        )

        recommendations = []

        if numeric_cols > 0 and categorical_cols > 0:
            recommendations.extend(["bar", "line"])
        if categorical_cols > 0:
            recommendations.append("pie")
        if numeric_cols > 1:
            recommendations.append("scatter")

        primary = recommendations[0] if recommendations else "bar"

        return {
            "success": True,
            "recommendations": recommendations or ["bar"],
            "primary_recommendation": primary,
            "reasoning": "Fallback recommendations based on data types",
            "mcp_enhanced": False,
            "fallback_mode": True,
        }

    def get_mcp_status(self) -> Dict[str, Any]:
        """Get MCP server status"""
        return {
            "enabled": self.mcp_enabled,
            "connected": self.is_connected,
            "server_url": self.mcp_server_url,
            "capabilities": self.server_capabilities,
            "last_check": datetime.now().isoformat(),
        }

    async def test_mcp_connection(self) -> Dict[str, Any]:
        """Test MCP server connection"""
        return await self.initialize_mcp_connection()
