"""Goal-aware AutoML settings and training overrides."""

import numpy as np
import pandas as pd

from ee.modules.mlops import training as T
from ee.modules.mlops.automl_config import normalize_automl
from ee.modules.mlops import unsupervised as U


def test_risk_goal_defaults_emphasis():
    cfg = normalize_automl(None, "risk_fraud")
    assert cfg.get("emphasis") == "rare_positive"


def test_forced_linear_algorithm():
    df = pd.DataFrame({"x": np.linspace(0, 10, 200), "y": np.linspace(0, 10, 200) + np.random.default_rng(1).normal(0, 0.5, 200)})
    r = T.train(df, "y", automl={"algorithm": "linear", "validation": "random_holdout"})
    assert r["metrics"]["algorithm"] == "linear"


def test_fixed_segment_count():
    rng = np.random.default_rng(4)
    df = pd.DataFrame({"a": rng.normal(0, 1, 400), "b": rng.normal(0, 1, 400)})
    r = U.train_segments(df, automl={"segment_k": 4})
    assert r["metrics"]["k"] == 4
