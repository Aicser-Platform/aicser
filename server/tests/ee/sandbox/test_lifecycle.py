"""Start, upgrade, keep and erase a sandbox against a real Postgres.

Needs SANDBOX_TEST_DATABASE=1 and a throwaway DATABASE_URL (a copy of the schema, no customer data).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(os.getenv("SANDBOX_TEST_DATABASE") != "1", reason="needs a throwaway database")


@pytest.fixture(autouse=True)
async def _setup(monkeypatch):
    from ee.scripts.seed_subscription_plans import seed_plans
    from src.db import session as db_session
    from src.modules.sandbox import service

    await db_session.async_engine.dispose()  # each test has its own event loop
    await seed_plans(force=True)
    sent = []

    async def fake_send(recipients, subject, body, **kwargs):
        sent.append((list(recipients), body))
        return True

    monkeypatch.setattr("src.shared.transactional_email.send_transactional_email", fake_send)
    service._sent = sent
    yield


async def _scalar(sql, **params):
    from src.db.session import async_session

    async with async_session() as db:
        return await db.scalar(text(sql), params)


async def _provision(email=None):
    from src.modules.sandbox import service

    return await service.provision(email=email, company="Acme", phone=None, ip="203.0.113.9")


async def _connect_sample(ws):
    """What the walkthrough's first step does for a visitor."""
    from src.db.session import async_session
    from src.modules.data.services.data_sources_crud import DataSourceCreate, data_sources_crud

    project = await _scalar("select id from projects where organization_id=:o limit 1", o=ws.organization_id)
    owner = await _scalar("select user_id from user_roles where organization_id=:o limit 1", o=ws.organization_id)
    async with async_session() as db:
        await data_sources_crud.create_data_source(
            data_source_data=DataSourceCreate(
                name="Sample", type="sample_duckdb", format="sample_duckdb", connection_config={"domain": "ecommerce"},
                project_id=str(project), organization_id=str(ws.organization_id), is_active=True),
            user_id=str(owner), session=db)


async def test_guest_gets_an_isolated_seeded_workspace():
    user, ws = await _provision()
    org = ws.organization_id
    assert ws.tier == "guest" and user.email.endswith("@sandbox.invalid") and not user.is_verified
    assert await _scalar("select p.slug from organization_subscriptions s join subscription_plans p on p.id=s.plan_id where s.organization_id=:o", o=org) == "sandbox_guest"
    assert await _scalar("select count(*) from data_sources where organization_id=:o", o=org) == 0  # connecting is step one
    assert await _scalar("select count(*) from feed_posts where organization_id=:o", o=org) == 1
    assert ws.expires_at - ws.created_at <= timedelta(days=1, seconds=5)


async def test_an_address_gives_three_days_and_can_not_try_twice():
    from fastapi import HTTPException
    from src.db.session import async_session
    from src.modules.sandbox import service

    email = f"person-{uuid.uuid4().hex[:8]}@example.org"
    user, ws = await _provision(email)
    assert ws.tier == "verified" and user.is_verified
    assert timedelta(days=2, hours=23) < ws.expires_at - ws.created_at <= timedelta(days=3, seconds=5)
    async with async_session() as db:
        with pytest.raises(HTTPException) as refused:
            await service.check_email_allowed(db, email)
    assert refused.value.detail["code"] == "account_exists"


async def test_wrong_codes_run_out():
    from fastapi import HTTPException
    from src.modules.sandbox import service

    email = f"codes-{uuid.uuid4().hex[:8]}@example.org"
    await service.send_code(email)
    code = service._sent[-1][1].split("code is ")[1][:6]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(service.MAX_CODE_TRIES):
        with pytest.raises(HTTPException):
            service.check_code(email, wrong)
    with pytest.raises(HTTPException):
        service.check_code(email, code)


async def test_guest_upgrades_in_place():
    from src.db.session import async_session
    from src.modules.sandbox import service
    from src.modules.sandbox.models import SandboxWorkspace

    user, ws = await _provision()
    email = f"upgrade-{uuid.uuid4().hex[:8]}@example.org"
    async with async_session() as db:
        row = await db.get(SandboxWorkspace, ws.id)
        await service.upgrade_guest(db, row, str(user.user_id), email)
    assert await _scalar("select email from users where id=:u", u=user.id) == email
    assert await _scalar("select p.slug from organization_subscriptions s join subscription_plans p on p.id=s.plan_id where s.organization_id=:o", o=ws.organization_id) == "sandbox"


