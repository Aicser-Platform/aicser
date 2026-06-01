"""Tests for streaming progress easing."""

from src.modules.ai.utils.progress_easing import (
    ease_progress_display,
    raw_progress_for_plan_step,
    apply_eased_progress_to_event,
)


def test_ease_progress_fast_early_slow_late():
    early = ease_progress_display(25.0)
    mid = ease_progress_display(50.0)
    late = ease_progress_display(90.0)
    assert early > 25
    assert mid > early
    assert late > mid
    assert late < 97.0
    assert ease_progress_display(100.0, is_complete=True) == 100.0


def test_raw_progress_for_plan_step_sub_progress():
    base = raw_progress_for_plan_step(0, 5, sub_progress=0.0)
    half = raw_progress_for_plan_step(0, 5, sub_progress=0.5)
    assert half > base
    assert raw_progress_for_plan_step(4, 5, sub_progress=1.0) <= 95.0


def test_apply_eased_progress_to_event():
    event = {"percentage": 50.0, "progress_percentage": 50.0, "progress": {"percentage": 50.0}}
    out = apply_eased_progress_to_event(event)
    assert out["percentage"] > 50.0
    assert out["raw_percentage"] == 50.0
