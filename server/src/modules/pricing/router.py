"""
Pricing and Subscription API Endpoints
Provides subscription information and usage tracking
"""

from typing import Dict, Any, Union, Optional, Tuple
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timezone
import logging
import stripe

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.db.session import get_async_session
from src.modules.authentication.rbac.models import UserRole
from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan, PaymentHistory
from src.modules.organizations.models import Organization
from src.modules.pricing.feature_gate import (
    get_user_organization_id,
    get_plan_features,
    get_organization_plan,
    get_merged_plan_features_for_org,
)
from src.modules.pricing.usage_tracker import get_usage_summary
from src.modules.pricing.plans import PLAN_CONFIGS, get_plan_config
from src.modules.billing.stripe.stripe_webhook_api import router as stripe_webhook_router

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pricing", tags=["Pricing & Subscriptions"])

# Include Stripe webhook router
router.include_router(stripe_webhook_router)


def _extract_user_identity(current_token: Union[str, dict]) -> Tuple[str, Optional[str]]:
    """Extract authenticated user identity fields from JWT payload."""
    user_id = None
    user_email = None
    if isinstance(current_token, dict):
        user_id = current_token.get('sub') or current_token.get('user_id')
        user_email = current_token.get('email')

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )

    return str(user_id), user_email


async def _get_or_create_org_subscription_for_customer(
    org_id,
    db: AsyncSession,
) -> OrganizationSubscription:
    """Ensure an organization_subscriptions row exists so we can persist provider_customer_id."""
    stmt = select(OrganizationSubscription).where(
        OrganizationSubscription.organization_id == org_id
    )
    result = await db.execute(stmt)
    org_subscription = result.scalar_one_or_none()
    if org_subscription:
        return org_subscription

    free_plan_stmt = select(SubscriptionPlan).where(SubscriptionPlan.slug == 'free')
    free_plan_result = await db.execute(free_plan_stmt)
    free_plan = free_plan_result.scalar_one_or_none()
    if not free_plan:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Free plan is not configured"
        )

    org_subscription = OrganizationSubscription(
        organization_id=org_id,
        plan_id=free_plan.id,
        status='active',
        provider='stripe',
        provider_metadata={},
    )
    db.add(org_subscription)
    await db.flush()
    return org_subscription


async def _ensure_org_stripe_customer(
    org_id,
    user_id: str,
    user_email: Optional[str],
    db: AsyncSession,
) -> Tuple[str, OrganizationSubscription]:
    """Get existing Stripe customer for org or create one and persist customer ID."""
    from src.modules.billing.stripe.stripe_service import StripeService

    stmt = select(OrganizationSubscription).where(
        OrganizationSubscription.organization_id == org_id
    )
    result = await db.execute(stmt)
    org_subscription = result.scalar_one_or_none()

    if org_subscription and org_subscription.provider_customer_id:
        customer_id = org_subscription.provider_customer_id
        # Keep customer email in sync when older placeholder emails are present.
        if user_email:
            existing_customer = await StripeService.get_customer(customer_id)
            existing_email = None
            if existing_customer:
                try:
                    existing_email = existing_customer.get('email')
                except Exception:
                    existing_email = getattr(existing_customer, 'email', None)
            if existing_email and str(existing_email).endswith('@organization.local'):
                await StripeService.update_customer(customer_id, email=user_email)
        return customer_id, org_subscription

    org_stmt = select(Organization).where(Organization.id == org_id)
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )

    if user_email:
        customer_email = user_email
    else:
        safe_email = org.name.lower().replace(' ', '_').replace('@', '_at_')
        customer_email = f"{safe_email}@organization.local"

    customer = await StripeService.create_customer(
        email=customer_email,
        name=org.name,
        metadata={
            'organization_id': str(org_id),
            'user_id': str(user_id),
        },
    )
    if not customer:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create Stripe customer"
        )

    if not org_subscription:
        org_subscription = await _get_or_create_org_subscription_for_customer(org_id, db)

    org_subscription.provider = 'stripe'
    org_subscription.provider_customer_id = customer.id
    provider_metadata = dict(org_subscription.provider_metadata or {})
    provider_metadata.setdefault('customer_created_via', 'payment-methods')
    org_subscription.provider_metadata = provider_metadata
    await db.commit()
    await db.refresh(org_subscription)

    return customer.id, org_subscription