async def test_keeping_starts_the_team_trial_and_lifts_the_limits():
    from src.db.session import async_session
    from src.modules.ai.services.org_ai_settings import read_section
    from src.modules.sandbox import service
    from src.modules.sandbox.models import SandboxWorkspace

    user, ws = await _provision(f"keep-{uuid.uuid4().hex[:8]}@example.org")
    await _connect_sample(ws)
    async with async_session() as db:
        row = await db.get(SandboxWorkspace, ws.id)
        grant = await service.keep(db, row, str(user.user_id), "a-good-long-password")
    assert grant["outcome"] == "granted"
    org = ws.organization_id
    assert await _scalar("select p.slug from organization_subscriptions s join subscription_plans p on p.id=s.plan_id where s.organization_id=:o", o=org) == "team"
    assert await _scalar("select status::text from organization_subscriptions where organization_id=:o", o=org) == "trialing"
    assert not (await read_section(org, "model_preferences") or {}).get("sandbox")
    assert await _scalar("select count(*) from data_sources where organization_id=:o", o=org) == 1  # nothing lost
    assert await _scalar("select hashed_password is not null from users where id=:u", u=user.id)


async def test_purge_erases_everything_and_leaves_other_people_alone():
    from src.db.session import async_session
    from src.modules.sandbox import service
    from src.modules.sandbox.models import SandboxWorkspace

    email = f"gone-{uuid.uuid4().hex[:8]}@example.org"
    user, ws = await _provision(email)
    other_user, other_ws = await _provision(f"stays-{uuid.uuid4().hex[:8]}@example.org")
    org = ws.organization_id
    await _connect_sample(ws)
    await _connect_sample(other_ws)
    project = await _scalar("select id from projects where organization_id=:o limit 1", o=org)
    source = await _scalar("select id from data_sources where organization_id=:o limit 1", o=org)
    async with async_session() as db:  # things a visitor makes, including children with no org column
        conv = uuid.uuid4()
        chart = uuid.uuid4()
        await db.execute(text("insert into charts (id, chart_type, project_id, user_id, data_source_id) values (:c,'bar',:p,:u,:s)"),
                         {"c": chart, "p": project, "u": user.user_id, "s": source})
        post = await db.scalar(text("select id from feed_posts where organization_id=:o"), {"o": org})
        await db.execute(text("insert into feed_comments (post_id, user_id, content) values (:p,:u,'mine')"), {"p": post, "u": user.id})
        await db.execute(text("update sandbox_workspaces set status='expired', expires_at=now()-interval '9 days', purge_at=now()-interval '1 day' where id=:i"), {"i": ws.id})
        await db.commit()

    outcome = await service.tick()
    assert outcome["failed"] == 0 and outcome["purged"] >= 1

    assert await _scalar("select count(*) from charts where id=:c", c=chart) == 0
    assert await _scalar("select count(*) from feed_posts where organization_id=:o", o=org) == 0
    assert await _scalar("select count(*) from data_sources where organization_id=:o", o=org) == 0
    assert await _scalar("select count(*) from projects where organization_id=:o", o=org) == 0
    assert await _scalar("select count(*) from user_roles where organization_id=:o", o=org) == 0
    assert await _scalar("select count(*) from users where lower(email)=:e", e=email) == 0
    assert await _scalar("select is_deleted from organizations where id=:o", o=org) is True
    assert await _scalar("select name from organizations where id=:o", o=org) == "Erased sandbox"
    async with async_session() as db:
        row = await db.get(SandboxWorkspace, ws.id)
        assert (row.status, row.email, row.company) == ("purged", None, None) and row.email_hash
    # the neighbour and the shared sample teammate are untouched
    assert await _scalar("select count(*) from data_sources where organization_id=:o", o=other_ws.organization_id) == 1
    assert await _scalar("select count(*) from feed_posts where organization_id=:o", o=other_ws.organization_id) == 1
    assert await _scalar("select email from users where id=:u", u=other_user.id) != ""
    from src.modules.sandbox.template import TEAMMATE_ID
    assert await _scalar("select is_deleted from users where id=:u", u=TEAMMATE_ID) in (False, None)


async def test_daily_ceiling_stops_sandbox_ai_and_new_sandboxes(monkeypatch):
    from fastapi import HTTPException
    from src.db.session import async_session
    from src.modules.ai.services import org_budget_service as budget
    from src.modules.sandbox import service

    user, ws = await _provision()
    monkeypatch.setenv("AISER_SANDBOX_DAILY_USD", "0.5")
    await budget.record_llm_spend_usd(str(ws.organization_id), str(user.user_id), 0.6)
    allowed, reason = await budget.check_org_budget_allowed(str(ws.organization_id), str(user.user_id))
    assert not allowed and "today's AI limit" in reason
    async with async_session() as db:
        with pytest.raises(HTTPException) as refused:
            await service.check_capacity(db)
    assert refused.value.detail["code"] == "busy"
    async with async_session() as db:
        await db.execute(text("delete from org_llm_spend where scope like 'sandbox-day:%'"))
        await db.commit()


