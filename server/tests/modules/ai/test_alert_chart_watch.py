"""Watching a chart: breach messages carry only facts from the data (value, threshold, change
since the last check, the groups that moved), and rules run as their creator."""

from ee.modules.alerts.alert_evaluator import breach_message, top_movers


def test_top_movers_ranks_the_biggest_changes_either_way():
    prev = {"North": 100.0, "South": 50.0, "East": 10.0}
    cur = {"North": 40.0, "South": 55.0, "West": 30.0}
    assert top_movers(prev, cur) == [("North", -60.0), ("West", 30.0), ("East", -10.0)]
    assert top_movers(None, cur) == []


def test_breach_message_states_value_threshold_change_and_movers():
    rule = {"name": "Revenue", "threshold_operator": "<", "threshold_value": 50000, "last_value": 62000,
            "last_snapshot": {"Phnom Penh": 40000.0, "Siem Reap": 22000.0}}
    msg = breach_message(rule, 45000.0, {"Phnom Penh": 30000.0, "Siem Reap": 15000.0})
    assert msg.startswith("Revenue: 45.0K (< 50.0K).")
    assert "Was 62.0K at the last check (-27.4%)." in msg
    assert "Biggest changes: Phnom Penh −10.0K, Siem Reap −7.0K." in msg


def test_first_breach_has_no_invented_history():
    msg = breach_message({"name": "Orders", "threshold_operator": ">", "threshold_value": 10}, 12.0, None)
    assert msg == "Orders: 12 (> 10)."