@router.get("/plans")
async def get_available_plans() -> Dict[str, Any]:
    """
    Get all available subscription plans with features and limits.
    Public endpoint - no authentication required.
    """
    return {
        "success": True,
        "plans": PLAN_CONFIGS
    }


@router.get("/subscription")
async def get_current_subscription(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Get current subscription details for the authenticated user's organization.
    """
    try:
        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )
        
        # Get organization
        org_id = await get_user_organization_id(user_id, db)
        
        if not org_id:
            return {
                "success": False,
                "message": "No organization found",
                "subscription": None
            }
        
        # Get subscription with plan details
        stmt = (
            select(OrganizationSubscription, SubscriptionPlan)
            .join(SubscriptionPlan, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(OrganizationSubscription.organization_id == org_id)
        )
        
        result = await db.execute(stmt)
        row = result.first()
        
        if not row:
            return {
                "success": True,
                "message": "No subscription found",
                "subscription": None,
                "default_plan": "free"
            }
        
        subscription, plan = row

        # If canceled, keep user on their paid plan until period ends
        if subscription.status == 'canceled':
            still_in_period = (
                subscription.ends_at
                and subscription.ends_at > datetime.now(timezone.utc)
            )
            if still_in_period:
                # Grace period — return original plan so user keeps access
                effective_plan = plan
            else:
                # Period ended — fall back to free plan
                free_stmt = select(SubscriptionPlan).where(SubscriptionPlan.slug == 'free')
                free_result = await db.execute(free_stmt)
                free_plan = free_result.scalar_one_or_none()
                effective_plan = free_plan or plan
            return {
                "success": True,
                "subscription": {
                    "plan": {
                        "name": effective_plan.name,
                        "slug": effective_plan.slug,
                        "description": effective_plan.description,
                        "features": effective_plan.features,
                        "limits": effective_plan.limits
                    },
                    "status": "canceled",
                    "trial_ends_at": None,
                    "ends_at": subscription.ends_at.isoformat() if subscription.ends_at else None,
                    "provider": subscription.provider,
                    "is_trial": False
                }
            }

        # Compute trial helper fields
        now_utc = datetime.now(timezone.utc)
        trial_expiring_soon = bool(getattr(subscription, 'trial_expiring_soon', False))
        trial_days_remaining = None
        if subscription.trial_ends_at and subscription.status == 'trialing':
            delta = subscription.trial_ends_at - now_utc
            trial_days_remaining = max(0, delta.days)

        return {
            "success": True,
            "subscription": {
                "plan": {
                    "name": plan.name,
                    "slug": plan.slug,
                    "description": plan.description,
                    "features": plan.features,
                    "limits": plan.limits
                },
                "status": subscription.status,
                "trial_ends_at": subscription.trial_ends_at.isoformat() if subscription.trial_ends_at else None,
                "ends_at": subscription.ends_at.isoformat() if subscription.ends_at else None,
                "provider": subscription.provider,
                "is_trial": subscription.status == 'trialing',
                "trial_expiring_soon": trial_expiring_soon,
                "trial_days_remaining": trial_days_remaining,
            }
        }

    except Exception as e:
        logger.error(f"Error getting subscription: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving subscription information"
        )


@router.get("/usage")
async def get_current_usage(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Get current usage statistics for the authenticated user's organization.
    """
    try:
        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )
        
        # Get organization
        org_id = await get_user_organization_id(user_id, db)
        
        if not org_id:
            return {
                "success": False,
                "message": "No organization found",
                "usage": {}
            }
        
        # Get usage summary
        usage = await get_usage_summary(org_id, db, user_id=user_id)
        
        return {
            "success": True,
            "usage": usage
        }
        
    except Exception as e:
        logger.error(f"Error getting usage: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving usage information"
        )


