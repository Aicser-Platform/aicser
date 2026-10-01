"""Guided training: task choice, column checks, honest quality, safe model files, drift."""

import numpy as np
import pandas as pd
import pytest

from ee.modules.mlops import training as T


def churn(n=3000, seed=1):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "customer_id": [f"C{i}" for i in range(n)],
        "tenure_months": rng.integers(1, 72, n),
        "monthly_fee": rng.normal(40, 15, n).round(2),
        "plan": rng.choice(["basic", "plus", "pro"], n),
        "constant": 1,
    })
    logit = -1.0 - 0.05 * df.tenure_months + 0.04 * (df.monthly_fee - 40) + np.where(df.plan == "basic", 1.0, 0)
    df["churned"] = np.where(rng.random(n) < 1 / (1 + np.exp(-logit)), "yes", "no")
    df["churn_code"] = np.where(df.churned == "yes", "Y", "N")
    return df


def test_task_choice():
    assert T.decide_task(pd.Series(["yes", "no"])) == "classify"
    assert T.decide_task(pd.Series([0, 1, 1, 0])) == "classify"
    assert T.decide_task(pd.Series(np.linspace(0, 100, 50))) == "predict_number"


def test_inspect_drops_ids_constants_and_leaks():
    info = T.inspect(churn(), "churned")
    reasons = {d["name"]: d["reason"] for d in info["dropped"]}
    assert reasons == {"customer_id": "identifier", "constant": "constant", "churn_code": "leaks_answer"}
    assert [f["name"] for f in info["features"]] == ["tenure_months", "monthly_fee", "plan"]


def test_too_few_rows_is_a_plain_error():
    with pytest.raises(T.TrainingError, match="at least"):
        T.train(churn(30), "churned")


def test_classifier_beats_guessing_and_reports_fairly():
    r = T.train(churn(), "churned")
    m = r["metrics"]
    assert m["headline"]["metric"] == "balanced_accuracy" and m["headline"]["baseline"] == 0.5
    assert m["headline"]["value"] > 0.6 and m["auc"] > 0.65
    assert r["importance"][0]["name"] == "tenure_months"


def test_regressor_beats_the_average():
    rng = np.random.default_rng(2)
    df = pd.DataFrame({"size": rng.uniform(20, 200, 2000), "rooms": rng.integers(1, 6, 2000)})
    df["price"] = df["size"] * 1000 + df["rooms"] * 5000 + rng.normal(0, 5000, 2000)
    r = T.train(df, "price")
    assert r["task"] == "predict_number"
    assert r["metrics"]["mae"] < r["metrics"]["baseline_mae"] / 3


def test_artifacts_load_only_unchanged_files_from_the_store(tmp_path, monkeypatch):
    monkeypatch.setenv("ML_MODEL_DIR", str(tmp_path))
    r = T.train(churn(), "churned")
    path, digest = T.save_artifact(r, "org", "m", 1)
    art = T.load_artifact(path, digest)
    pred = art["pipeline"].predict(T.prepare_frame(pd.DataFrame([{"tenure_months": 1, "monthly_fee": 90, "plan": "new"}]), art["spec"]))
    assert pred[0] in ("yes", "no")
    with open(path, "ab") as fh:
        fh.write(b"tampered")
    with pytest.raises(T.TrainingError, match="changed"):
        T.load_artifact(path, digest)
    outside = tmp_path.parent / "evil.joblib"
    outside.write_bytes(b"x")
    with pytest.raises(T.TrainingError, match="outside"):
        T.load_artifact(str(outside), "0" * 64)


def test_drift_flags_shifted_inputs_but_not_passing_time():
    df = churn()
    df["signup"] = pd.date_range("2023-01-01", periods=len(df), freq="h").astype(str)
    r = T.train(df, "churned")
    later = df.assign(monthly_fee=df.monthly_fee * 1.8, signup=pd.date_range("2026-01-01", periods=len(df), freq="h").astype(str))
    report = {d["column"]: d["status"] for d in T.drift(r["profile"], T.prepare_frame(later, r["spec"]))}
    assert report["monthly_fee"] == "changed"
    assert "signup__days" not in report
    same = {d["column"]: d["status"] for d in T.drift(r["profile"], T.prepare_frame(df, r["spec"]))}
    assert same["tenure_months"] == "stable"