async def test_steps_needing_a_teammate_wait_for_a_plan_that_has_one():
    from src.db.session import async_session
    from src.modules.onboarding.router import _one_person_plan

    guest, _ = await _provision()
    async with async_session() as db:
        assert await _one_person_plan(db, str(guest.user_id)) is True
    email = f"with-team-{uuid.uuid4().hex[:8]}@example.org"
    named, _ = await _provision(email)
    async with async_session() as db:
        assert await _one_person_plan(db, str(named.user_id)) is (await _scalar(
            "select p.slug = 'sandbox_guest' from organization_subscriptions s join subscription_plans p on p.id = s.plan_id "
            "join user_roles r on r.organization_id = s.organization_id where r.user_id = :u limit 1", u=named.user_id))


async def test_journey_reports_what_really_happened():
    from src.db.session import async_session
    from src.modules.onboarding.router import _guide_state, _journey_steps

    user, ws = await _provision()
    async with async_session() as db:
        steps = await _journey_steps(db, str(user.user_id))
    assert steps["connect"] is False  # the visitor connects it, guided
    assert steps["ask"] is False and steps["publish"] is False and steps["discuss"] is False
    assert all(value is not None for value in steps.values())  # every query ran on the real schema

    async with async_session() as db:
        await db.execute(text("""UPDATE users SET onboarding_progress = '{"guides": {"team": {"status": "done", "step": 2}}}' WHERE id = :u"""), {"u": user.id})
        await db.commit()
        assert (await _guide_state(db, str(user.user_id)))["team"]["status"] == "done"

    post = uuid.uuid4()
    async with async_session() as db:
        await db.execute(text("""insert into feed_posts (id, asset_type, asset_id, organization_id, author_id, status, visibility)
            values (:p,'post',:a,:o,:u,'approved','organization')"""), {"p": post, "a": uuid.uuid4(), "o": ws.organization_id, "u": user.id})
        await db.execute(text("insert into feed_comments (post_id, user_id, content) values (:p,:u,'mine')"), {"p": post, "u": user.id})
        await db.commit()
        steps = await _journey_steps(db, str(user.user_id))
    assert steps["publish"] is True and steps["discuss"] is False  # your own comment is not a reply

    from src.modules.sandbox.template import TEAMMATE_ID
    async with async_session() as db:
        await db.execute(text("insert into feed_comments (post_id, user_id, content) values (:p,:u,'nice')"), {"p": post, "u": TEAMMATE_ID})
        await db.commit()
        assert (await _journey_steps(db, str(user.user_id)))["discuss"] is True


async def test_a_poc_runs_on_enterprise_and_ends_by_itself():
    import argparse

    from ee.scripts import provision_poc
    from src.db.session import async_session
    from src.modules.ai.services.org_ai_settings import read_section

    email = f"poc-{uuid.uuid4().hex[:8]}@bank.example"
    _, ws = await _provision(email)
    org = ws.organization_id
    args = argparse.Namespace(email=email, days=30, budget_usd=50.0, operator="test", dry_run=False)

    assert await provision_poc.run(args) == 0
    assert await _scalar("select p.slug from organization_subscriptions s join subscription_plans p on p.id=s.plan_id where s.organization_id=:o", o=org) == "enterprise"
    assert await _scalar("select status::text from organization_subscriptions where organization_id=:o", o=org) == "trialing"
    assert (await read_section(org, "model_preferences"))["hard_limit_usd"] == 50.0
    assert await provision_poc.run(args) == 0  # running again extends it

    args.email = "nobody@bank.example"
    assert await provision_poc.run(args) == 1

    async with async_session() as db:  # a paying customer is left alone
        await db.execute(text("update organization_subscriptions set status='active', provider='stripe' where organization_id=:o"), {"o": org})
        await db.commit()
    args.email = email
    assert await provision_poc.run(args) == 1


async def _member(org_id, role="project_viewer"):
    """A person in the organization, with one of its roles."""
    from src.db.session import async_session

    uid = uuid.uuid4()
    async with async_session() as db:
        await db.execute(text("""insert into users (id, user_id, email, username, provider, provider_user_id, is_verified)
            values (:u,:u,:e,:n,'ce',:p,true)"""), {"u": uid, "e": f"{uid.hex[:8]}@acme.example", "n": f"Person {uid.hex[:4]}", "p": str(uid)})
        await db.execute(text("""insert into user_roles (user_id, role_id, organization_id, is_active, is_deleted)
            select :u, id, :o, true, false from roles where name=:r limit 1"""), {"u": uid, "o": org_id, "r": role})
        await db.commit()
    return uid


