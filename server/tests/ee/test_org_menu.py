import pytest
from pydantic import ValidationError

from src.modules.organizations.router import MENU_KEYS, OrgMenu, effective_menu


def test_assistants_wait_to_be_switched_on():
    assert effective_menu(None, has_assistants=False) == {"agents": "off"}


def test_an_organization_with_assistants_keeps_them():
    assert effective_menu(None, has_assistants=True) == {"agents": "everyone"}


def test_what_an_admin_chose_wins():
    assert effective_menu({"agents": "off", "alerts": "admins"}, has_assistants=True) == {"agents": "off", "alerts": "admins"}
    assert effective_menu({"agents": "admins"}, has_assistants=False)["agents"] == "admins"


def test_only_known_items_and_levels_are_saved():
    assert OrgMenu(items={"agents": "off", "catalog": "admins"}).items["catalog"] == "admins"
    with pytest.raises(ValidationError):
        OrgMenu(items={"settings": "off"})
    with pytest.raises(ValidationError):
        OrgMenu(items={"agents": "maybe"})
    assert "settings" not in MENU_KEYS