def test_free_text_is_learned_as_words_not_dropped_as_an_identifier():
    import random

    rng = random.Random(3)
    good = ["arrived on time and works great", "friendly support resolved it quickly", "love the quality, will buy again"]
    bad = ["package arrived broken and late", "refund still not processed after weeks", "support never answered my emails"]
    rows = []
    for i in range(240):
        complaint = i % 2 == 0
        base = rng.choice(bad if complaint else good)
        rows.append({"message": f"{base} order {i} thanks", "region": rng.choice(["N", "S"]), "complaint": "yes" if complaint else "no"})
    df = pd.DataFrame(rows)
    info = T.inspect(df, "complaint")
    assert {"name": "message", "kind": "text"} in info["features"]
    result = T.train(df, "complaint")
    assert result["metrics"]["headline"]["value"] > 0.9
    assert "message" not in result["profile"]
    preds = T.prepare_frame(pd.DataFrame([{"message": "my package arrived broken", "region": "N"}]), result["spec"])
    assert result["pipeline"].predict(preds)[0] == "yes"


def test_forecast_recipe_fits_and_reports_backtest_quality():
    from ee.modules.mlops import forecasting as F

    days = pd.date_range("2024-01-01", periods=180, freq="D")
    rng = np.random.default_rng(7)
    values = 100 + 0.3 * np.arange(180) + 10 * np.sin(np.arange(180) * 2 * np.pi / 7) + rng.normal(0, 2, 180)
    df = pd.DataFrame({"day": days.strftime("%Y-%m-%d"), "sales": values})
    spec = F.clean_spec({"sql": "select day, sales from t", "time_col": "day", "value_col": "sales", "periods": 14,
                         "resample_to": "D", "agg_func": "sum"})
    out = F.fit(df, spec)
    assert len(out["forecast"]) >= 2
    m = out["metrics"]
    assert m["method"] and m["wmape"] is not None and m["wmape"] < 20
    assert m["headline"]["metric"] == "wmape"


def test_forecast_recipe_needs_its_columns():
    from ee.modules.mlops import forecasting as F

    with pytest.raises(F.ForecastError):
        F.clean_spec({"sql": "select 1", "time_col": "", "value_col": "v"})
    spec = F.clean_spec({"sql": "select 1 as x", "time_col": "day", "value_col": "v"})
    with pytest.raises(F.ForecastError):
        F.fit(pd.DataFrame({"x": [1, 2, 3, 4, 5]}), spec)


def _customers(n=600, seed=11):
    rng = np.random.default_rng(seed)
    grp = rng.integers(0, 3, n)
    return pd.DataFrame({
        "customer_id": [f"C{i}" for i in range(n)],
        "monthly_fee": np.where(grp == 0, 20, np.where(grp == 1, 60, 110)) + rng.normal(0, 4, n),
        "tenure_months": np.where(grp == 0, 60, np.where(grp == 1, 24, 4)) + rng.normal(0, 3, n),
        "plan": np.where(grp == 2, "premium", np.where(grp == 1, "plus", "basic")),
    })


def test_segments_find_the_groups_and_describe_them():
    from ee.modules.mlops import unsupervised as U

    result = U.train_segments(_customers())
    assert result["task"] == "segment"
    assert result["metrics"]["k"] == 3 and result["metrics"]["silhouette"] > 0.5
    assert all(s["name"] and s["traits"] for s in result["metrics"]["segments"])
    assert "customer_id" not in [f["name"] for f in result["spec"]]  # identifiers never define a segment
    art = {**result}
    pred = U.predict(art, pd.DataFrame([{"monthly_fee": 112, "tenure_months": 3, "plan": "premium"}]))[0]
    premium = [s for s in result["metrics"]["segments"] if any(t.get("value") == "premium" for t in s["traits"])]
    assert premium and pred["prediction"] == premium[0]["name"]


def test_unusual_records_are_flagged_with_reasons():
    from ee.modules.mlops import unsupervised as U

    df = _customers()
    result = U.train_anomalies(df)
    art = {**result}
    odd, normal = U.predict(art, pd.DataFrame([
        {"monthly_fee": 900, "tenure_months": 400, "plan": "basic"},
        {"monthly_fee": 21, "tenure_months": 59, "plan": "basic"},
    ]))
    assert odd["prediction"] == "unusual" and odd["reasons"]
    assert normal["prediction"] == "normal" and odd["score"] > normal["score"]


def test_predictions_explain_themselves_and_rank_options():
    from ee.modules.mlops import service

    df = _customers()
    df["next_offer"] = np.where(df["plan"] == "basic", "upgrade", np.where(df["plan"] == "plus", "addon", "loyalty"))
    df = df.drop(columns=["plan"])
    result = T.train(df, "next_offer")
    art = {k: result[k] for k in ("pipeline", "spec", "task", "classes", "extra")}
    out = service._predict_sync(art, pd.DataFrame([{"monthly_fee": 21, "tenure_months": 60}]))[0]
    assert out["prediction"] == "upgrade"
    assert [t["value"] for t in out["top"]][0] == "upgrade" and len(out["top"]) == 3
    assert out["reasons"] and out["reasons"][0]["field"] in ("monthly_fee", "tenure_months")


