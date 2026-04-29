"""Feed service seed helpers."""
from __future__ import annotations

from datetime import timedelta
import os
from typing import Dict, List, Sequence
from uuid import NAMESPACE_DNS, UUID, uuid5

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedComment as FeedCommentModel, FeedEvent, FeedPost
from src.modules.user.models import User
from src.modules.feed.schemas import AssetType, FeedVisibility, PublicationStatus
from src.modules.feed.service_utils import _utcnow

_TRUTHY_ENV_VALUES = ("1", "true", "yes")


def feed_seed_user_ids() -> List[UUID]:
    return [uuid5(NAMESPACE_DNS, f"feed-seed-user-{index}") for index in range(1, 6)]


def feed_seed_asset_ids(total_posts: int = 30) -> List[UUID]:
    return [uuid5(NAMESPACE_DNS, f"feed-seed-asset-{index}") for index in range(1, total_posts + 1)]


class FeedServiceSeedMixin:
    db: AsyncSession

    _MOCK_AUTHORS: Sequence[Dict[str, str]] = (
        {"name": "Maya Chen", "title": "Analytics Lead"},
        {"name": "Sophea Meas", "title": "Senior Data Analyst"},
        {"name": "Vibol Keo", "title": "Product Strategy"},
        {"name": "Diego Ramos", "title": "Growth Analyst"},
        {"name": "Aisha Patel", "title": "Product Ops"},
        {"name": "Liam Park", "title": "Data Engineer"},
        {"name": "Sara Ibrahim", "title": "Revenue Analyst"},
        {"name": "Kallyane Reth", "title": "Business Intelligence"},
    )
    _MOCK_TAGS: Sequence[str] = (
        "revenue",
        "growth",
        "retention",
        "forecast",
        "pipeline",
        "activation",
        "churn",
        "product",
        "support",
        "finance",
        "ops",
    )
    _MOCK_TITLES: Sequence[str] = (
        "Q4 revenue acceleration breakdown",
        "ការវិភាគលម្អិតអំពីការកើនឡើងចំណូលប្រចាំត្រីមាសទី ៤",
        "Activation funnel drop-off investigation",
        "ការស៊ើបអង្កេតលើការធ្លាក់ចុះនៃដំណាក់កាលសកម្មភាពរបស់អ្នកប្រើប្រាស់",
        "Customer retention heatmap by cohort",
        "Pipeline velocity vs. conversion rate",
        "ផលិតផល និងសូចនាករសំខាន់ៗប្រចាំសប្តាហ៍",
        "Weekly growth experiment insights",
        "Product adoption pulse check",
        "សេចក្តីសង្ខេបអំពីដំណើរការការងារ និងផលិតភាព",
        "Executive KPI narrative summary",
        "Churn risk early-warning signals",
    )
    _MOCK_DESCRIPTIONS: Sequence[str] = (
        "Highlights the strongest lifts across verticals with segmented deltas and YoY benchmarks.",
        "បង្ហាញពីការកើនឡើងខ្លាំងបំផុតនៅតាមវិស័យនីមួយៗ ជាមួយនឹងការប្រៀបធៀបឆ្នាំលើឆ្នាំ។",
        "Summarizes friction points and suggests next best experiments for re-engagement.",
        "សង្ខេបអំពីចំណុចរាំងស្ទះ និងផ្តល់យោបល់សម្រាប់ការពិសោធន៍ថ្មីៗ ដើម្បីទាក់ទាញអ្នកប្រើប្រាស់មកវិញ។",
        "Compares cohort stickiness and retention drivers across product tiers.",
        "Tracks velocity by stage, highlighting wins and pipeline health risks.",
        "Surfaces the core adoption actions driving day-30 engagement.",
        "តាមដានសកម្មភាពសំខាន់ៗដែលជម្រុញឱ្យមានការចូលរួមប្រើប្រាស់ក្នុងរយៈពេល ៣០ ថ្ងៃ។",
        "Flags backlog hot spots and workload balance insights for support ops.",
        "Benchmarks channel efficiency and CAC trends for the last two quarters.",
        "Scores at-risk accounts and maps intervention priorities.",
        "សង្ខេបរបាយការណ៍សម្រាប់ថ្នាក់ដឹកនាំ និងការសម្រេចចិត្តបែបយុទ្ធសាស្ត្រ។",
    )

    async def _seed_mock_data_if_empty(self) -> None:
        # Feed mock seeding is opt-in. Otherwise cleared seed data will be recreated
        # the next time the feed is read in local/shared environments.
        seed_override = os.getenv("FEED_SEED_ENABLED", "").strip().lower()
        if seed_override not in _TRUTHY_ENV_VALUES:
            return

        await self.db.execute(text("SET LOCAL app.rls_bypass = 'true'"))

        count = await self.db.scalar(select(func.count()).select_from(FeedPost))
        if (count or 0) > 0:
            return

        now = _utcnow()

        seed_user_ids = feed_seed_user_ids()
        seed_users: List[User] = []
        for index, author in enumerate(self._MOCK_AUTHORS, start=1):
            user_id = seed_user_ids[index - 1]
            existing = await self.db.scalar(select(User).where(User.id == user_id))
            if existing:
                seed_users.append(existing)
                continue

            parts = author["name"].split(" ", 1)
            user = User(
                id=user_id,
                user_id=user_id,
                first_name=parts[0],
                last_name=parts[1] if len(parts) > 1 else None,
                company=author["title"],
            )
            self.db.add(user)
            seed_users.append(user)

        await self.db.flush()

        visibilities = [
            FeedVisibility.organization.value,
            FeedVisibility.public.value,
            FeedVisibility.project.value,
            FeedVisibility.organization.value,
        ]
        asset_types = [AssetType.dashboard.value, AssetType.chart.value]

        seed_asset_ids = feed_seed_asset_ids()
        posts: List[FeedPost] = []
        for index in range(30):
            asset_type = asset_types[index % len(asset_types)]
            visibility = visibilities[index % len(visibilities)]
            title = self._MOCK_TITLES[index % len(self._MOCK_TITLES)]
            description = self._MOCK_DESCRIPTIONS[index % len(self._MOCK_DESCRIPTIONS)]

            published_at = now - timedelta(days=(index % 18) + 1)
            comment_count = index % 3

            post = FeedPost(
                asset_type=asset_type,
                asset_id=seed_asset_ids[index],
                author_id=seed_users[index % len(seed_users)].id,
                visibility=visibility,
                status=PublicationStatus.approved.value,
                title=title,
                description=description,
                tags=[
                    self._MOCK_TAGS[index % len(self._MOCK_TAGS)],
                    self._MOCK_TAGS[(index + 3) % len(self._MOCK_TAGS)],
                    self._MOCK_TAGS[(index + 5) % len(self._MOCK_TAGS)],
                ],
                comment_count=comment_count,
                reaction_count=8 + (index * 3) % 28,
                save_count=2 + (index % 9),
                view_count=120 + (index * 31),
                created_at=published_at,
                published_at=published_at,
            )
            self.db.add(post)
            posts.append(post)

        await self.db.flush()

        for index, post in enumerate(posts):
            comment_total = index % 3
            for comment_index in range(comment_total):
                commenter = seed_users[(index + comment_index + 1) % len(seed_users)]
                comment = FeedCommentModel(
                    post_id=post.id,
                    user_id=commenter.id,
                    content=[
                        "This view makes the lift very clear.",
                        "ការវិភាគនេះបង្ហាញពីការកើនឡើងយ៉ាងច្បាស់។",
                        "Great insight. This supports the activation initiative.",
                    ][comment_index % 3],
                    mentions=[],
                )
                self.db.add(comment)

            event = FeedEvent(
                organization_id=post.organization_id,
                project_id=post.project_id,
                post_id=post.id,
                actor_id=post.author_id,
                target_user_id=None,
                type="publish",
                created_at=post.published_at or now,
            )
            self.db.add(event)

        await self.db.commit()
