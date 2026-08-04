def test_subscription_defaults_to_free_for_new_user(client, signup_and_login):
    headers, _ = signup_and_login()
    res = client.get("/api/v1/billing/subscription", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["plan"] == "free"
    assert body["status"] == "active"


def test_subscription_requires_auth(client):
    res = client.get("/api/v1/billing/subscription")
    assert res.status_code in (401, 403)


def test_checkout_rejects_unknown_plan(client, signup_and_login):
    headers, _ = signup_and_login()
    res = client.post("/api/v1/billing/checkout", json={"plan": "enterprise-deluxe"}, headers=headers)
    assert res.status_code == 400


def test_checkout_without_stripe_configured_returns_400(client, signup_and_login, monkeypatch):
    # In test env STRIPE_SECRET_KEY is blank, so this should fail cleanly with
    # a clear message rather than raising an unhandled Stripe SDK error.
    headers, _ = signup_and_login()
    res = client.post("/api/v1/billing/checkout", json={"plan": "pro"}, headers=headers)
    assert res.status_code == 400
    assert "not configured" in res.json()["detail"].lower() or "unknown" in res.json()["detail"].lower()


def test_webhook_rejects_missing_signature(client):
    res = client.post(
        "/api/v1/billing/webhook",
        content=b'{"type": "checkout.session.completed"}',
        headers={"Content-Type": "application/json"},
    )
    # With no STRIPE_WEBHOOK_SECRET configured in test env, construct_event
    # raises BillingError -> 503, which is still a safe rejection (never a
    # silent 200 on unverified input).
    assert res.status_code in (400, 503)


def test_webhook_rejects_bad_signature(client, monkeypatch):
    import app.services.billing as billing_module

    monkeypatch.setattr(billing_module.settings, "STRIPE_WEBHOOK_SECRET", "whsec_test_dummy")

    res = client.post(
        "/api/v1/billing/webhook",
        content=b'{"type": "checkout.session.completed"}',
        headers={"Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef"},
    )
    assert res.status_code == 400
