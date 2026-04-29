"""
Intelligent Data Modeling Service
AI-powered data modeling with Cube.js schema generation and user approval workflow
"""

import logging
import json
import yaml
from typing import Dict, List, Optional, Any
from datetime import datetime
import pandas as pd
from ...ai.services.litellm_service import LiteLLMService

logger = logging.getLogger(__name__)


class IntelligentDataModelingService:
    """
    AI-powered data modeling service that:
    1. Analyzes uploaded data intelligently
    2. Generates Cube.js schema (YAML + visual representation)
    3. Provides user approval workflow
    4. Learns from user feedback for continuous improvement
    """

    def __init__(self):
        self.litellm_service = LiteLLMService()

        # User feedback storage for continuous learning
        self.feedback_history = []

        # Data modeling patterns learned from feedback
        self.learned_patterns = {
            "dimension_patterns": {},
            "measure_patterns": {},
            "relationship_patterns": {},
            "naming_conventions": {},
        }

    async def analyze_and_model_data(
        self,
        data: List[Dict[str, Any]],
        file_metadata: Dict[str, Any],
        user_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Complete intelligent data modeling workflow

        Steps:
        1. AI-powered data analysis
        2. Generate Cube.js schema (YAML)
        3. Create visual representation
        4. Provide approval workflow
        """
        try:
            logger.info(
                f"🧠 Starting intelligent data modeling for: {file_metadata.get('name')}"
            )

            # Step 1: Deep Data Analysis with AI
            data_analysis = await self._analyze_data_with_ai(
                data, file_metadata, user_context
            )

            # Step 2: Generate Cube.js Schema
            cube_schema = await self._generate_cube_schema(data_analysis, file_metadata)

            # Step 3: Create Visual Representation
            visual_model = self._create_visual_representation(
                cube_schema, data_analysis
            )

            # Step 4: Generate Recommendations
            recommendations = await self._generate_modeling_recommendations(
                data_analysis, cube_schema
            )

            # Step 5: Prepare Approval Workflow
            approval_workflow = self._create_approval_workflow(
                cube_schema, visual_model, recommendations
            )

            return {
                "success": True,
                "data_analysis": data_analysis,
                "cube_schema": cube_schema,
                "visual_model": visual_model,
                "recommendations": recommendations,
                "approval_workflow": approval_workflow,
                "modeling_id": f"model_{int(datetime.now().timestamp())}",
                "requires_approval": True,
            }

        except Exception as error:
            logger.error(f"❌ Intelligent data modeling failed: {str(error)}")
            return {
                "success": False,
                "error": str(error),
                "fallback_model": self._create_basic_model(data, file_metadata),
            }

    async def _analyze_data_with_ai(
        self,
        data: List[Dict[str, Any]],
        file_metadata: Dict[str, Any],
        user_context: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """AI-powered deep data analysis"""
        try:
            # Prepare data sample for AI analysis (unified preview size)
            from src.shared.query_limits import PREVIEW_ROWS
            data_sample = data[:PREVIEW_ROWS] if len(data) > PREVIEW_ROWS else data
            columns = list(data[0].keys()) if data else []

            # Create analysis prompt
            prompt = f"""
Analyze this dataset for intelligent data modeling:

Dataset: {file_metadata.get("name", "Unknown")}
Columns: {columns}
Sample Data: {json.dumps(data_sample, indent=2)}
Row Count: {len(data)}

Please analyze and return JSON with:
1. dimensions: Array of dimension fields with properties:
   - name: field name
   - type: dimension type (time, string, number, boolean)
   - description: business meaning
   - suggested_name: user-friendly name
   - drill_down_path: suggested drill-down hierarchy

2. measures: Array of measure fields with properties:
   - name: field name
   - type: measure type (count, sum, avg, max, min, countDistinct)
   - description: business meaning
   - suggested_name: user-friendly name
   - format: suggested display format

3. relationships: Potential relationships between fields
4. business_context: Inferred business domain and use cases
5. data_quality: Assessment of data quality issues
6. modeling_suggestions: Specific recommendations for Cube.js modeling

Return only valid JSON.
"""

            # Get AI analysis
            analysis = await self.litellm_service.analyze_natural_language_query(
                prompt, {"data_sample": data_sample, "user_context": user_context}
            )

            # Enhance with statistical analysis
            statistical_analysis = self._perform_statistical_analysis(data)

            return {
                "ai_analysis": analysis,
                "statistical_analysis": statistical_analysis,
                "data_quality_score": self._calculate_data_quality_score(data),
                "complexity_score": self._calculate_complexity_score(data, columns),
                "recommended_modeling_approach": self._recommend_modeling_approach(
                    analysis, statistical_analysis
                ),
            }

        except Exception as error:
            logger.warning(f"AI analysis failed, using fallback: {str(error)}")
            return self._fallback_data_analysis(data, file_metadata)

    async def _generate_cube_schema(
        self, data_analysis: Dict[str, Any], file_metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate Cube.js schema in YAML format"""
        try:
            ai_analysis = data_analysis.get("ai_analysis", {})
            dimensions = ai_analysis.get("dimensions", [])
            measures = ai_analysis.get("measures", [])

            # Generate cube name
            cube_name = self._generate_cube_name(file_metadata.get("name", "data"))

            # Build Cube.js schema
            cube_schema = {
                "cubes": [
                    {
                        "name": cube_name,
                        "sql_table": f"uploaded_data.{cube_name.lower()}",
                        "description": f"Auto-generated cube for {file_metadata.get('name')}",
                        "dimensions": self._build_dimensions_schema(dimensions),
                        "measures": self._build_measures_schema(measures),
                        "pre_aggregations": self._suggest_pre_aggregations(
                            dimensions, measures
                        ),
                    }
                ]
            }

            # Convert to YAML
            yaml_schema = yaml.dump(
                cube_schema, default_flow_style=False, sort_keys=False
            )

            return {
                "json_schema": cube_schema,
                "yaml_schema": yaml_schema,
                "cube_name": cube_name,
                "dimensions_count": len(dimensions),
                "measures_count": len(measures),
                "estimated_performance": self._estimate_performance(cube_schema),
            }

        except Exception as error:
            logger.error(f"Schema generation failed: {str(error)}")
            return self._generate_basic_schema(file_metadata)

    def _create_visual_representation(
        self, cube_schema: Dict[str, Any], data_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create visual representation of the data model"""

        cube = cube_schema.get("json_schema", {}).get("cubes", [{}])[0]
        dimensions = cube.get("dimensions", [])
        measures = cube.get("measures", [])

        # Create visual model structure
        visual_model = {
            "model_type": "star_schema",  # or 'snowflake', 'flat'
            "central_table": {
                "name": cube.get("name", "data"),
                "type": "fact_table",
                "dimensions": len(dimensions),
                "measures": len(measures),
            },
            "dimension_hierarchy": self._create_dimension_hierarchy(dimensions),
            "measure_groups": self._group_measures_by_type(measures),
            "relationships": self._identify_relationships(dimensions),
            "visual_layout": {
                "recommended_charts": self._recommend_chart_types(data_analysis),
                "dashboard_layout": self._suggest_dashboard_layout(
                    dimensions, measures
                ),
                "drill_down_paths": self._create_drill_down_paths(dimensions),
            },
        }

        return visual_model

    async def _generate_modeling_recommendations(
        self, data_analysis: Dict[str, Any], cube_schema: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Generate intelligent modeling recommendations"""

        recommendations = []

        # Performance recommendations
        if cube_schema.get("dimensions_count", 0) > 10:
            recommendations.append(
                {
                    "type": "performance",
                    "priority": "high",
                    "title": "Consider Pre-aggregations",
                    "description": "With many dimensions, pre-aggregations can improve query performance",
                    "action": "add_pre_aggregations",
                    "estimated_impact": "Query performance improvement: 3-5x faster",
                }
            )

        # Data quality recommendations
        quality_score = data_analysis.get("data_quality_score", 0)
        if quality_score < 0.8:
            recommendations.append(
                {
                    "type": "data_quality",
                    "priority": "medium",
                    "title": "Data Quality Issues Detected",
                    "description": f"Data quality score: {quality_score:.1%}. Consider data cleaning.",
                    "action": "review_data_quality",
                    "suggested_fixes": self._suggest_data_quality_fixes(data_analysis),
                }
            )

        # Business context recommendations
        ai_analysis = data_analysis.get("ai_analysis", {})
        business_context = ai_analysis.get("business_context", {})

        if business_context.get("domain") == "sales":
            recommendations.append(
                {
                    "type": "business_logic",
                    "priority": "medium",
                    "title": "Sales Analytics Enhancements",
                    "description": "Add calculated measures for sales analytics",
                    "action": "add_calculated_measures",
                    "suggested_measures": [
                        "revenue_growth",
                        "conversion_rate",
                        "average_order_value",
                    ],
                }
            )

        return recommendations

    def _create_approval_workflow(
        self,
        cube_schema: Dict[str, Any],
        visual_model: Dict[str, Any],
        recommendations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Create user approval workflow"""

        return {
            "workflow_id": f"approval_{int(datetime.now().timestamp())}",
            "steps": [
                {
                    "step": 1,
                    "title": "Review Data Model",
                    "description": "Review the AI-generated data model structure",
                    "type": "review",
                    "data": {"cube_schema": cube_schema, "visual_model": visual_model},
                    "actions": ["approve", "modify", "reject"],
                },
                {
                    "step": 2,
                    "title": "Customize Dimensions",
                    "description": "Customize dimension names and properties",
                    "type": "customize",
                    "data": {
                        "dimensions": cube_schema.get("json_schema", {})
                        .get("cubes", [{}])[0]
                        .get("dimensions", [])
                    },
                    "actions": ["edit_names", "change_types", "add_descriptions"],
                },
                {
                    "step": 3,
                    "title": "Configure Measures",
                    "description": "Configure measures and calculated fields",
                    "type": "configure",
                    "data": {
                        "measures": cube_schema.get("json_schema", {})
                        .get("cubes", [{}])[0]
                        .get("measures", [])
                    },
                    "actions": ["edit_measures", "add_calculated", "set_formats"],
                },
                {
                    "step": 4,
                    "title": "Apply Recommendations",
                    "description": "Review and apply AI recommendations",
                    "type": "recommendations",
                    "data": {"recommendations": recommendations},
                    "actions": ["apply_all", "apply_selected", "skip"],
                },
                {
                    "step": 5,
                    "title": "Final Approval",
                    "description": "Final review and deployment",
                    "type": "deploy",
                    "data": {"final_schema": cube_schema},
                    "actions": ["deploy", "save_draft", "cancel"],
                },
            ],
            "estimated_time": "5-10 minutes",
            "can_skip_steps": True,
            "auto_save": True,
        }

    async def process_user_feedback(
        self, modeling_id: str, feedback: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process user feedback for continuous improvement"""
        try:
            logger.info(f"📝 Processing user feedback for model: {modeling_id}")

            # Store feedback
            feedback_entry = {
                "modeling_id": modeling_id,
                "timestamp": datetime.now().isoformat(),
                "feedback": feedback,
                "feedback_type": feedback.get("type", "general"),
            }

            self.feedback_history.append(feedback_entry)

            # Learn from feedback
            self._learn_from_feedback(feedback)

            # Update modeling patterns
            updated_patterns = self._update_learned_patterns(feedback)

            return {
                "success": True,
                "feedback_processed": True,
                "learning_applied": True,
                "updated_patterns": updated_patterns,
                "message": "Thank you for your feedback! The system has learned from your input.",
            }

        except Exception as error:
            logger.error(f"❌ Feedback processing failed: {str(error)}")
            return {"success": False, "error": str(error)}

    # Helper methods
    def _perform_statistical_analysis(
        self, data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Perform statistical analysis on the data"""
        if not data:
            return {}

        try:
            df = pd.DataFrame(data)

            return {
                "row_count": len(df),
                "column_count": len(df.columns),
                "numeric_columns": df.select_dtypes(
                    include=["number"]
                ).columns.tolist(),
                "categorical_columns": df.select_dtypes(
                    include=["object"]
                ).columns.tolist(),
                "null_percentages": (df.isnull().sum() / len(df)).to_dict(),
                "unique_value_counts": df.nunique().to_dict(),
                "data_types": df.dtypes.astype(str).to_dict(),
            }
        except:
            return {"error": "Statistical analysis failed"}

    def _calculate_data_quality_score(self, data: List[Dict[str, Any]]) -> float:
        """Calculate data quality score (0-1)"""
        if not data:
            return 0.0

        try:
            df = pd.DataFrame(data)

            # Factors affecting quality
            null_ratio = df.isnull().sum().sum() / (len(df) * len(df.columns))
            duplicate_ratio = df.duplicated().sum() / len(df)

            # Quality score (higher is better)
            quality_score = 1.0 - (null_ratio * 0.5 + duplicate_ratio * 0.3)

            return max(0.0, min(1.0, quality_score))
        except:
            return 0.5  # Default moderate quality

    def _calculate_complexity_score(
        self, data: List[Dict[str, Any]], columns: List[str]
    ) -> int:
        """Calculate modeling complexity score (1-5)"""
        if not data or not columns:
            return 1

        # Factors affecting complexity
        column_count = len(columns)
        row_count = len(data)

        if column_count <= 5 and row_count <= 1000:
            return 1  # Simple
        elif column_count <= 10 and row_count <= 10000:
            return 2  # Easy
        elif column_count <= 20 and row_count <= 100000:
            return 3  # Moderate
        elif column_count <= 50 and row_count <= 1000000:
            return 4  # Complex
        else:
            return 5  # Very Complex

    def _recommend_modeling_approach(
        self, ai_analysis: Dict, statistical_analysis: Dict
    ) -> str:
        """Recommend modeling approach based on analysis"""

        column_count = statistical_analysis.get("column_count", 0)
        row_count = statistical_analysis.get("row_count", 0)

        if column_count <= 10 and row_count <= 10000:
            return "simple_flat_model"
        elif column_count <= 20:
            return "star_schema"
        else:
            return "snowflake_schema"

    def _generate_cube_name(self, filename: str) -> str:
        """Generate appropriate cube name from filename"""
        import re

        # Clean filename
        name = re.sub(r"[^a-zA-Z0-9_]", "_", filename.split(".")[0])
        name = re.sub(r"_+", "_", name).strip("_")

        return f"{name}_cube" if name else "data_cube"

    def _build_dimensions_schema(self, dimensions: List[Dict]) -> List[Dict]:
        """Build Cube.js dimensions schema"""
        schema_dimensions = []

        for dim in dimensions:
            schema_dim = {
                "name": dim.get("name"),
                "sql": f"${{{dim.get('name')}}}",
                "type": self._map_dimension_type(dim.get("type", "string")),
                "title": dim.get("suggested_name", dim.get("name", "").title()),
            }

            if dim.get("description"):
                schema_dim["description"] = dim["description"]

            schema_dimensions.append(schema_dim)

        return schema_dimensions

    def _build_measures_schema(self, measures: List[Dict]) -> List[Dict]:
        """Build Cube.js measures schema"""
        schema_measures = []

        for measure in measures:
            schema_measure = {
                "name": measure.get("name"),
                "sql": f"${{{measure.get('name')}}}",
                "type": measure.get("type", "sum"),
                "title": measure.get("suggested_name", measure.get("name", "").title()),
            }

            if measure.get("format"):
                schema_measure["format"] = measure["format"]

            schema_measures.append(schema_measure)

        return schema_measures

    def _map_dimension_type(self, ai_type: str) -> str:
        """Map AI-detected type to Cube.js dimension type"""
        mapping = {
            "time": "time",
            "string": "string",
            "number": "number",
            "boolean": "boolean",
        }
        return mapping.get(ai_type, "string")

    def _suggest_pre_aggregations(
        self, dimensions: List[Dict], measures: List[Dict]
    ) -> List[Dict]:
        """Suggest pre-aggregations for performance"""
        if len(dimensions) > 5 or len(measures) > 3:
            return [
                {
                    "name": "main_rollup",
                    "measures": [m.get("name") for m in measures[:3]],
                    "dimensions": [d.get("name") for d in dimensions[:5]],
                    "refresh_key": {"every": "1 hour"},
                }
            ]
        return []

    def _fallback_data_analysis(
        self, data: List[Dict], file_metadata: Dict
    ) -> Dict[str, Any]:
        """Fallback analysis when AI fails"""
        columns = list(data[0].keys()) if data else []

        return {
            "ai_analysis": {
                "dimensions": [
                    {"name": col, "type": "string"} for col in columns if col
                ],
                "measures": [],
                "business_context": {"domain": "general"},
                "fallback": True,
            },
            "statistical_analysis": self._perform_statistical_analysis(data),
            "data_quality_score": 0.7,
            "complexity_score": 2,
            "recommended_modeling_approach": "simple_flat_model",
        }

    def _create_basic_model(
        self, data: List[Dict], file_metadata: Dict
    ) -> Dict[str, Any]:
        """Create basic fallback model"""
        columns = list(data[0].keys()) if data else []

        return {
            "cube_schema": {
                "json_schema": {
                    "cubes": [
                        {
                            "name": "basic_cube",
                            "dimensions": [
                                {"name": col, "type": "string"} for col in columns
                            ],
                            "measures": [{"name": "count", "type": "count"}],
                        }
                    ]
                },
                "yaml_schema": "cubes:\n  - name: basic_cube\n    dimensions: []\n    measures: []",
            },
            "requires_approval": False,
            "fallback": True,
        }

    def _learn_from_feedback(self, feedback: Dict[str, Any]):
        """Learn from user feedback to improve future modeling"""
        feedback_type = feedback.get("type")

        if feedback_type == "dimension_naming":
            # Learn naming preferences
            original = feedback.get("original_name")
            preferred = feedback.get("preferred_name")
            if original and preferred:
                self.learned_patterns["naming_conventions"][original] = preferred

        elif feedback_type == "measure_type":
            # Learn measure type preferences
            field = feedback.get("field_name")
            preferred_type = feedback.get("preferred_type")
            if field and preferred_type:
                self.learned_patterns["measure_patterns"][field] = preferred_type

    def _update_learned_patterns(self, feedback: Dict[str, Any]) -> Dict[str, Any]:
        """Update learned patterns based on feedback"""
        return {
            "patterns_updated": len(self.learned_patterns),
            "feedback_count": len(self.feedback_history),
            "learning_confidence": min(len(self.feedback_history) / 10, 1.0),
        }

    # Additional helper methods for visual representation
    def _create_dimension_hierarchy(self, dimensions: List[Dict]) -> Dict[str, Any]:
        """Create dimension hierarchy for drill-down"""
        hierarchy = {}

        for dim in dimensions:
            dim_type = dim.get("type", "string")
            if dim_type == "time":
                hierarchy["time"] = hierarchy.get("time", []) + [dim.get("name")]
            else:
                hierarchy["categorical"] = hierarchy.get("categorical", []) + [
                    dim.get("name")
                ]

        return hierarchy

    def _group_measures_by_type(self, measures: List[Dict]) -> Dict[str, List[str]]:
        """Group measures by type"""
        groups = {}

        for measure in measures:
            measure_type = measure.get("type", "sum")
            groups[measure_type] = groups.get(measure_type, []) + [measure.get("name")]

        return groups

    def _identify_relationships(self, dimensions: List[Dict]) -> List[Dict[str, Any]]:
        """Identify potential relationships between dimensions"""
        relationships = []

        # Simple relationship detection based on naming patterns
        for i, dim1 in enumerate(dimensions):
            for dim2 in dimensions[i + 1 :]:
                name1 = dim1.get("name", "").lower()
                name2 = dim2.get("name", "").lower()

                # Check for common relationship patterns
                if "id" in name1 and name1.replace("_id", "") in name2:
                    relationships.append(
                        {
                            "type": "foreign_key",
                            "from": name1,
                            "to": name2,
                            "confidence": 0.8,
                        }
                    )

        return relationships

    def _recommend_chart_types(self, data_analysis: Dict[str, Any]) -> List[str]:
        """Recommend chart types based on data analysis"""
        statistical = data_analysis.get("statistical_analysis", {})
        numeric_cols = len(statistical.get("numeric_columns", []))
        categorical_cols = len(statistical.get("categorical_columns", []))

        recommendations = []

        if numeric_cols > 0 and categorical_cols > 0:
            recommendations.extend(["bar", "line", "scatter"])
        if categorical_cols > 0:
            recommendations.append("pie")
        if numeric_cols > 1:
            recommendations.append("scatter")

        return recommendations or ["bar"]

    def _suggest_dashboard_layout(
        self, dimensions: List[Dict], measures: List[Dict]
    ) -> Dict[str, Any]:
        """Suggest dashboard layout"""
        return {
            "layout_type": "grid",
            "recommended_widgets": [
                {
                    "type": "kpi_cards",
                    "measures": [m.get("name") for m in measures[:3]],
                },
                {
                    "type": "trend_chart",
                    "time_dimension": next(
                        (d.get("name") for d in dimensions if d.get("type") == "time"),
                        None,
                    ),
                },
                {
                    "type": "breakdown_chart",
                    "dimension": dimensions[0].get("name") if dimensions else None,
                },
            ],
        }

    def _create_drill_down_paths(self, dimensions: List[Dict]) -> List[List[str]]:
        """Create drill-down paths"""
        time_dims = [d.get("name") for d in dimensions if d.get("type") == "time"]
        categorical_dims = [
            d.get("name") for d in dimensions if d.get("type") != "time"
        ]

        paths = []
        if time_dims:
            paths.append(time_dims)
        if len(categorical_dims) > 1:
            paths.append(categorical_dims[:3])  # Limit to 3 levels

        return paths

    def _suggest_data_quality_fixes(self, data_analysis: Dict[str, Any]) -> List[str]:
        """Suggest data quality fixes"""
        fixes = []

        statistical = data_analysis.get("statistical_analysis", {})
        null_percentages = statistical.get("null_percentages", {})

        for column, null_pct in null_percentages.items():
            if null_pct > 0.1:  # More than 10% nulls
                fixes.append(
                    f"Handle missing values in '{column}' column ({null_pct:.1%} missing)"
                )

        return fixes

    def _estimate_performance(self, cube_schema: Dict[str, Any]) -> Dict[str, Any]:
        """Estimate query performance"""
        cube = cube_schema.get("cubes", [{}])[0]
        dim_count = len(cube.get("dimensions", []))
        measure_count = len(cube.get("measures", []))

        # Simple performance estimation
        if dim_count <= 5 and measure_count <= 3:
            performance = "excellent"
        elif dim_count <= 10 and measure_count <= 5:
            performance = "good"
        else:
            performance = "moderate"

        return {
            "estimated_performance": performance,
            "query_time_estimate": f"{dim_count * 0.1 + measure_count * 0.05:.1f}s",
            "optimization_suggestions": ["Consider pre-aggregations"]
            if dim_count > 10
            else [],
        }
