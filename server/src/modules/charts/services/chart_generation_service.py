"""
Chart Generation Service
Orchestrates chart generation using MCP ECharts and integrates with analytics
"""

import logging
from typing import Dict, List, Optional, Any
# Import will be handled by __init__.py
from ...ai.services.litellm_service import LiteLLMService

logger = logging.getLogger(__name__)


class ChartGenerationService:
    """Service for orchestrating chart generation workflow"""
    
    def __init__(self):
        # Import here to avoid circular imports
        from .mcp_echarts_service import MCPEChartsService
        
        self.mcp_echarts = MCPEChartsService()
        self.litellm = LiteLLMService()
    
    async def generate_chart_from_query(
        self,
        data: List[Dict[str, Any]],
        query_analysis: Dict[str, Any],
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate chart from query results and analysis"""
        try:
            logger.info(f"🎨 Generating chart for query: {query_analysis.get('original_query', 'Unknown')}")
            
            if options is None:
                options = {}
            
            # Prepare cube data format
            cube_data = {
                'data': data,
                'annotation': self._generate_annotation(data)
            }
            
            # Enhance query analysis with LiteLLM if needed
            if not query_analysis.get('enhanced_by_llm'):
                try:
                    llm_analysis = await self.litellm.analyze_natural_language_query(
                        query_analysis.get('original_query', ''),
                        {'data_summary': {'row_count': len(data), 'columns': list(data[0].keys()) if data else []}}
                    )
                    # Merge LLM analysis with existing analysis
                    query_analysis.update(llm_analysis)
                    query_analysis['enhanced_by_llm'] = True
                except Exception as e:
                    logger.warning(f"LiteLLM enhancement failed, using original analysis: {str(e)}")
            
            # Generate chart using MCP ECharts
            result = await self.mcp_echarts.generate_chart_from_cube_data(
                cube_data, 
                query_analysis, 
                options
            )
            
            # Generate business insights using LiteLLM
            if result.get('success') and data:
                try:
                    business_insights = await self.litellm.generate_business_insights(data, query_analysis)
                    result['business_insights'] = business_insights
                except Exception as e:
                    logger.warning(f"Business insights generation failed: {str(e)}")
            
            # Add additional metadata
            if result.get('success'):
                result['generation_metadata'] = {
                    'service': 'chart_generation_service',
                    'mcp_echarts_version': '1.0.0',
                    'litellm_enhanced': query_analysis.get('enhanced_by_llm', False),
                    'query_type': query_analysis.get('query_type', []),
                    'business_context': query_analysis.get('business_context', {}),
                    'data_source_type': 'cube_query'
                }
            
            return result
            
        except Exception as error:
            logger.error(f"❌ Chart generation failed: {str(error)}")
            return {
                'success': False,
                'error': str(error),
                'fallback_available': True
            }
    
    async def generate_chart_from_file_data(
        self,
        data: List[Dict[str, Any]],
        file_metadata: Dict[str, Any],
        natural_language_query: str,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate chart from uploaded file data"""
        try:
            logger.info(f"📁 Generating chart from file data: {file_metadata.get('name', 'Unknown')}")
            
            # Create basic query analysis for file data
            query_analysis = {
                'original_query': natural_language_query,
                'query_type': self._infer_query_type_from_text(natural_language_query),
                'business_context': {'type': 'general'},
                'data_source': 'file_upload',
                'file_metadata': file_metadata
            }
            
            return await self.generate_chart_from_query(data, query_analysis, options)
            
        except Exception as error:
            logger.error(f"❌ File chart generation failed: {str(error)}")
            return {
                'success': False,
                'error': str(error)
            }
    
    async def get_chart_recommendations(
        self,
        data: List[Dict[str, Any]],
        query_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Get chart type recommendations for given data"""
        try:
            logger.info("💡 Generating chart recommendations")
            
            # Analyze data if no query analysis provided
            if not query_analysis:
                query_analysis = {'query_type': ['general'], 'business_context': {'type': 'general'}}
            
            cube_data = {'data': data}
            data_analysis = self._analyze_data_structure(cube_data)
            
            # Get recommendations for different chart types
            recommendations = []
            
            chart_types = ['line', 'bar', 'pie', 'scatter', 'gauge']
            for chart_type in chart_types:
                if self._is_chart_type_compatible(chart_type, data_analysis):
                    score = self._calculate_chart_type_score(chart_type, data_analysis, query_analysis)
                    recommendations.append({
                        'chart_type': chart_type,
                        'score': score,
                        'reason': self._get_recommendation_reason(chart_type, data_analysis),
                        'compatible': True
                    })
                else:
                    recommendations.append({
                        'chart_type': chart_type,
                        'score': 0,
                        'reason': 'Not compatible with current data structure',
                        'compatible': False
                    })
            
            # Sort by score
            recommendations.sort(key=lambda x: x['score'], reverse=True)
            
            return {
                'success': True,
                'recommendations': recommendations,
                'data_analysis': data_analysis,
                'best_recommendation': recommendations[0] if recommendations else None
            }
            
        except Exception as error:
            logger.error(f"❌ Chart recommendations failed: {str(error)}")
            return {
                'success': False,
                'error': str(error)
            }
    
    def _generate_annotation(self, data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate annotation metadata for data"""
        if not data:
            return {'measures': {}, 'dimensions': {}, 'timeDimensions': {}}
        
        first_row = data[0]
        annotation = {
            'measures': {},
            'dimensions': {},
            'timeDimensions': {}
        }
        
        for key in first_row.keys():
            if any(suffix in key for suffix in ['.count', '.sum', '.avg', '.max', '.min']):
                annotation['measures'][key] = {
                    'title': key.replace('.', ' ').title(),
                    'type': 'number'
                }
            elif any(suffix in key for suffix in ['.day', '.month', '.year', '.hour', 'Date']):
                annotation['timeDimensions'][key] = {
                    'title': key.replace('.', ' ').title(),
                    'type': 'time'
                }
            else:
                annotation['dimensions'][key] = {
                    'title': key.replace('.', ' ').title(),
                    'type': 'string'
                }
        
        return annotation
    
    def _infer_query_type_from_text(self, text: str) -> List[str]:
        """Infer query type from natural language text"""
        text_lower = text.lower()
        query_types = []
        
        # Check for different query patterns
        if any(word in text_lower for word in ['trend', 'over time', 'growth', 'change']):
            query_types.append('trends')
        if any(word in text_lower for word in ['compare', 'vs', 'versus', 'difference']):
            query_types.append('comparisons')
        if any(word in text_lower for word in ['how many', 'count', 'total', 'sum']):
            query_types.append('metrics')
        if any(word in text_lower for word in ['distribution', 'breakdown', 'split']):
            query_types.append('segmentation')
        
        return query_types if query_types else ['general']
    
    def _calculate_chart_type_score(
        self,
        chart_type: str,
        data_analysis: Dict[str, Any],
        query_analysis: Dict[str, Any]
    ) -> float:
        """Calculate compatibility score for chart type"""
        score = 0.0
        
        # Base compatibility score
        if self._is_chart_type_compatible(chart_type, data_analysis):
            score += 3.0
        
        # Data type alignment
        data_type = data_analysis.get('data_type', 'categorical')
        if data_type == 'time_series' and chart_type == 'line':
            score += 2.0
        elif data_type == 'categorical' and chart_type == 'bar':
            score += 2.0
        elif data_type == 'correlation' and chart_type == 'scatter':
            score += 2.0
        
        # Query type alignment
        query_types = query_analysis.get('query_type', [])
        for query_type in query_types:
            if query_type == 'trends' and chart_type == 'line':
                score += 1.5
            elif query_type == 'comparisons' and chart_type == 'bar':
                score += 1.5
            elif query_type == 'segmentation' and chart_type == 'pie':
                score += 1.5
            elif query_type == 'metrics' and chart_type == 'gauge':
                score += 1.5
        
        # Pattern-based scoring
        patterns = data_analysis.get('patterns', {})
        if patterns.get('has_trend') and chart_type == 'line':
            score += 1.0
        if patterns.get('correlation') and abs(patterns['correlation']) > 0.7 and chart_type == 'scatter':
            score += 1.0
        
        return round(score, 2)
    
    def _get_recommendation_reason(self, chart_type: str, data_analysis: Dict[str, Any]) -> str:
        """Get human-readable reason for chart recommendation"""
        reasons = {
            'line': 'Best for showing trends over time and continuous data',
            'bar': 'Ideal for comparing categories and discrete values',
            'pie': 'Perfect for showing parts of a whole and distributions',
            'scatter': 'Great for showing relationships between two variables',
            'gauge': 'Excellent for displaying single metrics and KPIs'
        }
        
        base_reason = reasons.get(chart_type, 'Suitable for general data visualization')
        
        # Add data-specific reasons
        data_type = data_analysis.get('data_type', 'categorical')
        if data_type == 'time_series' and chart_type == 'line':
            base_reason += ' (detected time series data)'
        elif data_type == 'correlation' and chart_type == 'scatter':
            base_reason += ' (detected correlation between measures)'
        elif len(data_analysis.get('measures', [])) == 1 and chart_type == 'gauge':
            base_reason += ' (single metric detected)'
        
        return base_reason

    def _analyze_data_structure(self, cube_data: Dict[str, Any]) -> Dict[str, Any]:
        """Lightweight analysis of data to guide chart recommendations."""
        rows: List[Dict[str, Any]] = cube_data.get('data', []) or []
        analysis: Dict[str, Any] = {
            'data_type': 'categorical',
            'measures': [],
            'dimensions': [],
            'patterns': {}
        }
        if not rows:
            return analysis
        sample = rows[0]
        for key, value in sample.items():
            if isinstance(value, (int, float)):
                analysis['measures'].append(key)
            else:
                analysis['dimensions'].append(key)
        # crude time series detection
        if any('date' in k.lower() or 'time' in k.lower() for k in sample.keys()):
            analysis['data_type'] = 'time_series'
        # crude correlation hint
        analysis['patterns']['has_trend'] = analysis['data_type'] == 'time_series'
        return analysis

    def _is_chart_type_compatible(self, chart_type: str, data_analysis: Dict[str, Any]) -> bool:
        """Heuristic compatibility check between chart type and data."""
        measures = data_analysis.get('measures', [])
        dims = data_analysis.get('dimensions', [])
        dtype = data_analysis.get('data_type', 'categorical')
        if chart_type == 'line':
            return dtype == 'time_series' and len(measures) >= 1
        if chart_type == 'bar':
            return len(dims) >= 1 and len(measures) >= 1
        if chart_type == 'pie':
            return len(dims) >= 1 and len(measures) == 1
        if chart_type == 'scatter':
            return len(measures) >= 2
        if chart_type == 'gauge':
            return len(measures) == 1
        return True