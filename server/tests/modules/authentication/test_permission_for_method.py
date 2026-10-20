from ee.modules.authentication.rbac.guard import permission_for_method


def test_post_uses_create_when_provided():
    assert (
        permission_for_method(
            "POST",
            view="alert:view",
            edit="alert:edit",
            delete="alert:delete",
            create="alert:create",
        )
        == "alert:create"
    )


def test_post_falls_back_to_edit():
    assert permission_for_method("POST", view="a", edit="b", delete="c") == "b"


def test_get_is_view():
    assert permission_for_method("GET", view="semantic:view", edit="semantic:edit", delete="semantic:delete") == "semantic:view"