@router.get("/features")
async def get_available_features(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Get available features for the authenticated user's organization.
    """
    try:
        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )
        
        # Get organization
        org_id = await get_user_organization_id(user_id, db)
        
        if not org_id:
            return {
                "success": False,
                "message": "No organization found",
                "features": {}
            }
        
        # Get features
        features = await get_plan_features(org_id, db)
        
        return {
            "success": True,
            "features": features
        }
        
    except Exception as e:
        logger.error(f"Error getting features: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving feature information"
        )


@router.get("/entitlements")
async def get_entitlements(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """
    Return the full entitlement set for the current user's organisation.

    Single source of truth used by the client-side useFeatureGate hook.
    Response shape is stable; client should treat unknown feature keys as False.
    """
    try:
        user_id: str | None = None
        if isinstance(current_token, dict):
            user_id = current_token.get("sub") or current_token.get("user_id")

        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        org_id = await get_user_organization_id(user_id, db)
        if not org_id:
            # Return free-plan entitlements if org not yet created
            config = get_plan_config("free")
            merged_free = await get_merged_plan_features_for_org(None, db)
            return {
                "success": True,
                "plan_type": "free",
                "features": merged_free,
                "allowed_ai_modes": config.get("allowed_ai_modes", []),
                "ai_credits_limit": config["ai_credits_limit"],
                "max_users": config["max_users"],
                "max_projects": config["max_projects"],
                "max_data_sources": config["max_data_sources"],
                "is_ee": False,
            }

        # Resolve plan from live subscription (None => free tier)
        plan_type = await get_organization_plan(org_id, db) or "free"
        config = get_plan_config(plan_type)
        merged_features = await get_merged_plan_features_for_org(org_id, db)

        return {
            "success": True,
            "plan_type": plan_type,
            "features": merged_features,
            "allowed_ai_modes": config.get("allowed_ai_modes", []),
            "ai_credits_limit": config["ai_credits_limit"],
            "max_users": config["max_users"],
            "max_projects": config["max_projects"],
            "max_data_sources": config["max_data_sources"],
            "is_ee": plan_type == "enterprise",
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error building entitlements for user: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving entitlements",
        )


@router.post("/checkout")
async def create_checkout_session(
    plan_slug: str,
    billing_period: str,  # 'monthly' or 'yearly'
    success_url: str,
    cancel_url: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Create a Stripe checkout session for subscription.
    
    Args:
        plan_slug: Plan identifier (pro, team, enterprise)
        billing_period: monthly or yearly
        success_url: URL to redirect after successful payment
        cancel_url: URL to redirect if payment is canceled
    """
    from src.modules.billing.stripe.stripe_service import StripeService
    from src.core.config import settings
    
    try:
        # Check if Stripe is enabled
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )
        
        # Extract user identity from token
        user_id, user_email = _extract_user_identity(current_token)
        
        # Get organization
        org_id = await get_user_organization_id(user_id, db)
        
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )
        
        # Validate plan
        plan_config = PLAN_CONFIGS.get(plan_slug)
        if not plan_config:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid plan: {plan_slug}"
            )
        
        # Get price ID based on plan and billing period
        price_key = f"{plan_slug}_{billing_period}"
        price_id_map = {
            'pro_monthly': settings.STRIPE_PRICE_PRO_MONTHLY,
            'pro_yearly': settings.STRIPE_PRICE_PRO_YEARLY,
            'team_monthly': settings.STRIPE_PRICE_TEAM_MONTHLY,
            'team_yearly': settings.STRIPE_PRICE_TEAM_YEARLY,
        }
        
        price_id = price_id_map.get(price_key)
        if not price_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Price not configured for {plan_slug} {billing_period}"
            )
        
        # Reuse organization Stripe customer so checkout can leverage saved cards.
        customer_id, _ = await _ensure_org_stripe_customer(
            org_id=org_id,
            user_id=user_id,
            user_email=user_email,
            db=db,
        )

        default_payment_method_id = None
        customer = await StripeService.get_customer(customer_id)
        if customer:
            try:
                invoice_settings = getattr(customer, 'invoice_settings', None)
                default_pm = getattr(invoice_settings, 'default_payment_method', None) if invoice_settings else None
                if isinstance(default_pm, str):
                    default_payment_method_id = default_pm
                elif default_pm is not None:
                    default_payment_method_id = getattr(default_pm, 'id', None)
            except Exception:
                default_payment_method_id = None
        
        # Create checkout session (no trial – charge immediately)
        session = await StripeService.create_checkout_session(
            customer_id=customer_id,
            price_id=price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'organization_id': str(org_id),
                'plan_slug': plan_slug,
                'billing_period': billing_period
            },
            trial_period_days=None,
            payment_method_collection='if_required',
            default_payment_method_id=default_payment_method_id,
        )
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create checkout session"
            )
        
        return {
            "success": True,
            "checkout_url": session.url,
            "session_id": session.id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating checkout session: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error creating checkout session"
        )


