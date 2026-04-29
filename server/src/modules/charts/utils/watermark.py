"""
Watermark Utility for Charts
Adds Aiser logo watermark to ECharts configurations based on plan type
"""

from typing import Dict, Any, Optional
from src.modules.pricing.plans import is_feature_available


def should_apply_watermark(plan_type: Optional[str]) -> bool:
    """Check if watermark should be applied based on plan type"""
    if not plan_type:
        return True  # Default to watermark for safety
    
    # Free plan = watermark enabled, Pro+ = watermark disabled
    return is_feature_available(plan_type, "watermark")


def add_watermark_to_chart_config(
    chart_config: Dict[str, Any],
    plan_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    Add watermark to ECharts configuration
    
    Args:
        chart_config: ECharts option configuration
        plan_type: Organization plan type ('free', 'pro', 'team', 'enterprise')
    
    Returns:
        Updated chart configuration with watermark if applicable
    """
    if not should_apply_watermark(plan_type):
        return chart_config
    
    # Ensure graphic array exists
    if 'graphic' not in chart_config:
        chart_config['graphic'] = []
    elif not isinstance(chart_config['graphic'], list):
        chart_config['graphic'] = []
    
    # Check if watermark already exists
    watermark_exists = any(
        isinstance(g, dict) and g.get('id') == 'aiser-watermark'
        for g in chart_config['graphic']
    )
    
    if not watermark_exists:
        # Add watermark graphic element
        watermark_graphic = {
            'type': 'image',
            'id': 'aiser-watermark',
            'left': 'center',
            'top': 'center',
            'z': 10000,  # Very high z-index to appear on top
            'style': {
                'image': '/aiser-logo.png',  # Path to logo (served from public folder)
                'width': 120,  # Square ratio (120x120) to prevent stretching
                'height': 120,  # Square ratio (120x120) to prevent stretching
                'opacity': 0.4,  # 40% opacity - more visible watermark
            },
            'silent': True,  # Don't interfere with chart interactions
            'invisible': False,
        }
        
        chart_config['graphic'].append(watermark_graphic)
    
    return chart_config


