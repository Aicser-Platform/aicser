"""
AI-Powered Schema Generation Service
Uses LiteLLM to intelligently analyze data and generate enhanced schemas
"""

import logging
import json
from typing import Dict, Any, List
from datetime import datetime
from src.modules.ai.services.litellm_service import LiteLLMService

logger = logging.getLogger(__name__)


class AISchemaService:
    """AI-powered schema generation and enhancement service"""

    def __init__(self):
        self.litellm_service = LiteLLMService()
        self.supported_models = [
            "azure_gpt5_mini",  # Use gpt-5-mini as configured in .env
            "azure_gpt4_mini",
            "openai_gpt4_mini",
            "openai_gpt35",
        ]

    async def generate_enhanced_schema(
        self,
        data: List[Dict[str, Any]],
        basic_schema: Dict[str, Any],
        data_source_name: str,
        data_source_type: str = "file",
    ) -> Dict[str, Any]:
        """Generate enhanced schema using AI analysis"""
        try:
            logger.info(f"🤖 Generating AI-enhanced schema for {data_source_name}")

            # Prepare context for AI analysis
            context = self._prepare_analysis_context(
                data, basic_schema, data_source_name, data_source_type
            )

            # Generate AI analysis prompt
            prompt = self._generate_analysis_prompt(context)

            # Get AI analysis
            ai_analysis = await self._get_ai_analysis(prompt)

            # Enhance the basic schema with AI insights
            enhanced_schema = self._enhance_schema_with_ai(basic_schema, ai_analysis)

            logger.info("✅ AI-enhanced schema generated successfully")
            return enhanced_schema

        except Exception as e:
            logger.error(f"❌ AI schema generation failed: {str(e)}")
            # Return basic schema if AI enhancement fails
            return basic_schema

    def _prepare_analysis_context(
        self,
        data: List[Dict[str, Any]],
        basic_schema: Dict[str, Any],
        data_source_name: str,
        data_source_type: str,
    ) -> Dict[str, Any]:
        """Prepare context for AI analysis"""
        # Sample data for analysis (unified limit for token efficiency)
        from src.shared.query_limits import SCHEMA_SAMPLE_ROWS
        sample_data = data[:SCHEMA_SAMPLE_ROWS] if len(data) > SCHEMA_SAMPLE_ROWS else data

        # Extract key information
        context = {
            "data_source_name": data_source_name,
            "data_source_type": data_source_type,
            "total_rows": len(data),
            "sample_rows": sample_data,
            "basic_schema": basic_schema,
            "column_count": len(basic_schema.get("columns", [])),
            "data_types": basic_schema.get("types", {}),
            "statistics": {
                col["name"]: col.get("statistics", {})
                for col in basic_schema.get("columns", [])
            },
        }

        return context

    def _generate_analysis_prompt(self, context: Dict[str, Any]) -> str:
        """Generate AI analysis prompt"""
        prompt = f"""
You are a data analyst expert. Analyze the following dataset and provide insights to enhance the schema.

Dataset: {context["data_source_name"]}
Type: {context["data_source_type"]}
Total Rows: {context["total_rows"]}
Columns: {context["column_count"]}

Current Schema:
{json.dumps(context["basic_schema"], indent=2)}

Sample Data (first {len(context["sample_rows"])} rows):
{json.dumps(context["sample_rows"], indent=2)}

Please provide:
1. Business context and domain insights
2. Data quality assessment
3. Suggested column improvements (renaming, categorization, derived fields)
4. Potential business metrics and KPIs
5. Data validation rules
6. Recommended data transformations
7. Privacy and compliance considerations

Format your response as JSON with the following structure:
{{
    "business_context": {{
        "domain": "string",
        "purpose": "string",
        "key_entities": ["string"],
        "business_processes": ["string"]
    }},
    "data_quality": {{
        "score": "number (1-10)",
        "issues": ["string"],
        "recommendations": ["string"]
    }},
    "column_improvements": [
        {{
            "current_name": "string",
            "suggested_name": "string",
            "category": "string",
            "description": "string",
            "validation_rules": ["string"]
        }}
    ],
    "business_metrics": [
        {{
            "name": "string",
            "description": "string",
            "calculation": "string",
            "importance": "high|medium|low"
        }}
    ],
    "data_transformations": [
        {{
            "type": "string",
            "description": "string",
            "implementation": "string"
        }}
    ],
    "privacy_considerations": {{
        "pii_fields": ["string"],
        "sensitivity_level": "string",
        "compliance_requirements": ["string"]
    }}
}}
"""
        return prompt

    async def _get_ai_analysis(self, prompt: str) -> Dict[str, Any]:
        """Get AI analysis using LiteLLM"""
        try:
            # Use the first available model
            model = self.supported_models[0]

            response = await self.litellm_service.generate_completion(
                prompt=prompt,
                model_id=model,
                temperature=0.1,  # Low temperature for consistent analysis
                max_tokens=2000,
            )

            # Parse JSON response from content field
            try:
                if response.get("success") and response.get("content"):
                    analysis = json.loads(response["content"])
                    return analysis
                else:
                    logger.warning("AI response was not successful or missing content")
                    return {}
            except json.JSONDecodeError:
                logger.warning(
                    "AI response was not valid JSON, returning empty analysis"
                )
                return {}

        except Exception as e:
            logger.error(f"AI analysis failed: {str(e)}")
            return {}

    def _enhance_schema_with_ai(
        self, basic_schema: Dict[str, Any], ai_analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Enhance basic schema with AI insights"""
        enhanced_schema = basic_schema.copy()

        # Add AI enhancements
        enhanced_schema["ai_enhancements"] = {
            "generated_at": datetime.now().isoformat(),
            "model_used": self.supported_models[0],
            "analysis": ai_analysis,
        }

        # Add business context
        if ai_analysis.get("business_context"):
            enhanced_schema["business_context"] = ai_analysis["business_context"]

        # Add data quality score
        if ai_analysis.get("data_quality"):
            enhanced_schema["data_quality_score"] = ai_analysis["data_quality"].get(
                "score", 5
            )
            enhanced_schema["data_quality_issues"] = ai_analysis["data_quality"].get(
                "issues", []
            )

        # Add suggested improvements
        if ai_analysis.get("column_improvements"):
            enhanced_schema["suggested_improvements"] = ai_analysis[
                "column_improvements"
            ]

        # Add business metrics
        if ai_analysis.get("business_metrics"):
            enhanced_schema["business_metrics"] = ai_analysis["business_metrics"]

        # Add privacy considerations
        if ai_analysis.get("privacy_considerations"):
            enhanced_schema["privacy_considerations"] = ai_analysis[
                "privacy_considerations"
            ]

        return enhanced_schema

    async def generate_data_insights(
        self, data: List[Dict[str, Any]], schema: Dict[str, Any], data_source_name: str
    ) -> Dict[str, Any]:
        """Generate data insights and recommendations"""
        try:
            logger.info(f"🔍 Generating data insights for {data_source_name}")

            # Prepare data summary
            data_summary = self._prepare_data_summary(data, schema)

            # Generate insights prompt
            prompt = self._generate_insights_prompt(data_summary, data_source_name)

            # Get AI insights
            insights = await self._get_ai_analysis(prompt)

            return {
                "success": True,
                "insights": insights,
                "generated_at": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"❌ Data insights generation failed: {str(e)}")
            return {"success": False, "error": str(e)}

    def _prepare_data_summary(
        self, data: List[Dict[str, Any]], schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Prepare data summary for insights generation"""
        if not data:
            return {}

        # Calculate basic statistics
        summary = {
            "total_rows": len(data),
            "total_columns": len(schema.get("columns", [])),
            "column_types": schema.get("types", {}),
            "data_distribution": {},
        }

        # Analyze data distribution for each column
        for column in schema.get("columns", []):
            col_name = column["name"]
            col_type = column["type"]

            if col_type == "string":
                # Count unique values
                unique_values = set()
                for row in data:
                    if col_name in row and row[col_name] is not None:
                        unique_values.add(str(row[col_name]))

                summary["data_distribution"][col_name] = {
                    "type": "categorical",
                    "unique_count": len(unique_values),
                    "sample_values": list(unique_values)[:10],  # First 10 unique values
                }

            elif col_type in ["integer", "number"]:
                # Calculate numeric statistics
                values = []
                for row in data:
                    if col_name in row and row[col_name] is not None:
                        try:
                            values.append(float(row[col_name]))
                        except (ValueError, TypeError):
                            continue

                if values:
                    summary["data_distribution"][col_name] = {
                        "type": "numeric",
                        "min": min(values),
                        "max": max(values),
                        "mean": sum(values) / len(values),
                        "null_count": len([v for v in values if v is None]),
                    }

        return summary

    def _generate_insights_prompt(
        self, data_summary: Dict[str, Any], data_source_name: str
    ) -> str:
        """Generate insights prompt"""
        prompt = f"""
You are a data analyst expert. Analyze the following dataset summary and provide actionable insights.

Dataset: {data_source_name}

Data Summary:
{json.dumps(data_summary, indent=2)}

Please provide:
1. Key patterns and trends
2. Anomalies or data quality issues
3. Business opportunities and insights
4. Recommended visualizations
5. Actionable recommendations
6. Risk factors to consider

Format your response as JSON with the following structure:
{{
    "patterns": ["string"],
    "anomalies": ["string"],
    "business_insights": ["string"],
    "recommended_visualizations": [
        {{
            "type": "string",
            "description": "string",
            "columns": ["string"]
        }}
    ],
    "recommendations": ["string"],
    "risk_factors": ["string"]
}}
"""
        return prompt