@router.post("/verify-session")
async def verify_checkout_session(
    session_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Verify a completed Stripe checkout session and provision the subscription.

    This acts as a synchronous alternative to the Stripe webhook for local
    development or when webhooks are delayed.  The frontend calls this endpoint
    after the user returns from Stripe checkout so the subscription is activated
    immediately in the database.
    """
    from src.modules.billing.stripe.stripe_service import StripeService

    if not StripeService.is_enabled():
        raise HTTPException(status_code=503, detail="Stripe is not enabled")

    # 1. Retrieve the checkout session from Stripe
    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=['subscription'])
    except stripe.error.StripeError as e:
        logger.error(f"Error retrieving checkout session {session_id}: {e}")
        raise HTTPException(status_code=400, detail="Invalid checkout session")

    if session.payment_status not in ('paid', 'no_payment_required'):
        return {"success": False, "message": "Payment not completed yet"}

    metadata = session.metadata or {}
    organization_id = metadata.get('organization_id')
    plan_slug = metadata.get('plan_slug')

    if not organization_id or not plan_slug:
        raise HTTPException(status_code=400, detail="Missing metadata on checkout session")

    subscription_id = session.subscription if isinstance(session.subscription, str) else (session.subscription.id if session.subscription else None)
    customer_id = session.customer

    # 2. Look up the plan in the database
    stmt = select(SubscriptionPlan).where(SubscriptionPlan.slug == plan_slug)
    result = await db.execute(stmt)
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan '{plan_slug}' not found in database")

    # 3. Fetch the Stripe subscription object for status/period info
    stripe_sub = None
    if subscription_id:
        stripe_sub = await StripeService.get_subscription(subscription_id)

    sub_status = stripe_sub.status if stripe_sub else 'active'
    trial_end = (
        datetime.fromtimestamp(stripe_sub.trial_end, tz=timezone.utc)
        if stripe_sub and stripe_sub.trial_end else None
    )
    period_end = (
        datetime.fromtimestamp(stripe_sub.current_period_end, tz=timezone.utc)
        if stripe_sub and stripe_sub.current_period_end else None
    )
    provider_metadata = {}
    if stripe_sub:
        try:
            provider_metadata = {
                'price_id': stripe_sub['items']['data'][0].price.id,
                'interval': stripe_sub['items']['data'][0].price.recurring.interval,
            }
        except Exception:
            pass

    # 4. Create or update organization subscription
    stmt = select(OrganizationSubscription).where(
        OrganizationSubscription.organization_id == organization_id
    )
    result = await db.execute(stmt)
    org_subscription = result.scalar_one_or_none()

    if org_subscription:
        org_subscription.plan_id = plan.id
        org_subscription.status = sub_status
        org_subscription.provider = 'stripe'
        org_subscription.provider_subscription_id = subscription_id
        org_subscription.provider_customer_id = customer_id
        org_subscription.trial_ends_at = trial_end
        org_subscription.ends_at = period_end
        org_subscription.provider_metadata = provider_metadata
    else:
        org_subscription = OrganizationSubscription(
            organization_id=organization_id,
            plan_id=plan.id,
            status=sub_status,
            provider='stripe',
            provider_subscription_id=subscription_id,
            provider_customer_id=customer_id,
            trial_ends_at=trial_end,
            ends_at=period_end,
            provider_metadata=provider_metadata,
        )
        db.add(org_subscription)

    await db.commit()
    logger.info(f"verify-session: Subscription provisioned for org {organization_id}, plan={plan_slug}, status={sub_status}")

    # --- Write payment_history record (idempotent) ---
    # Stripe webhooks won't reach a local dev server, so we record the payment
    # here synchronously using the Stripe API.  In production the webhook
    # handler does the same write, so we guard against duplicates.
    try:
        # Retrieve the latest invoice for the subscription
        latest_invoice_id = stripe_sub.latest_invoice if stripe_sub else None
        if latest_invoice_id:
            invoice = stripe.Invoice.retrieve(str(latest_invoice_id))
            if invoice and invoice.status == "paid" and invoice.amount_paid > 0:
                # Idempotency: skip if already recorded
                existing_stmt = select(PaymentHistory).where(
                    PaymentHistory.provider_invoice_id == invoice.id
                )
                existing_result = await db.execute(existing_stmt)
                existing_payment = existing_result.scalar_one_or_none()

                if not existing_payment:
                    paid_at_ts = (
                        invoice.status_transitions.paid_at
                        if invoice.status_transitions and invoice.status_transitions.paid_at
                        else invoice.created
                    )
                    description = f"Subscription payment - {plan_slug} plan"
                    try:
                        line_desc = invoice.lines.data[0].description if invoice.lines.data else None
                        if line_desc:
                            description = line_desc
                    except Exception:
                        pass

                    payment = PaymentHistory(
                        organization_id=organization_id,
                        amount=invoice.amount_paid / 100.0,
                        currency=invoice.currency.upper(),
                        description=description,
                        provider="stripe",
                        provider_transaction_id=invoice.payment_intent,
                        provider_invoice_id=invoice.id,
                        payment_method=invoice.collection_method or "charge_automatically",
                        provider_metadata={
                            "invoice_number": invoice.number,
                            "subscription_id": subscription_id,
                            "plan_slug": plan_slug,
                            "hosted_invoice_url": invoice.hosted_invoice_url or None,
                            "invoice_pdf": invoice.invoice_pdf or None,
                        },
                        paid_at=datetime.fromtimestamp(paid_at_ts, tz=timezone.utc),
                    )
                    db.add(payment)
                    await db.commit()
                    logger.info(
                        f"verify-session: Payment recorded for org {organization_id}: "
                        f"${invoice.amount_paid / 100.0} {invoice.currency.upper()} (invoice {invoice.id})"
                    )
                else:
                    logger.info(f"verify-session: Payment already recorded for invoice {invoice.id}, skipping")
    except Exception as e:
        logger.warning(f"verify-session: Could not record payment history for org {organization_id}: {e}")
        # Non-fatal — subscription is already active, billing history will sync via webhook

    return {
        "success": True,
        "plan_slug": plan_slug,
        "status": sub_status,
        "message": "Subscription activated"
    }


@router.post("/billing-portal")
async def create_billing_portal_session(
    return_url: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Create a Stripe billing portal session for customer to manage their subscription.
    
    Args:
        return_url: URL to redirect after exiting the portal
    """
    from src.modules.billing.stripe.stripe_service import StripeService
    
    try:
        # Check if Stripe is enabled
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )
        
        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')
        
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )
        
        # Get organization
        org_id = await get_user_organization_id(user_id, db)
        
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )
        
        # Get organization subscription to find customer ID
        stmt = select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id
        )
        result = await db.execute(stmt)
        org_subscription = result.scalar_one_or_none()
        
        if not org_subscription or not org_subscription.provider_customer_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active Stripe subscription found"
            )
        
        # Create billing portal session
        session = await StripeService.create_billing_portal_session(
            customer_id=org_subscription.provider_customer_id,
            return_url=return_url
        )
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create billing portal session"
            )
        
        return {
            "success": True,
            "portal_url": session.url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating billing portal session: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error creating billing portal session"
        )


