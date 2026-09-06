"""Golden-set regression net for PII-scrubber false positives on ordinary
schema identifiers (column/table names) -- the systemic issue behind three
independent live bugs found in one session: NL2SQL SQL generation
(nl2sql_agent.py), dashboard plan generation (dashboard_llm_planner.py), and
pandas code generation (code_analysis_capability.py) all had real column
names corrupted mid-token by pii_scrubber's underlying Presidio NER model.

Two layers of defense now exist, and this file tests both:

1. Caller-side, opt-in (pii_gate.py's protected_terms/auto_protect_identifiers):
   the specific fix applied to the three call sites above. Still the only
   defense for DOTTED identifiers (table.column shapes like
   "education.grades" -> "<URL>ades", a URL/ccTLD false positive), since the
   scrubber-level fix below is scoped to bare (non-dotted) identifiers only.

2. Scrubber-level, systemic (pii_scrubber.py's _BARE_IDENTIFIER_SHAPE_RE):
   added after live-measuring a ~7% false-positive rate on 56 ordinary
   column names (subscriber_id -> NRP, transaction_id -> PERSON, etc, all at
   the identical flat 0.850 confidence score genuine PERSON/LOCATION
   detections get -- confidence-threshold tuning cannot fix this). Excludes
   NER-driven PERSON/NRP/LOCATION hits on whole-string snake_case-shaped
   spans, protecting every caller of scrub_text automatically, not just the
   three audited so far. KNOWN_FALSE_POSITIVE_IDENTIFIERS below are now
   fixed BY THIS LAYER ALONE (see test_bare_identifiers_no_longer_need_
   protected_terms) -- protected_terms remains valuable for dotted
   identifiers and as defense-in-depth, not as the only fix anymore.

If test_pii_scrubber_discovers_new_false_positives ever finds a NEW bare-
identifier false positive despite the scrubber-level fix, or a new dotted-
identifier one, audit every moderate_output=True (the default)
generate_completion() call site whose output could echo schema identifiers
back -- see this session's fixes for the pattern to replicate.
"""
from src.modules.data.services.pii_scrubber import pii_scrubber
from ee.modules.ai.services.pii_gate import (
    _scrub_text_preserving_sql_keywords,
    scrub_messages_for_llm,
)

# Ordinary, common column/identifier names a real schema is likely to
# contain. Confirmed corrupted by the raw scrubber before the scrubber-level
# fix; kept as a permanent regression fixture for that fix, not because
# these four are exhaustive (see the discovery test below for that).
KNOWN_FALSE_POSITIVE_IDENTIFIERS = [
    "subscriber_id",    # was -> <NRP>
    "transaction_id",   # was -> <PERSON>
    "ip_address",        # was -> <NRP>
    "is_active",         # was -> <NRP>
]

# A dotted identifier -- a different failure category (URL/ccTLD detector,
# not NER), and NOT covered by the scrubber-level bare-identifier fix, so it
# still needs caller-side protected_terms/auto_protect_identifiers.
KNOWN_DOTTED_FALSE_POSITIVE = "education.grades"  # -> <URL>ades

# A broader sweep of ordinary schema vocabulary, used only to detect *new*
# false positives (Presidio model updates, dependency bumps) -- not asserted
# against one-by-one; a new false positive here is a signal to extend the
# scrubber-level fix or add caller-side protection, not something the raw
# scrubber itself can be blamed for by a strict test (it's a third-party NER
# model's known imprecision, not this codebase's bug).
_DISCOVERY_CANDIDATES = [
    "subscriber_id", "customer_id", "user_id", "account_id", "order_id", "product_id",
    "employee_id", "transaction_id", "invoice_id", "session_id", "device_id", "ticket_id",
    "amount_due", "monthly_fee", "total_amount", "unit_price", "tax_rate", "discount_pct",
    "created_at", "updated_at", "bill_date", "due_date", "start_date", "end_date",
    "first_name", "last_name", "full_name", "display_name", "company_name", "org_name",
    "email_address", "phone_number", "ip_address", "postal_code", "zip_code",
    "is_active", "is_deleted", "status_code", "region_code", "country_code", "currency_code",
    "revenue", "churn_rate", "conversion_rate", "click_through_rate", "nps_score",
    "department_id", "manager_id", "team_name", "role_name", "permission_level",
    "inventory_count", "stock_level", "warehouse_id", "shipment_id", "tracking_number",
]