def test_unsupervised_predict_tolerates_missing_inputs():
    from ee.modules.mlops import unsupervised as U

    art = U.train_segments(_customers())
    out = U.predict(art, pd.DataFrame([{"monthly_fee": 50}]))  # tenure and plan missing
    assert out[0]["prediction"]


def test_values_far_outside_training_are_flagged_even_where_the_forest_saturates():
    from ee.modules.mlops import unsupervised as U

    art = U.train_anomalies(_customers())
    out = U.predict(art, pd.DataFrame([{"monthly_fee": 5000, "tenure_months": 30, "plan": "plus"}]))[0]
    assert out["prediction"] == "unusual" and any("monthly fee" in r["text"] for r in out["reasons"])


def test_candidates_compete_and_the_leaderboard_is_kept():
    r = T.train(churn(), "churned")
    m = r["metrics"]
    algos = {b["algorithm"] for b in m["leaderboard"]}
    assert algos == {"gbm", "linear"}
    assert sum(b["chosen"] for b in m["leaderboard"]) == 1
    assert m["algorithm"] in algos and m["validation"]["method"] == "random_holdout"
    assert 0 <= m["brier"] < 0.25


def test_simple_linear_data_prefers_the_simpler_model():
    rng = np.random.default_rng(2)
    df = pd.DataFrame({"size": rng.uniform(20, 200, 2000), "rooms": rng.integers(1, 6, 2000)})
    df["price"] = df["size"] * 1000 + df["rooms"] * 5000 + rng.normal(0, 5000, 2000)
    assert T.train(df, "price")["metrics"]["algorithm"] == "linear"


def test_dated_rows_are_validated_on_the_latest_period():
    df = churn(2000)
    df["signup_date"] = pd.date_range("2022-01-01", periods=len(df), freq="6h").astype(str)
    m = T.train(df, "churned")["metrics"]
    assert m["validation"] == {"method": "out_of_time", "time_column": "signup_date", "test_share": 0.2,
                               "cv_metric": "balanced_accuracy"}


def test_skewed_amounts_learn_on_a_log_scale_and_show_effects():
    rng = np.random.default_rng(5)
    n = 2000
    df = pd.DataFrame({"visits": rng.integers(1, 50, n), "region": rng.choice(["n", "s", "e"], n)})
    df["spend"] = np.exp(0.06 * df.visits + rng.normal(0, 0.6, n)) * 10
    r = T.train(df, "spend")
    assert r["metrics"]["log_target"] is True
    assert r["pipeline"].predict(df.head(3)[["visits", "region"]]).min() > 0
    effect = next(e for e in r["extra"]["effects"] if e["field"] == "visits")
    ys = [p["y"] for p in effect["points"]]
    assert ys[-1] > ys[0]  # more visits, more spend


def test_champion_vs_challenger_compares_on_the_fair_metric():
    from ee.modules.mlops.service import compare_versions

    def h(metric, value):
        return {"headline": {"metric": metric, "value": value}}
    assert compare_versions(h("balanced_accuracy", 0.80), h("balanced_accuracy", 0.75))["verdict"] == "better"
    assert compare_versions(h("mae", 12.0), h("mae", 10.0))["verdict"] == "worse"
    assert compare_versions(h("mae", 10.02), h("mae", 10.0))["verdict"] == "same"
    assert compare_versions(h("mae", 1), h("accuracy", 0.9)) is None
    assert compare_versions(h("flag_rate", 0.02), h("flag_rate", 0.03)) is None


def test_input_warnings_name_missing_extra_and_non_numeric_columns():
    from ee.modules.mlops.service import input_warnings

    spec = [{"name": "fee", "kind": "numeric"}, {"name": "plan", "kind": "category"}]
    w = {x["code"]: x["columns"] for x in input_warnings(spec, [{"fee": "abc", "colour": "red", "churned": "yes"}], ignore=["churned"])}
    assert w == {"missing_columns": ["plan"], "ignored_columns": ["colour"], "not_numbers": ["fee"]}
    assert input_warnings(spec, [{"fee": 3, "plan": "pro"}]) == []


def test_output_fields_are_consistent_across_chat_and_batch():
    from ee.modules.mlops.service import output_fields

    p = {"prediction": "gold", "confidence": 0.7, "top": [{"value": "gold", "probability": 0.7}],
         "reasons": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}
    assert output_fields("predicted_offer", p) == {
        "predicted_offer": "gold", "predicted_offer_confidence": 0.7,
        "predicted_offer_options": "gold (70%)", "predicted_offer_why": "a; b"}