@router.get("/payment-methods")
async def get_payment_methods(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """List saved Stripe card payment methods for the authenticated organization."""
    from src.modules.billing.stripe.stripe_service import StripeService

    try:
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )

        user_id, _ = _extract_user_identity(current_token)
        org_id = await get_user_organization_id(user_id, db)
        if not org_id:
            return {
                "success": True,
                "payment_methods": [],
                "default_payment_method_id": None,
            }

        stmt = select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id
        )
        result = await db.execute(stmt)
        org_subscription = result.scalar_one_or_none()

        customer_id = org_subscription.provider_customer_id if org_subscription else None
        if not customer_id:
            return {
                "success": True,
                "payment_methods": [],
                "default_payment_method_id": None,
            }

        customer = stripe.Customer.retrieve(customer_id)
        default_payment_method_id = None
        try:
            invoice_settings = getattr(customer, 'invoice_settings', None)
            default_pm = getattr(invoice_settings, 'default_payment_method', None) if invoice_settings else None
            if isinstance(default_pm, str):
                default_payment_method_id = default_pm
            elif default_pm is not None:
                default_payment_method_id = getattr(default_pm, 'id', None)
        except Exception:
            default_payment_method_id = None

        payment_methods = stripe.PaymentMethod.list(
            customer=customer_id,
            type='card',
            limit=50,
        )

        records = []
        for pm in payment_methods.data:
            card = getattr(pm, 'card', None)
            billing_details = getattr(pm, 'billing_details', None)
            records.append({
                "id": pm.id,
                "brand": getattr(card, 'brand', 'card') if card else 'card',
                "last4": getattr(card, 'last4', None),
                "exp_month": getattr(card, 'exp_month', None),
                "exp_year": getattr(card, 'exp_year', None),
                "name_on_card": getattr(billing_details, 'name', None) if billing_details else None,
                "is_default": pm.id == default_payment_method_id,
            })

        return {
            "success": True,
            "payment_methods": records,
            "default_payment_method_id": default_payment_method_id,
        }
    except HTTPException:
        raise
    except stripe.error.StripeError as e:
        logger.error(f"Error listing payment methods: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Error retrieving payment methods from Stripe"
        )
    except Exception as e:
        logger.error(f"Error listing payment methods: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving payment methods"
        )


