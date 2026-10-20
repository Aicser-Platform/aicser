"""Ask threads opened from a dashboard, notebook or sheet send their metadata as an object."""

import json

from ee.modules.chats.conversations.schemas import ConversationSchema, ConversationUpdateSchema


def test_create_accepts_metadata_as_an_object_or_text():
    meta = {"surface": "dashboard", "surface_ref_id": "cc1edd43", "surface_title": "My dashboard"}
    assert json.loads(ConversationSchema(title="t", json_metadata=meta).json_metadata) == meta
    assert ConversationSchema(title="t", json_metadata='{"a": 1}').json_metadata == '{"a": 1}'
    assert ConversationSchema(title="t").json_metadata is None


def test_update_accepts_metadata_as_an_object():
    assert json.loads(ConversationUpdateSchema(json_metadata={"a": 1}).json_metadata) == {"a": 1}