def test_model_card_states_limitations_from_the_numbers():
    from ee.modules.mlops.card import build_card, card_markdown

    r = T.train(churn(400), "churned")
    version = {"version": 1, "status": "ready", "stage": "production", "training_rows": r["rows"], "metrics": r["metrics"],
               "importance": r["importance"], "effects": r["extra"]["effects"], "dropped": r["inspection"]["dropped"]}
    model = {"id": "m", "name": "Churn", "task": "classify", "target": "churned", "table": "customers",
             "production": version, "latest": version, "output_column": "predicted_churned",
             "inputs": [{"name": "plan", "kind": "category", "values": ["basic"]}], "ops": {"retrain": "weekly", "auto_promote": True}}
    card = build_card(model, [version])
    assert any("400 rows" in x for x in card["limitations"])
    assert any("random sample" in x for x in card["limitations"])
    md = card_markdown(card)
    assert "## Limitations" in md and "| Candidate |" in md and "Retraining: weekly" in md


def test_linear_winner_predicts_with_missing_category_inputs():
    from ee.modules.mlops.service import _predict_sync

    rng = np.random.default_rng(2)
    df = pd.DataFrame({"size": rng.uniform(20, 200, 800), "zone": rng.choice(["a", "b"], 800)})
    df["price"] = df["size"] * 1000 + np.where(df.zone == "a", 5000, 0) + rng.normal(0, 3000, 800)
    r = T.train(df, "price")
    art = {"pipeline": r["pipeline"], "spec": r["spec"], "task": r["task"], "extra": r["extra"]}
    out = _predict_sync(art, pd.DataFrame.from_records([{"size": 100}]))
    assert out[0]["prediction"] > 0


def test_inputs_not_given_are_never_reasons():
    from ee.modules.mlops.service import _predict_sync

    r = T.train(churn(1500), "churned")
    art = {"pipeline": r["pipeline"], "spec": r["spec"], "task": r["task"], "extra": r["extra"]}
    out = _predict_sync(art, pd.DataFrame.from_records([{"monthly_fee": 90}]))
    assert {x["field"] for x in out[0].get("reasons", [])} <= {"monthly_fee"}


def _daily(y, start="2025-01-01"):
    d = pd.date_range(start, periods=len(y), freq="D")
    return d, pd.DataFrame({"day": d.astype(str), "revenue": y})


def test_forecast_keeps_recurring_month_start_spikes_and_the_trend():
    from ee.modules.mlops import forecasting as F

    rng = np.random.default_rng(3)
    n = 240
    d = pd.date_range("2025-01-01", periods=n, freq="D")
    week = np.array([0, 5, 8, 6, 3, -12, -10]) * 1000
    y = 100000 + np.arange(n) * 150 + week[d.dayofweek] + rng.normal(0, 2000, n)
    y[d.day == 1] += 15000  # billing run on the 1st, every month
    _, df = _daily(y)
    out = F.fit(df, {"time_col": "day", "value_col": "revenue", "periods": 28, "resample_to": "D", "agg_func": "sum"}, 28)
    fc = pd.DataFrame(out["forecast"])
    fd = pd.DatetimeIndex(pd.to_datetime(fc["date"]))
    v = fc["forecast"].to_numpy()
    k = int(np.where(fd.day == 1)[0][0])
    assert v[k] - v[k + 7] > 8000  # the 1st stands out from the same weekday a week later
    assert out["metrics"]["trend"] == "increasing"


def test_forecast_of_pure_noise_stays_flat():
    from ee.modules.mlops import forecasting as F

    rng = np.random.default_rng(11)
    _, df = _daily(874566 + rng.normal(0, 5354, 120), "2025-04-25")
    out = F.fit(df, {"time_col": "day", "value_col": "revenue", "periods": 30, "resample_to": "D", "agg_func": "sum"}, 30)
    assert pd.DataFrame(out["forecast"])["forecast"].std() < 1000  # no invented wiggles


def test_patterns_found_are_named_from_evidence():
    from ee.modules.mlops import forecasting as F

    rng = np.random.default_rng(4)
    d = pd.date_range("2024-01-01", periods=400, freq="D")
    week = np.array([0, .05, .08, .06, .03, -.15, -.12])
    y = 1000 + np.where(d.day == 1, 800, 0) + 1000 * week[d.dayofweek] + rng.normal(0, 30, 400)
    spec = {"time_col": "day", "value_col": "v", "periods": 28, "resample_to": "D", "agg_func": "sum"}
    out = F.fit(pd.DataFrame({"day": d.astype(str), "v": y}), spec, 28)
    assert set(out["metrics"]["patterns"]) >= {"weekly", "month_start"}

    noise = F.fit(pd.DataFrame({"day": d[:200].astype(str), "v": 1000 + rng.normal(0, 50, 200)}), spec, 28)
    assert noise["metrics"]["patterns"] == []
