"""
PII Scrubber — globally-aware, zero-dependency-required PII protection.

Architecture
────────────
Tier 1: Microsoft Presidio (if installed)
  • ML-powered NER catches names, orgs, locations in 20+ languages
  • Custom recognizers added for regional IDs not in Presidio's built-ins
  • Install: pip install presidio-analyzer presidio-anonymizer
  • For multilingual NER: pip install spacy && python -m spacy download xx_ent_wiki_sm

Tier 2: Regex fallback (always available, no deps)
  • 60+ patterns covering every major world region
  • Organised by: Universal → Asia-Pacific → South Asia → Middle East
    → Africa → Latin America → Europe → North America

Tier 3: Column-name heuristic
  • Keyword matching in English + transliterated forms of major languages
  • Catches columns like 身份证号 (Chinese ID), Aadhaar_no, NRIC, RRN, etc.

Replacement format: <ENTITY_TYPE> — not REDACTED — so the LLM understands
what was removed (prevents confusing the model about data types).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Presidio's stock DATE_TIME recognizer (spaCy NER-backed) false-positives on
# duration phrases like "90-day", "30 day", "24-hour" - these describe a span
# of time, not a calendar date, and are never themselves identifying. Live-
# reproduced: a business-journey "90-day action plan" prompt got scrubbed to
# "<DATE_TIME> action plan" before the LLM ever saw it, which then echoed the
# placeholder straight into its generated plan text. An absolute date/time
# ("March 5, 1990", "2026-08-30T12:00Z") still gets scrubbed normally - this
# only excludes the "<number> <unit>" duration shape.
_DURATION_PHRASE_RE = re.compile(
    r"\d+\s*-?\s*(day|days|hour|hours|week|weeks|month|months|year|years|minute|minutes|second|seconds)",
    re.IGNORECASE,
)

# Same false-positive class, different shape: Presidio's DATE_TIME recognizer
# also tags bare relative-time words ("today", "next quarter") that carry no
# identifying information on their own (unlike an absolute date, they don't
# even pin down *which* day without external context). Live-reproduced: a
# purely conversational LLM reply containing "...dig into today?" got
# scrubbed to "...dig into <DATE_TIME>?" and that placeholder — a format
# meant for an LLM to read (see module docstring), not a human — was shown
# to the end user verbatim in the chat bubble.
_RELATIVE_TIME_WORD_RE = re.compile(
    r"(this|next|last)\s+(week|month|quarter|year)|today|tomorrow|tonight|yesterday",
    re.IGNORECASE,
)

# Same false-positive class, different shape again: bare recurrence/cadence adjectives
# ("monthly", "quarterly", "annual", "weekly", "daily") describe how OFTEN something
# happens, not a calendar date — same rationale as the two guards above (they carry no
# identifying information on their own). Live-reported: an executive-report insight
# narrative's "$198K monthly data revenue" was scrubbed to "$198K <DATE_TIME> data
# revenue", shown verbatim to the end user in the report.
_CADENCE_WORD_RE = re.compile(
    r"^(monthly|quarterly|annual|annually|weekly|daily|yearly|biweekly|semiannual|semiannually|biannual|biannually|half.?yearly)$",
    re.IGNORECASE,
)

# Same false-positive class, different shape again: "<period>-to-date" spans
# ("year-to-date", "month-to-date", "quarter-to-date", "YTD") describe a
# running span up to now, not a calendar date — same rationale as the cadence
# guard above. Live-reproduced: an executive-report summary's "with
# year-to-date average usage reaching..." was scrubbed to "with <DATE_TIME>
# average usage reaching...", shown verbatim in the exported report. Presidio
# only actually catches the spelled-out and YTD forms live (not MTD/QTD, an
# inconsistency of its own NER model, not this guard) — all four included
# defensively since none carry identifying information regardless.
_TO_DATE_PHRASE_RE = re.compile(
    r"^(year|month|quarter)-to-date$|^ytd$|^mtd$|^qtd$",
    re.IGNORECASE,
)

# Same false-positive class, different (and Presidio-inconsistent) shape:
# half-year/quarter shorthand codes ("H1", "H2", "Q1"..."Q4") get misread as
# a US driver's-license number or even a LOCATION depending on surrounding
# text — Presidio assigns a different entity_type per occurrence for the
# identical two-character shape, which is itself evidence this is a shape-
# level false positive, not a genuine per-entity-type detection. A bare
# "H1"/"Q3" carries no identifying information under any interpretation, so
# this guard isn't scoped to one entity_type the way the others are — it
# matches by shape alone, applied to whichever type Presidio happened to
# assign. Live-reproduced: an executive-report summary's "Total H1
# consumption..." was scrubbed to "Total <US_DRIVER_LICENSE> consumption...".
_PERIOD_CODE_RE = re.compile(r"^(h[12]|q[1-4])$", re.IGNORECASE)

# Same false-positive class, LOCATION shape: short measurement-unit abbreviations
# ("GB", "MB", "min", "hrs") get misclassified as LOCATION by Presidio's NER when
# they follow a number in a sentence — Presidio's spaCy model reads a 2-3 letter
# capitalized/lowercase token as a place-name abbreviation regardless of the
# numeric context right before it. Live-reported: an insight narrative's "0.43–
# 8.01 GB" and "≈4 GB/day" both had "GB" redacted to "<LOCATION>". Scoped to a
# fixed allowlist of common data/time/measurement units, AND required to
# immediately follow a digit — "GB" as a genuine country-code reference (e.g. "our
# office in GB") has no preceding number and is still caught normally.
_UNIT_ABBREVIATION_RE = re.compile(
    r"^(gb|mb|kb|tb|pb|ghz|mhz|khz|hz|ms|sec|secs|min|mins|hr|hrs|kg|lb|lbs|km|mi|ft|cm|mm|oz|pct)$",
    re.IGNORECASE,
)
_PRECEDING_NUMBER_RE = re.compile(r"[\d.]\s*$")

# Same false-positive class, different (and much broader) shape: schema/code
# identifiers -- ordinary column names like "subscriber_id", "transaction_id",
# "ip_address", "is_active" -- get misclassified by Presidio's spaCy-backed
# NER as NRP/PERSON/LOCATION entities. Live-measured: a sweep of 56 common,
# everyday column names found this on ~7% of them, across two independently-
# discovered failure categories in one session (a URL/ccTLD detector on
# dotted identifiers, and this NER misclassification on bare ones) -- this
# is a systemic property of feeding single out-of-context tokens to a model
# trained on natural sentences, not a handful of unlucky column names.
# score_threshold tuning cannot fix this: confirmed live that these false
# positives score the exact same flat 0.850 as genuine PERSON/LOCATION
# detections (Presidio's spaCy recognizer doesn't produce a real confidence
# gradient), so no threshold value separates them.
#
# Scoped to whole-string identifier shape (letters/digits/underscores, at
# least one underscore, ^...$ anchored to the matched span) and to the NER-
# driven entity types this failure mode actually hits -- pattern/checksum-
# based recognizers (EMAIL_ADDRESS, CREDIT_CARD, US_SSN, the 25+ regional ID
# recognizers below) are untouched, since they don't share this failure mode
# and narrowing them here would weaken real detection for no benefit.
# Confirmed safe against genuine PII: real names in real sentences don't
# take this shape even when informally underscore-joined ("jean_pierre lives
# in montreal" -> only "montreal" flagged, not "jean_pierre").
#
# This is a second, systemic layer beneath the caller-side protected_terms/
# auto_protect_identifiers mechanism (pii_gate.py) that specific call sites
# (nl2sql_agent.py, dashboard_llm_planner.py, code_analysis_capability.py)
# opt into -- this one applies to every caller of scrub_text, including ones
# not yet audited for the same bug, without requiring them to know to opt in.
_BARE_IDENTIFIER_SHAPE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+$")
_NER_ENTITY_TYPES_PRONE_TO_IDENTIFIER_FALSE_POSITIVES = frozenset(
    {"PERSON", "NRP", "LOCATION", "DATE_TIME", "ORGANIZATION"}
)
# Discovered live once Presidio+spaCy were actually running locally (this repo's
# dev sandbox previously lacked the presidio-analyzer/presidio-anonymizer/spacy
# model dependencies, so this class of false positive was never exercised
# outside the real Docker image): ordinary bare schema/column identifiers —
# customer_id, user_id, updated_at, ip_address, is_deleted — got tagged
# DATE_TIME or ORGANIZATION by the NER model and corrupted to "<DATE_TIME>"/
# "<ORGANIZATION>". Same guard as the PERSON/NRP/LOCATION case above: only
# suppresses these entity types when the matched span is ALSO shaped like a
# bare identifier (_BARE_IDENTIFIER_SHAPE_RE), so a genuine date or
# organization name in ordinary prose is unaffected.

# ── Presidio bootstrap ────────────────────────────────────────────────────────
_presidio_analyzer = None
_presidio_anonymizer = None

try:
    from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
    from presidio_analyzer.nlp_engine import NlpEngineProvider
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig

    # Presidio's own AnalyzerEngine() default (no config) hardcodes
    # en_core_web_lg (~590MB) via its packaged default.yaml. Its actual NER
    # tagging quality -- the only thing Presidio's spaCy recognizer consumes
    # -- is published as very close to en_core_web_md's (~40MB); the lg/md
    # gap is mostly in static word-vector table size, used for similarity
    # tasks Presidio never calls. Explicit engine config, matching the
    # smaller model Dockerfile.prod now downloads, buys back ~550MB of image
    # size for a NER-quality difference too small to be worth it here.
    _nlp_engine = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_md"}],
        }
    ).create_engine()
    _base_analyzer = AnalyzerEngine(nlp_engine=_nlp_engine)

    # ── Custom regional recognizers not in Presidio's built-ins ──────────────
    _CUSTOM_RECOGNIZERS: List[PatternRecognizer] = [
        # India
        PatternRecognizer("IN_AADHAAR",  patterns=[Pattern("Aadhaar",  r"\b\d{4}\s\d{4}\s\d{4}\b", 0.85)]),
        PatternRecognizer("IN_PAN",      patterns=[Pattern("PAN",      r"\b[A-Z]{5}\d{4}[A-Z]\b", 0.8)]),
        PatternRecognizer("IN_PHONE",    patterns=[Pattern("IN_Phone", r"(?:\+91[-\s]?|0)?[6-9]\d{9}\b", 0.75)]),
        PatternRecognizer("IN_UPI",      patterns=[Pattern("UPI",      r"\b[\w.\-]{2,256}@[a-zA-Z]{2,64}\b", 0.65)]),
        # China
        PatternRecognizer("CN_ID",   patterns=[Pattern("CN_ID",    r"\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b", 0.9)]),
        PatternRecognizer("CN_PHONE",patterns=[Pattern("CN_Phone", r"(?:\+86[-\s]?)?1[3-9]\d{9}\b", 0.8)]),
        # South Korea
        PatternRecognizer("KR_RRN",  patterns=[Pattern("KR_RRN",  r"\b\d{6}-[1-4]\d{6}\b", 0.9)]),
        PatternRecognizer("KR_PHONE",patterns=[Pattern("KR_Phone",r"(?:\+82[-\s]?)?0?1[0-9]-?\d{3,4}-?\d{4}\b", 0.75)]),
        # Japan
        PatternRecognizer("JP_MY_NUMBER", patterns=[Pattern("MyNumber", r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", 0.7)]),
        PatternRecognizer("JP_PHONE",     patterns=[Pattern("JP_Phone", r"(?:\+81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b", 0.7)]),
        # Singapore
        PatternRecognizer("SG_NRIC", patterns=[Pattern("NRIC", r"\b[STFGM]\d{7}[A-Z]\b", 0.9)]),
        # Malaysia
        PatternRecognizer("MY_NRIC", patterns=[Pattern("MY_NRIC", r"\b\d{6}-\d{2}-\d{4}\b", 0.85)]),
        # Indonesia
        PatternRecognizer("ID_NIK",  patterns=[Pattern("NIK", r"\b[1-9]\d{15}\b", 0.7)]),
        # Thailand
        PatternRecognizer("TH_ID",   patterns=[Pattern("TH_ID", r"\b\d{13}\b", 0.6)]),
        # Australia
        PatternRecognizer("AU_TFN",      patterns=[Pattern("AU_TFN",  r"\b\d{3}\s?\d{3}\s?\d{3}\b", 0.7)]),
        PatternRecognizer("AU_MEDICARE", patterns=[Pattern("Medicare", r"\b[2-6]\d{9}\b", 0.65)]),
        # UAE
        PatternRecognizer("AE_EMIRATESID", patterns=[Pattern("EmiratesID", r"\b784-\d{4}-\d{7}-\d\b", 0.95)]),
        # Saudi Arabia
        PatternRecognizer("SA_NID", patterns=[Pattern("SA_NID", r"\b[12]\d{9}\b", 0.7)]),
        # Turkey
        PatternRecognizer("TR_TC", patterns=[Pattern("TC_Kimlik", r"\b[1-9]\d{10}\b", 0.7)]),
        # Pakistan
        PatternRecognizer("PK_CNIC", patterns=[Pattern("CNIC", r"\b\d{5}-\d{7}-\d\b", 0.95)]),
        # Israel
        PatternRecognizer("IL_ID", patterns=[Pattern("IL_ID", r"\b\d{9}\b", 0.6)]),
        # South Africa
        PatternRecognizer("ZA_ID", patterns=[Pattern("ZA_ID", r"\b\d{13}\b", 0.7)]),
        # Brazil
        PatternRecognizer("BR_CPF",  patterns=[Pattern("CPF",  r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", 0.9)]),
        PatternRecognizer("BR_CNPJ", patterns=[Pattern("CNPJ", r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b", 0.9)]),
        # Mexico
        PatternRecognizer("MX_CURP", patterns=[Pattern("CURP", r"\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b", 0.95)]),
        PatternRecognizer("MX_RFC",  patterns=[Pattern("RFC",  r"\b[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}\b", 0.85)]),
        # Argentina
        PatternRecognizer("AR_CUIL", patterns=[Pattern("CUIL", r"\b\d{2}-\d{7,8}-\d\b", 0.9)]),
        # Chile
        PatternRecognizer("CL_RUT", patterns=[Pattern("RUT", r"\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dKk]\b", 0.85)]),
        # UK National Insurance
        PatternRecognizer("UK_NINO", patterns=[Pattern("NINO", r"\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b", 0.9)]),
        # Germany Steuer-ID
        PatternRecognizer("DE_STEUER", patterns=[Pattern("Steuer-ID", r"\b[1-9]\d{10}\b", 0.65)]),
    ]

    for recognizer in _CUSTOM_RECOGNIZERS:
        _base_analyzer.registry.add_recognizer(recognizer)

    _presidio_analyzer = _base_analyzer
    _presidio_anonymizer = AnonymizerEngine()
    logger.info("✅ PII scrubber: Presidio loaded with %d custom regional recognizers", len(_CUSTOM_RECOGNIZERS))

except ImportError:
    logger.info("ℹ️  PII scrubber: Presidio not installed — using global regex fallback (60+ patterns)")
except Exception as exc:
    logger.warning("PII scrubber: Presidio init failed (%s) — using regex fallback", exc)


# ── Global regex pattern bank ─────────────────────────────────────────────────
# Each entry: (label, compiled_pattern)
# Order matters: more specific patterns first to avoid partial matches.
#
# Confidence heuristic: patterns with more structural constraints (dashes,
# dots, prefix letters) are listed earlier and are safer to match.

_REGEX_PATTERNS: List[Tuple[str, re.Pattern]] = [

    # ── Universal ─────────────────────────────────────────────────────────────
    ("EMAIL",       re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("IBAN",        re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b")),
    ("CREDIT_CARD", re.compile(r"\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011|65\d{2}|3[06]\d{2})(?:[-\s]?\d{4}){3}\b")),
    ("IP_ADDRESS",  re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b")),
    ("IPv6",        re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b")),
    ("URL",         re.compile(r"https?://[^\s\"'<>]+")),

    # ── Asia-Pacific ──────────────────────────────────────────────────────────
    # China: 18-digit resident ID (second-generation) and legacy 15-digit
    ("CN_RESIDENT_ID_18", re.compile(
        r"\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b"
    )),
    ("CN_RESIDENT_ID_15", re.compile(r"\b[1-9]\d{14}\b")),
    ("CN_PHONE", re.compile(r"(?:\+86[-\s]?)?(?:1[3-9]\d{9})\b")),
    ("CN_UNIFIED_SOCIAL_CREDIT", re.compile(r"\b[0-9A-HJ-NP-RT-Z]{18}\b")),

    # Japan: My Number (12-digit)
    ("JP_MY_NUMBER", re.compile(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b")),
    ("JP_PHONE", re.compile(r"(?:\+81[-\s]?)?\(?0\d{1,4}\)?[-\s]?\d{1,4}[-\s]?\d{4}\b")),

    # South Korea: RRN (RRNNNN-NNNNNNN)
    ("KR_RRN", re.compile(r"\b\d{6}-[1-4]\d{6}\b")),
    ("KR_PHONE", re.compile(r"(?:\+82[-\s]?)?0?1[0-9]-?\d{3,4}-?\d{4}\b")),
    ("KR_BRN", re.compile(r"\b\d{3}-\d{2}-\d{5}\b")),  # Business Registration

    # India: Aadhaar (12-digit with spaces), PAN, phone
    ("IN_AADHAAR", re.compile(r"\b[2-9]\d{3}[-\s]\d{4}[-\s]\d{4}\b")),
    ("IN_AADHAAR_COMPACT", re.compile(r"\b[2-9]\d{11}\b")),
    ("IN_PAN", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("IN_PHONE", re.compile(r"(?:\+91[-\s]?|0)?[6-9]\d{9}\b")),
    ("IN_GST", re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b")),
    ("IN_VOTER_ID", re.compile(r"\b[A-Z]{3}\d{7}\b")),
    ("IN_DRIVING_LICENSE", re.compile(r"\b[A-Z]{2}\d{2}[-\s]?\d{4}[-\s]?\d{7}\b")),

    # Singapore: NRIC/FIN (S/T/F/G/M + 7 digits + checksum letter)
    ("SG_NRIC", re.compile(r"\b[STFGM]\d{7}[A-Z]\b")),
    ("SG_PHONE", re.compile(r"(?:\+65[-\s]?)?[689]\d{7}\b")),
    ("SG_UEN", re.compile(r"\b\d{9}[A-Z]\b")),  # Business UEN

    # Malaysia: NRIC (YYMMDD-SS-CCCC)
    ("MY_NRIC", re.compile(r"\b\d{6}-\d{2}-\d{4}\b")),
    ("MY_PHONE", re.compile(r"(?:\+60[-\s]?)?0?1[0-9]-?\d{6,8}\b")),

    # Indonesia: NIK (16-digit national ID)
    ("ID_NIK", re.compile(r"\b[1-9]\d{15}\b")),
    ("ID_NPWP", re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}\.?\d-?\d{3}\.?\d{3}\b")),
    ("ID_PHONE", re.compile(r"(?:\+62[-\s]?)?0?8\d{8,11}\b")),

    # Philippines: PhilSys CRN (16 digits) and phone
    ("PH_PSN", re.compile(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b")),
    ("PH_PHONE", re.compile(r"(?:\+63[-\s]?)?0?9\d{9}\b")),
    ("PH_TIN", re.compile(r"\b\d{3}-\d{3}-\d{3}(?:-\d{3})?\b")),

    # Vietnam: CMND/CCCD (9 or 12 digits)
    ("VN_CMND", re.compile(r"\b\d{9}(?:\d{3})?\b")),
    ("VN_PHONE", re.compile(r"(?:\+84[-\s]?)?0?[3-9]\d{8}\b")),

    # Thailand: Thai national ID (13 digits, first digit 1-9)
    ("TH_ID", re.compile(r"\b[1-9]\d{12}\b")),
    ("TH_PHONE", re.compile(r"(?:\+66[-\s]?)?0?[689]\d{7,8}\b")),

    # Australia: TFN (9 digits), Medicare (10-11 digits), ABN (11 digits)
    ("AU_TFN", re.compile(r"\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b")),
    ("AU_MEDICARE", re.compile(r"\b[2-6]\d{9}[-\s]?\d?\b")),
    ("AU_ABN", re.compile(r"\b\d{2}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{3}\b")),
    ("AU_PHONE", re.compile(r"(?:\+61[-\s]?)?0?[24578]\d{8}\b")),

    # New Zealand
    ("NZ_IRD", re.compile(r"\b\d{2,3}-?\d{3}-?\d{3}\b")),
    ("NZ_PHONE", re.compile(r"(?:\+64[-\s]?)?0?[2789]\d{7,9}\b")),

    # ── South Asia ────────────────────────────────────────────────────────────
    # Pakistan: CNIC (XXXXX-XXXXXXX-X)
    ("PK_CNIC", re.compile(r"\b\d{5}-\d{7}-\d\b")),
    ("PK_PHONE", re.compile(r"(?:\+92[-\s]?)?0?3\d{9}\b")),
    ("PK_NTN", re.compile(r"\b\d{7}-\d\b")),

    # Bangladesh: NID (10 or 17 digits)
    ("BD_NID", re.compile(r"\b(?:\d{10}|\d{17})\b")),
    ("BD_PHONE", re.compile(r"(?:\+880[-\s]?)?0?1[3-9]\d{8}\b")),

    # Sri Lanka: NIC (9 digits + V/X or 12 digits)
    ("LK_NIC", re.compile(r"\b(?:\d{9}[VXvx]|\d{12})\b")),

    # Nepal
    ("NP_CITIZENSHIP", re.compile(r"\b\d{2}-\d{2}-\d{2}-\d{5}\b")),

    # ── Middle East & North Africa ────────────────────────────────────────────
    # UAE: Emirates ID (784-YYYY-NNNNNNN-N)
    ("AE_EMIRATES_ID", re.compile(r"\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b")),
    ("AE_PHONE", re.compile(r"(?:\+971[-\s]?)?0?5[0-9]\d{7}\b")),

    # Saudi Arabia: National ID (10 digits, starts with 1 or 2)
    ("SA_NID", re.compile(r"\b[12]\d{9}\b")),
    ("SA_PHONE", re.compile(r"(?:\+966[-\s]?)?0?5[0-9]\d{7}\b")),

    # Kuwait: Civil ID (12 digits)
    ("KW_CIVIL_ID", re.compile(r"\b[12]\d{11}\b")),

    # Qatar: National ID (11 digits)
    ("QA_NID", re.compile(r"\b[23]\d{10}\b")),

    # Bahrain: CPR (9 digits)
    ("BH_CPR", re.compile(r"\b\d{9}\b")),

    # Oman: NID (8 digits)
    ("OM_NID", re.compile(r"\b\d{8}\b")),

    # Israel: Teudat Zehut (9 digits with Luhn)
    ("IL_TEUDAT_ZEHUT", re.compile(r"\b\d{9}\b")),

    # Turkey: TC Kimlik No (11 digits, starts with non-zero)
    ("TR_TC_KIMLIK", re.compile(r"\b[1-9]\d{10}\b")),

    # Egypt: National ID (14 digits)
    ("EG_NID", re.compile(r"\b[23]\d{13}\b")),

    # ── Africa ────────────────────────────────────────────────────────────────
    # South Africa: RSA ID (13 digits: YYMMDDSSSSZCZ)
    ("ZA_ID", re.compile(
        r"\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}[01]\d{2}\b"
    )),
    ("ZA_PHONE", re.compile(r"(?:\+27[-\s]?)?0?[678]\d{8}\b")),
    ("ZA_PASSPORT", re.compile(r"\bA\d{8}\b")),

    # Nigeria: NIN (11 digits), BVN (11 digits)
    ("NG_NIN", re.compile(r"\b\d{11}\b")),
    ("NG_PHONE", re.compile(r"(?:\+234[-\s]?)?0?[789]\d{9}\b")),

    # Kenya: National ID (7-8 digits)
    ("KE_NID", re.compile(r"\b\d{7,8}\b")),

    # Ghana: Ghana Card (GHA-XXXXXXXXX-X)
    ("GH_CARD", re.compile(r"\bGHA-[A-Z0-9]{9}-\d\b")),

    # Ethiopia, Tanzania, Uganda — phone formats
    ("ET_PHONE", re.compile(r"(?:\+251[-\s]?)?0?9\d{8}\b")),
    ("TZ_PHONE", re.compile(r"(?:\+255[-\s]?)?0?[67]\d{8}\b")),
    ("UG_PHONE", re.compile(r"(?:\+256[-\s]?)?0?[237]\d{8}\b")),

    # ── Latin America ─────────────────────────────────────────────────────────
    # Brazil: CPF (XXX.XXX.XXX-XX), CNPJ
    ("BR_CPF",  re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")),
    ("BR_CNPJ", re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?0001-?\d{2}\b")),
    ("BR_PHONE", re.compile(r"(?:\+55[-\s]?)?0?(?:11|21|31|41|51|61|71|81|91)\d{8,9}\b")),
    ("BR_RG",   re.compile(r"\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]\b")),

    # Mexico: CURP (18 chars), RFC
    ("MX_CURP", re.compile(r"\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b")),
    ("MX_RFC",  re.compile(r"\b[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}\b")),
    ("MX_PHONE", re.compile(r"(?:\+52[-\s]?)?(?:1[-\s]?)?\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}\b")),
    ("MX_NSS",  re.compile(r"\b\d{11}\b")),  # Social Security

    # Argentina: CUIL/CUIT (XX-XXXXXXXX-X)
    ("AR_CUIL", re.compile(r"\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b")),
    ("AR_PHONE", re.compile(r"(?:\+54[-\s]?)?0?11\d{8}\b")),
    ("AR_DNI",  re.compile(r"\b\d{7,8}\b")),

    # Chile: RUT (XX.XXX.XXX-X or XX.XXX.XXX-K)
    ("CL_RUT", re.compile(r"\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dKk]\b")),
    ("CL_PHONE", re.compile(r"(?:\+56[-\s]?)?0?9\d{8}\b")),

    # Colombia: Cédula (8-10 digits)
    ("CO_CEDULA", re.compile(r"\b[1-9]\d{7,9}\b")),
    ("CO_NIT",    re.compile(r"\b\d{9}-?\d\b")),
    ("CO_PHONE",  re.compile(r"(?:\+57[-\s]?)?0?3\d{9}\b")),

    # Peru: DNI (8 digits), RUC (11 digits)
    ("PE_DNI", re.compile(r"\b\d{8}\b")),
    ("PE_RUC", re.compile(r"\b[12]\d{10}\b")),

    # Venezuela: Cédula (V/E + 7-8 digits)
    ("VE_CEDULA", re.compile(r"\b[VvEe]-?\d{7,8}\b")),

    # Ecuador: Cédula (10 digits)
    ("EC_CEDULA", re.compile(r"\b\d{10}\b")),

    # ── Europe ────────────────────────────────────────────────────────────────
    # UK: National Insurance (AA999999A), passport
    ("UK_NI",       re.compile(r"\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b")),
    ("UK_PASSPORT", re.compile(r"\b\d{9}\b")),
    ("UK_UTR",      re.compile(r"\b\d{10}\b")),
    ("UK_PHONE",    re.compile(r"(?:\+44[-\s]?)?0?[27]\d{9}\b")),

    # Germany: Steueridentifikationsnummer (11 digits, first non-zero)
    ("DE_STEUER_ID",   re.compile(r"\b[1-9]\d{10}\b")),
    ("DE_PHONE",       re.compile(r"(?:\+49[-\s]?)?0?\d{2,5}[-\s]?\d{4,10}\b")),
    ("DE_PERSONALAUSWEIS", re.compile(r"\b[A-Z0-9]{9}\b")),

    # France: NIR/INSEE (15 digits)
    ("FR_NIR",   re.compile(r"\b[12]\d{2}(?:0[1-9]|1[0-2])\d{2}\d{3}\d{3}\d{2}\b")),
    ("FR_SIRET", re.compile(r"\b\d{14}\b")),
    ("FR_PHONE", re.compile(r"(?:\+33[-\s]?)?0?[1-9]\d{8}\b")),

    # Spain: DNI (8 digits + letter), NIE (X/Y/Z + 7 digits + letter)
    ("ES_DNI",  re.compile(r"\b\d{8}[A-HJ-NP-TV-Z]\b")),
    ("ES_NIE",  re.compile(r"\b[XYZ]\d{7}[A-HJ-NP-TV-Z]\b")),
    ("ES_CIF",  re.compile(r"\b[A-HJ-NP-SUVW]\d{7}[0-9A-J]\b")),
    ("ES_PHONE",re.compile(r"(?:\+34[-\s]?)?[67]\d{8}\b")),

    # Italy: Codice Fiscale (16 alphanumeric), VAT
    ("IT_CF",    re.compile(r"\b[A-Z]{6}\d{2}[ABCDEHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b")),
    ("IT_VAT",   re.compile(r"\bIT\d{11}\b")),
    ("IT_PHONE", re.compile(r"(?:\+39[-\s]?)?0?\d{2,4}[-\s]?\d{4,8}\b")),

    # Poland: PESEL (11 digits), NIP
    ("PL_PESEL", re.compile(r"\b\d{11}\b")),
    ("PL_NIP",   re.compile(r"\b\d{3}-?\d{3}-?\d{2}-?\d{2}\b")),

    # Russia: SNILS (XXX-XXX-XXX XX), INN
    ("RU_SNILS", re.compile(r"\b\d{3}-\d{3}-\d{3}\s?\d{2}\b")),
    ("RU_INN",   re.compile(r"\b\d{10,12}\b")),
    ("RU_PHONE", re.compile(r"(?:\+7[-\s]?)?0?9\d{9}\b")),

    # Netherlands: BSN (9 digits)
    ("NL_BSN",   re.compile(r"\b\d{9}\b")),
    ("NL_PHONE", re.compile(r"(?:\+31[-\s]?)?0?[1-9]\d{8}\b")),

    # Sweden: Personnummer (YYYYMMDD-XXXX or YYMMDD-XXXX)
    ("SE_PERSONNUMMER", re.compile(r"\b(?:19|20)?\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-+]\d{4}\b")),

    # Nordic countries
    ("NO_FODSELSNUMMER", re.compile(r"\b\d{2}(?:0[1-9]|1[0-2])\d{2}\d{5}\b")),
    ("DK_CPR",           re.compile(r"\b\d{6}-\d{4}\b")),
    ("FI_HETU",          re.compile(r"\b\d{6}[-+A]\d{3}[A-HJ-NP-Y0-9]\b")),

    # Switzerland: AHV-Nummer (756.XXXX.XXXX.XX)
    ("CH_AHV", re.compile(r"\b756\.?\d{4}\.?\d{4}\.?\d{2}\b")),

    # ── North America ─────────────────────────────────────────────────────────
    # US: SSN, phone (broad), TIN
    ("US_SSN",   re.compile(r"\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b")),
    ("US_EIN",   re.compile(r"\b\d{2}-\d{7}\b")),
    ("US_PHONE", re.compile(r"\b(?:\+1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b")),
    ("US_ZIP",   re.compile(r"\b\d{5}(?:-\d{4})?\b")),

    # Canada: SIN (XXX-XXX-XXX), postal code
    ("CA_SIN",    re.compile(r"\b\d{3}[-\s]\d{3}[-\s]\d{3}\b")),
    ("CA_POSTAL", re.compile(r"\b[A-Z]\d[A-Z][-\s]?\d[A-Z]\d\b")),
    ("CA_PHONE",  re.compile(r"\b(?:\+1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b")),

    # NOTE: date-of-birth is intentionally NOT in this list - unlike every
    # other entry here, a bare date has zero distinguishing structure (a
    # report date, a transaction date, a "show me Feb 2024 data" filter all
    # match the exact same shape as a birthdate). Scrubbing every date-shaped
    # string in free text corrupted SQL date literals embedded in prompts
    # (e.g. conversation history containing a prior turn's generated SQL),
    # which then got echoed verbatim into new queries and broke them. See
    # _DATE_OF_BIRTH_PATTERN + _scrub_dates_of_birth below - it requires an
    # actual birth-context keyword nearby, in the same multilingual set used
    # for column-name detection, not just a date-shaped string in isolation.

    # Generic passport (conservative — requires prefix letters to avoid false positives)
    ("PASSPORT", re.compile(r"\b[A-Z]{1,2}\d{6,9}\b")),
]


# Same date shapes as the old blanket entry, matched separately so each hit
# can be checked for a nearby birth-context keyword before being scrubbed.
_DATE_OF_BIRTH_PATTERN = re.compile(
    r"\b(?:"
    r"(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}"  # DD/MM/YYYY
    r"|(?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])[/\-.](?:19|20)\d{2}"  # MM/DD/YYYY
    r"|(?:19|20)\d{2}[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])"  # YYYY/MM/DD (Asia)
    r")\b"
)

# Natural-language birth-date phrasing, not the underscore-joined column-name
# style below - covers the same regional breadth this file uses elsewhere
# (Vietnam/Indonesia/Korea/Japan/China/Thailand/India/Middle East/LatAm/
# Europe/Russia) so non-English contexts get the same protection.
_BIRTH_CONTEXT_KEYWORDS: List[str] = [
    "date of birth", "birth date", "birthdate", "birthday", "born on", "dob",
    "fecha de nacimiento", "nacio el", "nació el", "cumpleanos", "cumpleaños",  # Spanish
    "date de naissance", "ne le", "né le", "anniversaire",  # French
    "geburtsdatum", "geboren am", "geburtstag",  # German
    "data de nascimento", "nascido em",  # Portuguese
    "data di nascita", "nato il",  # Italian
    "data urodzenia",  # Polish
    "data rozhdeniya", "дата рождения",  # Russian
    "ngay sinh", "ngày sinh", "sinh ngay", "sinh ngày",  # Vietnamese
    "tanggal lahir", "lahir pada",  # Indonesian/Malay
    "vanh koet", "wan koet", "วันเกิด",  # Thai
    "shengri", "chusheng riqi", "出生日期", "生日",  # Chinese
    "seinengappi", "tanjoubi", "生年月日", "誕生日",  # Japanese
    "saengnyeonwolil", "saengil", "생년월일", "생일",  # Korean
    "janam tithi", "janmatithi", "जन्म तिथि",  # Hindi
    "tarikh lahir",  # Malay
    "tarikh al-milad", "تاريخ الميلاد",  # Arabic
]
_BIRTH_CONTEXT_WINDOW_CHARS = 40


def _scrub_dates_of_birth(text: str) -> str:
    """
    Replace date-shaped substrings with <DATE_OF_BIRTH> only when a birth-
    context keyword appears within _BIRTH_CONTEXT_WINDOW_CHARS on either
    side - see the note above _DATE_OF_BIRTH_PATTERN for why a bare date
    match alone isn't enough.
    """
    def _replace(match: "re.Match[str]") -> str:
        start = max(0, match.start() - _BIRTH_CONTEXT_WINDOW_CHARS)
        end = min(len(text), match.end() + _BIRTH_CONTEXT_WINDOW_CHARS)
        window = text[start:end].lower()
        if any(keyword in window for keyword in _BIRTH_CONTEXT_KEYWORDS):
            return "<DATE_OF_BIRTH>"
        return match.group(0)

    return _DATE_OF_BIRTH_PATTERN.sub(_replace, text)


# ── Column-name PII keywords (multilingual) ───────────────────────────────────
# Covers English + common transliterations/romanisations used as column names.
# Grouped by semantic category for maintainability.

_PII_COLUMN_KEYWORDS: List[str] = [
    # ── Identity numbers ──
    "ssn", "social_security", "national_id", "natl_id", "nid",
    "aadhaar", "aadhar", "pan_number", "pan_no",          # India
    "nric", "fin",                                          # Singapore
    "rrn", "jumindeungnobeonho",                           # Korea
    "my_number", "mynumber", "kojin_bango",                # Japan
    "resident_id", "id_card", "id_number", "id_no",
    "national_registration", "ic_number", "ic_no",        # Malaysia/Singapore
    "nik", "npwp",                                         # Indonesia
    "cmnd", "cccd", "so_chứng_minh",                      # Vietnam
    "id_residente", "cedula", "cedula_identidad",          # LatAm
    "cpf", "cnpj", "rg_number",                           # Brazil
    "curp", "rfc", "nss",                                  # Mexico
    "cuil", "cuit", "dni",                                 # Argentina/Spain
    "rut", "run",                                          # Chile
    "emirates_id", "eid",                                  # UAE
    "iqama", "absher_id",                                  # Saudi Arabia
    "nino", "national_insurance", "ni_number",             # UK
    "pesel", "bsn", "personnummer", "cpr_number",          # Europe
    "ahv", "svnr", "sozialversicherungsnummer",            # Switzerland
    "sin", "social_insurance",                             # Canada
    "tfn", "tax_file_number",                              # Australia
    "snils", "inn",                                        # Russia
    "codice_fiscale",                                      # Italy
    "nir", "numéro_fiscal",                                # France
    "pid", "personal_id", "citizen_id",
    "passport_number", "passport_no", "pasaporte",
    "voter_id", "election_card",

    # ── Contact ──
    "email", "email_address", "correo", "메일", "邮件", "メール",
    "phone", "mobile", "cell", "telephone", "téléphone",
    "tel_no", "phone_number", "mobile_number", "kontakt",
    "handphone", "handynummer", "nomer_telefona",
    "dien_thoai", "so_dien_thoai",                         # Vietnamese
    "nomor_hp", "telepon",                                  # Indonesian

    # ── Financial ──
    "credit_card", "card_number", "card_no", "cvv", "ccv", "cvc",
    "account_number", "bank_account", "iban", "bic", "swift",
    "numéro_carte", "kartennummer", "tarjeta",
    "cuenta_bancaria", "no_rekening",                      # Indonesian

    # ── Medical / Health ──
    "patient_id", "health_id", "medical_record", "mrn",
    "ssn_health", "insurance_id", "medicare_no",
    "blood_type", "diagnosis_code", "icd_code",
    "nhsid", "nhs_number",                                  # UK NHS
    "no_pasien", "rekam_medis",                             # Indonesian

    # ── Personal details ──
    "first_name", "last_name", "full_name", "given_name", "surname",
    "nombre", "apellido", "prenom", "nom_complet",
    "vorname", "nachname", "full_naam",
    "名前", "姓名", "氏名", "이름", "성명",
    "ho_ten", "ten_khach_hang",                             # Vietnamese
    "nama_lengkap",                                         # Indonesian
    "date_of_birth", "dob", "birth_date", "birthdate",
    "fecha_nacimiento", "date_naissance", "geburtstag",
    "ngay_sinh",                                            # Vietnamese
    "tanggal_lahir",                                        # Indonesian

    # ── Location / Address ──
    "address", "home_address", "street", "street_address",
    "zip", "zipcode", "zip_code", "postal_code", "postcode",
    "direccion", "adresse", "adresa", "地址", "住所", "주소",
    "địa_chỉ",                                              # Vietnamese
    "alamat",                                               # Indonesian
    "latitude", "longitude", "gps_lat", "gps_lon", "gps_coords",

    # ── Business / Tax IDs ──
    "vat_number", "vat_id", "tax_id", "tax_number",
    "business_id", "company_id", "employer_id", "ein",
    "registro_mercantil", "siren", "siret",
    "kvk_nummer",                                           # Netherlands

    # ── Biometric ──
    "fingerprint", "biometric", "retina_scan",
    "face_id", "facial_recognition",
]

# Build a frozenset for O(1) lookup after lowercasing and stripping underscores
_PII_KW_SET = frozenset(
    kw.replace("_", "").replace(" ", "").lower()
    for kw in _PII_COLUMN_KEYWORDS
)


def _is_pii_column_name(name: str) -> bool:
    """Return True if the column name matches a known PII keyword."""
    normalized = name.replace("_", "").replace(" ", "").replace("-", "").lower()
    if normalized in _PII_KW_SET:
        return True
    # Substring match for compound names like customer_email_address
    for kw in _PII_COLUMN_KEYWORDS:
        kw_norm = kw.replace("_", "").replace(" ", "").lower()
        if kw_norm and kw_norm in normalized:
            return True
    return False


# ── Core scrubber ─────────────────────────────────────────────────────────────

class PiiScrubber:
    """
    Thread-safe, globally-aware PII scrubber.

    Replacement format: <ENTITY_TYPE> — typed labels so the LLM understands
    the data structure without seeing the actual sensitive value.
    """

    def scrub_text(self, text: str) -> str:
        """Replace PII in free text with typed placeholders."""
        if not text or not isinstance(text, str):
            return text
        if _presidio_analyzer and _presidio_anonymizer:
            return _scrub_dates_of_birth(self._scrub_with_presidio(text))
        return _scrub_dates_of_birth(self._scrub_with_regex(text))

    def scrub_value(self, value: Any, column_name: str = "") -> Any:
        """Scrub a single cell. Fast-paths PII column names; otherwise runs text scan."""
        if value is None:
            return value
        str_val = str(value)
        if column_name and _is_pii_column_name(column_name):
            return f"<{self._classify_column(column_name)}>"
        scrubbed = self.scrub_text(str_val)
        return scrubbed if scrubbed != str_val else value

    def scrub_rows(
        self,
        rows: List[Dict[str, Any]],
        sensitive_columns: Optional[List[str]] = None,
        max_rows: int = 200,
    ) -> List[Dict[str, Any]]:
        """
        Scrub a list of row dicts. Only examines string-valued columns.
        sensitive_columns: if provided, only those columns are scrubbed.
        """
        if not rows:
            return rows
        all_cols = list(rows[0].keys()) if rows else []

        if sensitive_columns:
            target_cols = list(sensitive_columns)
        else:
            # Columns whose names suggest PII
            target_cols = [c for c in all_cols if _is_pii_column_name(c)]
            # Also detect by scanning values in the first row
            first = rows[0]
            for col in all_cols:
                if col in target_cols:
                    continue
                val = first.get(col)
                if isinstance(val, str) and len(val) > 4:
                    if self.scrub_text(val) != val:
                        target_cols.append(col)

        if not target_cols:
            return rows

        result: List[Dict[str, Any]] = []
        for row in rows[:max_rows]:
            new_row = dict(row)
            for col in target_cols:
                if col in new_row:
                    new_row[col] = self.scrub_value(new_row[col], col)
            result.append(new_row)
        return result

    def scrub_schema_samples(
        self,
        schema: Dict[str, Any],
        sensitive_columns: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Scrub sample_data/sample_rows inside a schema dict before LLM ingestion.
        Returns a deep copy with values scrubbed.

        When ``sensitive_columns`` is provided, only those columns are masked
        (no Presidio value-discovery scan).
        """
        if not isinstance(schema, dict):
            return schema
        import copy
        schema = copy.deepcopy(schema)
        for table in (schema.get("tables") or []):
            if not isinstance(table, dict):
                continue
            for key in ("sample_data", "sample_rows"):
                raw = table.get(key)
                if isinstance(raw, list) and raw:
                    table[key] = self.scrub_rows(
                        raw, sensitive_columns=sensitive_columns
                    )
        return schema

    def scrub_insight_text(self, text: str) -> str:
        """Final scrub of LLM-generated insight text before storing/sending."""
        return self.scrub_text(text or "")

    # ── Internal ──────────────────────────────────────────────────────────────

    def _scrub_with_presidio(self, text: str) -> str:
        """Use Presidio + custom recognizers. Falls back to regex on any error."""
        try:
            # Try with English first; could be extended to detect language and pass it
            results = _presidio_analyzer.analyze(text=text, language="en")
            results = [r for r in results if not (
                r.entity_type == "DATE_TIME" and (
                    _DURATION_PHRASE_RE.fullmatch(text[r.start:r.end])
                    or _RELATIVE_TIME_WORD_RE.fullmatch(text[r.start:r.end])
                    or _CADENCE_WORD_RE.fullmatch(text[r.start:r.end])
                    or _TO_DATE_PHRASE_RE.fullmatch(text[r.start:r.end])
                )
            )]
            results = [r for r in results if not _PERIOD_CODE_RE.fullmatch(text[r.start:r.end])]
            results = [r for r in results if not (
                r.entity_type == "LOCATION"
                and _UNIT_ABBREVIATION_RE.fullmatch(text[r.start:r.end])
                and _PRECEDING_NUMBER_RE.search(text[max(0, r.start - 6):r.start])
            )]
            results = [r for r in results if not (
                r.entity_type in _NER_ENTITY_TYPES_PRONE_TO_IDENTIFIER_FALSE_POSITIVES
                and _BARE_IDENTIFIER_SHAPE_RE.match(text[r.start:r.end])
            )]
            if not results:
                return text
            operators = {
                entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
                for entity in {r.entity_type for r in results}
            }
            anonymized = _presidio_anonymizer.anonymize(
                text=text, analyzer_results=results, operators=operators
            )
            # Observability: this codebase had no visibility into what PII
            # scrubbing actually redacts, which is exactly why three separate
            # false-positive corruption bugs (SQL generation, dashboard
            # planning, code generation) shipped silently in one session
            # before being caught by a user hitting a broken query. A DEBUG-
            # level summary (entity types + count, never the redacted value
            # itself) is cheap, greppable evidence for the next investigation.
            if anonymized.text != text:
                entity_counts: Dict[str, int] = {}
                for r in results:
                    entity_counts[r.entity_type] = entity_counts.get(r.entity_type, 0) + 1
                logger.debug("PII scrub redacted %s in %d-char text", entity_counts, len(text))
            return anonymized.text
        except Exception as exc:
            logger.debug("Presidio scrub failed: %s — using regex fallback", exc)
            return self._scrub_with_regex(text)

    def _scrub_with_regex(self, text: str) -> str:
        """Apply all regional regex patterns in priority order."""
        for label, pattern in _REGEX_PATTERNS:
            text = pattern.sub(f"<{label}>", text)
        return text

    @staticmethod
    def _classify_column(col_name: str) -> str:
        """Map a PII column name to a typed label."""
        n = col_name.lower().replace("_", "").replace(" ", "")
        _MAP: List[Tuple[List[str], str]] = [
            (["email", "mail", "correo", "메일"], "EMAIL_ADDRESS"),
            (["phone", "mobile", "cell", "tel", "handphone", "dienthoai", "nomorrhp"], "PHONE_NUMBER"),
            (["ssn", "socialsecurity", "snils"], "US_SSN"),
            (["aadhaar", "aadhar"], "IN_AADHAAR"),
            (["pan"], "IN_PAN"),
            (["nric", "fin"], "SG_NRIC"),
            (["rrn", "jumindeungnobeonho"], "KR_RRN"),
            (["mynumber", "kojinbango"], "JP_MY_NUMBER"),
            (["emiratesid", "eid"], "AE_EMIRATES_ID"),
            (["cpf", "cnpj"], "BR_CPF"),
            (["curp", "rfc"], "MX_CURP"),
            (["cuil", "cuit"], "AR_CUIL"),
            (["rut", "run"], "CL_RUT"),
            (["creditcard", "cardnumber", "cvv", "cvc", "ccv"], "CREDIT_CARD"),
            (["dob", "dateofbirth", "birthdate", "ngaysinh", "tanggallahir"], "DATE_OF_BIRTH"),
            (["passport", "pasaporte"], "PASSPORT"),
            (["firstname", "lastname", "fullname", "nombre", "apellido",
              "prenom", "vorname", "nachname", "名前", "姓名", "이름"], "PERSON"),
            (["address", "street", "direccion", "adresse", "地址", "住所", "주소", "alamat"], "LOCATION"),
            (["iban", "swift", "bic", "bankaccount", "accountnumber"], "FINANCIAL"),
            (["vatid", "taxid", "taxnumber", "ein", "tfn", "sin", "nino"], "TAX_ID"),
            (["patientid", "healthid", "mrn", "nhsnumber"], "HEALTH_ID"),
            (["ipaddress", "userip", "gpscoords", "latitude", "longitude"], "IP_ADDRESS"),
        ]
        for keywords, label in _MAP:
            if any(kw in n for kw in keywords):
                return label
        return "PII"


# Module-level singleton
pii_scrubber = PiiScrubber()