@router.post("/payment-methods/setup-intent")
async def create_payment_method_setup_intent(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """Create a SetupIntent used by Stripe Elements to securely save a card."""
    from src.modules.billing.stripe.stripe_service import StripeService
    from src.core.config import settings

    try:
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )

        if not settings.STRIPE_PUBLISHABLE_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe publishable key is not configured"
            )

        user_id, user_email = _extract_user_identity(current_token)
        org_id = await get_user_organization_id(user_id, db)
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )

        customer_id, _ = await _ensure_org_stripe_customer(
            org_id=org_id,
            user_id=user_id,
            user_email=user_email,
            db=db,
        )

        setup_intent = stripe.SetupIntent.create(
            customer=customer_id,
            payment_method_types=['card'],
            usage='off_session',
            metadata={
                'organization_id': str(org_id),
                'user_id': str(user_id),
            },
        )

        if not setup_intent or not setup_intent.client_secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create Stripe setup intent"
            )

        return {
            "success": True,
            "client_secret": setup_intent.client_secret,
            "publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
        }
    except HTTPException:
        raise
    except stripe.error.StripeError as e:
        logger.error(f"Error creating setup intent: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Error creating setup intent with Stripe"
        )
    except Exception as e:
        logger.error(f"Error creating setup intent: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error creating setup intent"
        )


