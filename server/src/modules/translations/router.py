"""
Translation API — server-side endpoint for generating translations using LiteLLM/Gemini.

Accepts a source JSON translation file and target language code,
returns the translated JSON using the configured LLM model.
"""

import json
import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/translations", tags=["translations"])

# In-memory cache to avoid re-translating identical content
_translation_cache: Dict[str, Dict[str, Any]] = {}


class TranslateRequest(BaseModel):
    source_messages: Dict[str, Any] = Field(..., description="Source translation JSON (typically English)")
    target_language: str = Field(..., description="Target language code, e.g. 'fr', 'es', 'zh'")
    target_language_name: str = Field("", description="Human-readable language name, e.g. 'French'")


class TranslateResponse(BaseModel):
    language: str
    messages: Dict[str, Any]
    cached: bool = False


@router.post("/generate", response_model=TranslateResponse)
async def generate_translations(req: TranslateRequest):
    """Generate translations for a target language using LLM (Gemini via LiteLLM)."""

    cache_key = f"{req.target_language}:{hash(json.dumps(req.source_messages, sort_keys=True))}"
    if cache_key in _translation_cache:
        return TranslateResponse(
            language=req.target_language,
            messages=_translation_cache[cache_key],
            cached=True,
        )

    try:
        import litellm
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="LiteLLM is not installed. Install it with: pip install litellm",
        )

    lang_name = req.target_language_name or req.target_language
    source_json = json.dumps(req.source_messages, ensure_ascii=False, indent=2)

    prompt = f"""Translate the following JSON translation file from English to {lang_name}.

Rules:
- Keep all JSON keys exactly the same (do not translate keys).
- Only translate the string values.
- Do NOT translate placeholder variables like {{name}}, {{plan}}, {{count}}, {{time}}, {{percent}}, {{mode}}.
- Do NOT translate brand names: "Aicser", "Dataticon", "Chat2Chart", "Stripe".
- Keep technical terms like "API", "SQL", "BI", "Lakehouse" as-is.
- Return ONLY valid JSON, no markdown, no explanation.

Source JSON:
{source_json}"""

    try:
        response = await litellm.acompletion(
            model="gemini/gemini-2.0-flash",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=16000,
        )

        content = response.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if content.startswith("```"):
            lines = content.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            content = "\n".join(lines)

        translated = json.loads(content)

        _translation_cache[cache_key] = translated

        return TranslateResponse(
            language=req.target_language,
            messages=translated,
            cached=False,
        )
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM translation response: {e}")
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON")
    except Exception as e:
        logger.error(f"Translation generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")
