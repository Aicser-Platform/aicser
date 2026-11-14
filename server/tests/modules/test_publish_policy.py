"""Who may publish publicly, and when a person has to look first."""

import pytest

from src.modules.feed import publish_policy as p


def decide(**kw):
    base = dict(mode="approval", is_approver=False, other_approvers=1, has_org=True, personal_data=False)
    return p.public_decision(**{**base, **kw})


def test_off_refuses_everyone_including_owners_and_admins():
    assert decide(mode="off")[0] == "refused"
    assert decide(mode="off", is_approver=True)[0] == "refused"


def test_member_needs_approval_by_default():
    assert decide() == ("pending", False)


def test_members_mode_publishes_directly_unless_it_looks_personal():
    assert decide(mode="members") == ("approved", False)
    assert decide(mode="members", personal_data=True) == ("pending", False)


def test_owners_and_admins_publish_directly_and_it_is_recorded():
    assert decide(is_approver=True, other_approvers=1) == ("approved", True)
    assert decide(is_approver=True, other_approvers=3, personal_data=True) == ("approved", True)


def test_a_second_approver_is_the_organizations_choice():
    assert decide(is_approver=True, other_approvers=1, second_approver=True) == ("pending", False)
    assert decide(is_approver=True, other_approvers=0, second_approver=True) == ("approved", True)


@pytest.mark.parametrize("user,requester,ids,second,expected", [
    ("a", "m", ["a", "b"], False, (True, None)),        # an approver reviews a member
    ("a", "a", ["a", "b"], False, (True, None)),        # the screenshot: owner can act on their own link
    ("a", "a", ["a", "b"], True, (False, "own_work")),  # four eyes on
    ("b", "a", ["a", "b"], True, (True, None)),         # the other approver
    ("a", "a", ["a"], True, (True, None)),              # one approver is never stuck
    ("m", "x", ["a", "b"], False, (False, "not_approver")),
])
def test_who_can_act_on_a_waiting_item(user, requester, ids, second, expected):
    assert p.may_review(user_id=user, requester_id=requester, approver_ids=ids, second_approver=second) == expected


def test_sole_approver_publishes_and_it_is_marked_self_approved():
    assert decide(is_approver=True, other_approvers=0) == ("approved", True)
    assert decide(is_approver=True, other_approvers=0, personal_data=True) == ("approved", True)


def test_no_organization_is_a_personal_workspace():
    assert decide(has_org=False, mode="off") == ("approved", False)


@pytest.mark.parametrize("ids,user,others", [(["a", "b"], "a", 1), (["a"], "a", 0), (["a", "b"], "c", 2)])
def test_counting_other_approvers(ids, user, others):
    assert p.approvers_other_than(ids, user) == others


def test_clean_text_is_not_flagged_and_empty_is_skipped():
    assert p.personal_data_found("", None) is False
