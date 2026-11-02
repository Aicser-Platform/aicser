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


def test_owner_or_admin_needs_a_second_person_when_there_is_one():
    assert decide(is_approver=True, other_approvers=1) == ("pending", False)


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