@router.post("/payment-methods/default")
async def set_default_payment_method(
    payment_method_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """Set the default Stripe card for invoices/subscriptions."""
    from src.modules.billing.stripe.stripe_service import StripeService

    try:
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )

        user_id, user_email = _extract_user_identity(current_token)
        org_id = await get_user_organization_id(user_id, db)
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )

        customer_id, org_subscription = await _ensure_org_stripe_customer(
            org_id=org_id,
            user_id=user_id,
            user_email=user_email,
            db=db,
        )

        payment_method = stripe.PaymentMethod.retrieve(payment_method_id)
        payment_method_customer = getattr(payment_method, 'customer', None)

        if payment_method_customer and str(payment_method_customer) != str(customer_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment method does not belong to this customer"
            )

        if not payment_method_customer:
            stripe.PaymentMethod.attach(payment_method_id, customer=customer_id)

        stripe.Customer.modify(
            customer_id,
            invoice_settings={
                'default_payment_method': payment_method_id,
            },
        )

        provider_metadata = dict(org_subscription.provider_metadata or {})
        provider_metadata['default_payment_method'] = payment_method_id
        org_subscription.provider_metadata = provider_metadata
        await db.commit()

        return {
            "success": True,
            "default_payment_method_id": payment_method_id,
        }
    except HTTPException:
        raise
    except stripe.error.StripeError as e:
        logger.error(f"Error setting default payment method: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Error setting default payment method in Stripe"
        )
    except Exception as e:
        logger.error(f"Error setting default payment method: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error setting default payment method"
        )


@router.delete("/payment-methods/{payment_method_id}")
async def delete_payment_method(
    payment_method_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """Detach a saved Stripe card from the authenticated organization's customer."""
    from src.modules.billing.stripe.stripe_service import StripeService

    try:
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )

        user_id, _ = _extract_user_identity(current_token)
        org_id = await get_user_organization_id(user_id, db)
        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )

        stmt = select(OrganizationSubscription).where(
            OrganizationSubscription.organization_id == org_id
        )
        result = await db.execute(stmt)
        org_subscription = result.scalar_one_or_none()
        customer_id = org_subscription.provider_customer_id if org_subscription else None

        if not customer_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No Stripe customer found"
            )

        payment_method = stripe.PaymentMethod.retrieve(payment_method_id)
        payment_method_customer = getattr(payment_method, 'customer', None)
        if not payment_method_customer or str(payment_method_customer) != str(customer_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment method not found for this customer"
            )

        customer = stripe.Customer.retrieve(customer_id)
        default_payment_method_id = None
        try:
            invoice_settings = getattr(customer, 'invoice_settings', None)
            default_pm = getattr(invoice_settings, 'default_payment_method', None) if invoice_settings else None
            if isinstance(default_pm, str):
                default_payment_method_id = default_pm
            elif default_pm is not None:
                default_payment_method_id = getattr(default_pm, 'id', None)
        except Exception:
            default_payment_method_id = None

        stripe.PaymentMethod.detach(payment_method_id)

        if default_payment_method_id == payment_method_id:
            stripe.Customer.modify(
                customer_id,
                invoice_settings={'default_payment_method': None},
            )
            provider_metadata = dict(org_subscription.provider_metadata or {})
            if provider_metadata.get('default_payment_method') == payment_method_id:
                provider_metadata.pop('default_payment_method', None)
                org_subscription.provider_metadata = provider_metadata
                await db.commit()

        return {
            "success": True,
        }
    except HTTPException:
        raise
    except stripe.error.StripeError as e:
        logger.error(f"Error removing payment method: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Error removing payment method from Stripe"
        )
    except Exception as e:
        logger.error(f"Error removing payment method: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error removing payment method"
        )


