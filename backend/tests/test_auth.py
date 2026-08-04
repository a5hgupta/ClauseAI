def test_signup_returns_tokens(client):
    res = client.post(
        "/api/v1/auth/signup",
        json={"email": "alice@example.com", "password": "correcthorsebattery1", "name": "Alice"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["access_token"]
    assert body["refresh_token"]


def test_signup_duplicate_email_rejected(client):
    payload = {"email": "bob@example.com", "password": "correcthorsebattery1", "name": "Bob"}
    first = client.post("/api/v1/auth/signup", json=payload)
    assert first.status_code == 201

    second = client.post("/api/v1/auth/signup", json=payload)
    assert second.status_code == 400
    # Deliberately vague error — must not confirm the email exists via a
    # different message than a generic failure would give.
    assert "could not create account" in second.json()["detail"].lower()


def test_login_with_correct_password(client):
    client.post(
        "/api/v1/auth/signup",
        json={"email": "carol@example.com", "password": "correcthorsebattery1", "name": "Carol"},
    )
    res = client.post("/api/v1/auth/login", json={"email": "carol@example.com", "password": "correcthorsebattery1"})
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_login_with_wrong_password_rejected(client):
    client.post(
        "/api/v1/auth/signup",
        json={"email": "dave@example.com", "password": "correcthorsebattery1", "name": "Dave"},
    )
    res = client.post("/api/v1/auth/login", json={"email": "dave@example.com", "password": "wrong-password"})
    assert res.status_code == 401


def test_me_requires_auth(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code in (401, 403)


def test_me_returns_current_user(client, signup_and_login):
    headers, email = signup_and_login()
    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["email"] == email


def test_refresh_token_rotation(client):
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "erin@example.com", "password": "correcthorsebattery1", "name": "Erin"},
    ).json()

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": signup["refresh_token"]})
    assert refreshed.status_code == 200
    new_tokens = refreshed.json()
    assert new_tokens["refresh_token"] != signup["refresh_token"]

    # Reusing the now-rotated-out old refresh token must fail (reuse detection).
    reused = client.post("/api/v1/auth/refresh", json={"refresh_token": signup["refresh_token"]})
    assert reused.status_code == 401
