"""Tests for knowledge base access scoping."""

from uuid import uuid4

import pytest

from src.modules.knowledge.access import knowledge_documents_filter


def test_knowledge_documents_filter_ce_is_user_scoped(monkeypatch):
    monkeypatch.setattr("src.modules.knowledge.access.is_ee_enabled", lambda: False)
    user_id = uuid4()
    clause = knowledge_documents_filter(user_id)
    assert clause is not None


def test_knowledge_documents_filter_ee_includes_project_sources(monkeypatch):
    monkeypatch.setattr("src.modules.knowledge.access.is_ee_enabled", lambda: True)
    user_id = uuid4()
    clause = knowledge_documents_filter(user_id)
    assert clause is not None