async def _link(org_id, creator):
    from src.db.session import async_session
    from src.modules.share_links import service as S

    async with async_session() as db:
        return await S.save(db, kind="chart", resource_id=str(uuid.uuid4()), org_id=str(org_id), user_id=str(creator),
                            title="Executive Overview", access="public", live_data=False, expires_in_days=None,
                            password=None, clear_password=False, allowed_domains=[])


async def _bell(user):
    return await _scalar("select count(*) from feed_notifications where recipient_id=:u and metadata->>'kind'='share_link'", u=user)


async def test_an_owner_shares_publicly_with_no_waiting_even_with_other_admins():
    owner, ws = await _provision()
    await _member(ws.organization_id, "org_admin")
    link = await _link(ws.organization_id, owner.user_id)
    assert link.status == "active"


async def test_a_member_waits_the_approvers_are_told_and_the_member_hears_back():
    from src.db.session import async_session
    from src.modules.share_links import service as S
    from src.modules.share_links.models import ShareLink

    owner, ws = await _provision()
    org = ws.organization_id
    member = await _member(org)
    link = await _link(org, member)
    assert link.status == "pending"
    assert await _bell(owner.id) == 1
    assert await _scalar("select metadata->>'href' from feed_notifications where recipient_id=:u", u=owner.id) == S.REVIEW_PATH

    async with async_session() as db:
        row = await db.get(ShareLink, link.id)
        as_member = await S.review_of(db, row, str(member))
        as_owner = await S.review_of(db, row, str(owner.user_id))
        assert as_member["can_approve"] is False and as_member["approvers"]  # told who to ask
        assert as_owner["can_approve"] is True
        await S.decide(db, row, str(owner.user_id), approved=True)
    assert await _scalar("select status from share_links where id=:i", i=link.id) == "active"
    assert await _scalar("select count(*) from feed_notifications where recipient_id=:u and metadata->>'state'='approved'", u=member) == 1


async def test_declining_turns_the_link_off_and_gives_the_reason():
    from src.db.session import async_session
    from src.modules.share_links import service as S
    from src.modules.share_links.models import ShareLink

    owner, ws = await _provision()
    member = await _member(ws.organization_id)
    link = await _link(ws.organization_id, member)
    async with async_session() as db:
        await S.decide(db, await db.get(ShareLink, link.id), str(owner.user_id), approved=False, note="Contains salaries")
    assert await _scalar("select status from share_links where id=:i", i=link.id) == "off"
    assert await _scalar("select metadata->>'note' from feed_notifications where recipient_id=:u and metadata->>'state'='declined'", u=member) == "Contains salaries"


async def test_four_eyes_stops_self_approval_the_button_agrees_and_the_other_admin_can_act():
    from fastapi import HTTPException
    from src.db.session import async_session
    from src.modules.feed import publish_policy as policy
    from src.modules.share_links import service as S
    from src.modules.share_links.models import ShareLink

    owner, ws = await _provision()
    org = ws.organization_id
    admin = await _member(org, "org_admin")
    async with async_session() as db:
        await policy.set_policy(db, org, {"public": "approval", "expiry_days": None, "second_approver": True})
        await db.commit()
    link = await _link(org, owner.user_id)
    assert link.status == "pending"
    assert await _bell(admin) == 1
    async with async_session() as db:
        row = await db.get(ShareLink, link.id)
        review = await S.review_of(db, row, str(owner.user_id))
        assert (review["can_approve"], review["blocked_reason"]) == (False, "own_work")
        with pytest.raises(HTTPException) as refused:
            await S.decide(db, row, str(owner.user_id), approved=True)
        assert refused.value.status_code == 403
        await S.decide(db, row, str(admin), approved=True)
    assert await _scalar("select status from share_links where id=:i", i=link.id) == "active"


async def test_a_link_waiting_a_day_gets_one_reminder():
    from src.db.session import async_session
    from src.modules.share_links import service as S

    owner, ws = await _provision()
    member = await _member(ws.organization_id)
    link = await _link(ws.organization_id, member)
    async with async_session() as db:
        await db.execute(text("update share_links set updated_at=now()-interval '2 days' where id=:i"), {"i": link.id})
        await db.commit()
        assert await S.remind_waiting(db) >= 1
        assert await S.remind_waiting(db) == 0