@router.get("/payment-history")
async def get_payment_history(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Get payment history for the authenticated user's organization.
    Returns all past invoices/payments ordered by most recent first.
    """
    try:
        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')

        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )

        # Get organization
        org_id = await get_user_organization_id(user_id, db)

        if not org_id:
            return {
                "success": True,
                "payments": []
            }

        # Fetch payment history
        stmt = (
            select(PaymentHistory)
            .where(PaymentHistory.organization_id == org_id)
            .order_by(PaymentHistory.paid_at.desc())
        )
        result = await db.execute(stmt)
        payments = result.scalars().all()

        # Build response, lazily fetching Stripe invoice URLs for records that
        # have a provider_invoice_id but no cached URL in provider_metadata yet.
        payment_records = []
        needs_commit = False
        for payment in payments:
            meta = dict(payment.provider_metadata or {})
            hosted_url = meta.get("hosted_invoice_url")
            pdf_url = meta.get("invoice_pdf")

            if (
                payment.provider == "stripe"
                and payment.provider_invoice_id
                and payment.provider_invoice_id.startswith("in_")
                and (not hosted_url or not pdf_url)
            ):
                try:
                    stripe_invoice = stripe.Invoice.retrieve(payment.provider_invoice_id)
                    hosted_url = stripe_invoice.hosted_invoice_url or hosted_url
                    pdf_url = stripe_invoice.invoice_pdf or pdf_url
                    # Cache back so we don't hit Stripe every time
                    meta["hosted_invoice_url"] = hosted_url
                    meta["invoice_pdf"] = pdf_url
                    payment.provider_metadata = meta
                    needs_commit = True
                except Exception as stripe_err:
                    logger.warning(f"Could not fetch Stripe invoice {payment.provider_invoice_id}: {stripe_err}")

            payment_records.append({
                "id": str(payment.id),
                "amount": float(payment.amount) if payment.amount else 0,
                "currency": payment.currency or "usd",
                "description": payment.description,
                "provider": payment.provider,
                "provider_invoice_id": payment.provider_invoice_id,
                "invoice_number": meta.get("invoice_number"),
                "payment_method": payment.payment_method,
                "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
                "created_at": payment.created_at.isoformat() if payment.created_at else None,
                "hosted_invoice_url": hosted_url,
                "invoice_pdf": pdf_url,
            })

        if needs_commit:
            await db.commit()

        return {
            "success": True,
            "payments": payment_records,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting payment history: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error retrieving payment history"
        )


@router.post("/cancel-subscription")
async def cancel_subscription(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
) -> Dict[str, Any]:
    """
    Cancel the current subscription for the authenticated user's organization.
    Cancels at the end of the current billing period (does not immediately revoke access).
    """
    from src.modules.billing.stripe.stripe_service import StripeService

    try:
        # Check if Stripe is enabled
        if not StripeService.is_enabled():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe integration is not enabled"
            )

        # Extract user_id from token
        user_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('sub') or current_token.get('user_id')

        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token"
            )

        # Get organization
        org_id = await get_user_organization_id(user_id, db)

        if not org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No organization found"
            )

        # Get organization subscription
        stmt = select(OrganizationSubscription).where(
            and_(
                OrganizationSubscription.organization_id == org_id,
                OrganizationSubscription.status.in_(['active', 'trialing'])
            )
        )
        result = await db.execute(stmt)
        org_subscription = result.scalar_one_or_none()

        if not org_subscription:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active subscription found"
            )

        if not org_subscription.provider_subscription_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subscription has no provider subscription ID"
            )

        # Cancel at end of period via Stripe
        canceled_sub = await StripeService.cancel_subscription(
            org_subscription.provider_subscription_id
        )

        if not canceled_sub:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to cancel subscription with Stripe"
            )

        # Update local record
        org_subscription.status = 'canceled'
        # Set ends_at from Stripe's current_period_end so grace-period logic works
        if canceled_sub.current_period_end:
            org_subscription.ends_at = datetime.fromtimestamp(
                canceled_sub.current_period_end, tz=timezone.utc
            )
        await db.commit()

        return {
            "success": True,
            "message": "Subscription canceled. Access continues until end of current billing period.",
            "ends_at": org_subscription.ends_at.isoformat() if org_subscription.ends_at else None
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error canceling subscription: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error canceling subscription"
        )
