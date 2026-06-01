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

# ── Presidio bootstrap ────────────────────────────────────────────────────────
_presidio_analyzer = None
_presidio_anonymizer = None

try:
    from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig

    _base_analyzer = AnalyzerEngine()

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

    # Generic date of birth patterns (multiple regional formats)
    ("DATE_OF_BIRTH", re.compile(
        r"\b(?:"
        r"(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:19|20)\d{2}"  # DD/MM/YYYY
        r"|(?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])[/\-.](?:19|20)\d{2}"  # MM/DD/YYYY
        r"|(?:19|20)\d{2}[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])"  # YYYY/MM/DD (Asia)
        r")\b"
    )),

    # Generic passport (conservative — requires prefix letters to avoid false positives)
    ("PASSPORT", re.compile(r"\b[A-Z]{1,2}\d{6,9}\b")),
]


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
            return self._scrub_with_presidio(text)
        return self._scrub_with_regex(text)

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

    def scrub_schema_samples(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Scrub sample_data/sample_rows inside a schema dict before LLM ingestion.
        Returns a deep copy with values scrubbed.
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
                    table[key] = self.scrub_rows(raw)
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
            if not results:
                return text
            operators = {
                entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
                for entity in {r.entity_type for r in results}
            }
            anonymized = _presidio_anonymizer.anonymize(
                text=text, analyzer_results=results, operators=operators
            )
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