def test_pii_scrubber_discovers_new_false_positives():
    """Tripwire, not a strict allowlist check: the scrubber-level fix should
    now clear every entry in _DISCOVERY_CANDIDATES with zero false
    positives. If this ever finds ANY, that's a signal to extend
    _BARE_IDENTIFIER_SHAPE_RE / _NER_ENTITY_TYPES_PRONE_TO_IDENTIFIER_
    FALSE_POSITIVES in pii_scrubber.py, or add caller-side protection for
    the specific shape found."""
    newly_found = [
        (c, pii_scrubber.scrub_text(c)) for c in _DISCOVERY_CANDIDATES
        if pii_scrubber.scrub_text(c) != c
    ]
    assert not newly_found, (
        f"PII-scrubber false positives found on ordinary identifiers: {newly_found}. "
        "Extend the scrubber-level fix in pii_scrubber.py's _scrub_with_presidio, and "
        "audit generate_completion call sites that could echo schema identifiers back "
        "(grep for moderate_output in ee/modules/ai/ to see which ones already opted out)."
    )


def test_bare_identifiers_no_longer_need_protected_terms():
    """The scrubber-level fix: known false positives now survive scrubbing
    with ZERO caller-side protection, unlike before this session's fix."""
    for identifier in KNOWN_FALSE_POSITIVE_IDENTIFIERS:
        out = pii_scrubber.scrub_text(identifier)
        assert out == identifier, f"{identifier!r} was still corrupted: {out!r}"


def test_dotted_identifier_still_requires_protected_terms():
    """Control: the scrubber-level fix is scoped to bare (non-dotted)
    identifiers -- a dotted one is a different failure category (URL/ccTLD
    detector) and still relies on the caller-side mechanism, proving this
    test file exercises two genuinely different defenses, not one."""
    out = pii_scrubber.scrub_text(KNOWN_DOTTED_FALSE_POSITIVE)
    assert out != KNOWN_DOTTED_FALSE_POSITIVE, (
        "Expected the dotted identifier to still need caller-side protection "
        "(if this now passes unprotected, the scrubber-level fix may have "
        "grown broader than intended -- or Presidio's model changed)"
    )


def test_protected_terms_defends_dotted_identifier():
    """The caller-side defense, still required for the dotted-identifier
    failure category."""
    text = f"Available tables: {KNOWN_DOTTED_FALSE_POSITIVE}"
    out = _scrub_text_preserving_sql_keywords(text, auto_protect_identifiers=True)
    assert KNOWN_DOTTED_FALSE_POSITIVE in out, f"Not protected: {out!r}"


def test_protected_terms_threads_through_scrub_messages_for_llm():
    """End-to-end at the layer generate_completion actually calls, for the
    dotted-identifier case that still needs it."""
    messages = [{"role": "user", "content": f"Schema: {KNOWN_DOTTED_FALSE_POSITIVE}"}]
    out = scrub_messages_for_llm(messages, auto_protect_identifiers=True)
    assert KNOWN_DOTTED_FALSE_POSITIVE in out[0]["content"], f"Not protected: {out[0]['content']!r}"


def test_genuine_pii_in_prose_is_still_caught():
    """Control: the scrubber-level fix must not weaken real PII detection --
    scoped narrowly (NER entity types + exact bare snake_case shape), real
    names/locations in real sentences never take that shape and must still
    be redacted."""
    cases = [
        ("My name is John Smith", "John Smith"),
        ("Contact Sarah Johnson at the office", "Sarah Johnson"),
        ("He lives in Paris, France", "Paris"),
    ]
    for text, must_not_appear in cases:
        out = pii_scrubber.scrub_text(text)
        assert must_not_appear not in out, f"Genuine PII leaked: {text!r} -> {out!r}"


def test_underscore_joined_name_in_real_sentence_is_not_over_protected():
    """A genuine underscore-joined identifier appearing INSIDE a real
    sentence (not as a bare standalone token) is a different situation from
    the bare-token false positives this fix targets -- Presidio's NER
    doesn't flag it as PERSON even without this fix (confirmed live), so
    this is a non-regression check, not a new guarantee."""
    out = pii_scrubber.scrub_text("jean_pierre lives in montreal")
    assert "montreal" not in out  # the genuine LOCATION hit must still fire
