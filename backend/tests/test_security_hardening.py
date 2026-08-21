import http.client
import os
import re
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

TEST_DIR = Path(tempfile.mkdtemp(prefix="pulsewatch-security-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_DIR / 'security.db').as_posix()}"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-with-at-least-32-bytes"
os.environ["AGENT_AUTH_TOKEN"] = "test-agent-token"
os.environ["ALLOWED_ORIGINS"] = "https://testserver"

import main  # noqa: E402
import metric_agent  # noqa: E402
from database import Base, OTPCode, SessionLocal, User, engine  # noqa: E402


VALID_PASSWORD = "Secure1!"


@pytest.fixture(autouse=True)
def clean_database_and_limits(monkeypatch):
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    main.auth_rate_limiter._attempts.clear()
    monkeypatch.setattr(main, "acquire_scheduler_lock", lambda: False)
    yield
    main.app.dependency_overrides.clear()
    main.auth_rate_limiter._attempts.clear()


@pytest.fixture
def client():
    with TestClient(main.app, base_url="https://testserver", raise_server_exceptions=False) as test_client:
        yield test_client


def create_user(username="security-user", password=VALID_PASSWORD, two_factor=False):
    db = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=main.hash_password(password),
            email=f"{username}@example.com",
            is_2fa_enabled=1 if two_factor else 0,
            session_version=0,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id
    finally:
        db.close()


def create_otp(user_id, code="123456", action="update_settings"):
    db = SessionLocal()
    try:
        db.add(
            OTPCode(
                user_id=user_id,
                code=code,
                action=action,
                expires_at=(datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
            )
        )
        db.commit()
    finally:
        db.close()


def login(client, username="security-user", password=VALID_PASSWORD):
    response = client.post("/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response


def test_rate_limiting_blocks_sixth_failed_login(client):
    responses = [
        client.post("/login", json={"username": "missing-user", "password": "Wrong1!"})
        for _ in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [401] * 5
    assert responses[5].status_code == 429
    assert "Retry-After" in responses[5].headers


def test_atomic_otp_consumption_allows_exactly_one_consumer():
    user_id = create_user()
    create_otp(user_id)
    barrier = threading.Barrier(2)

    def consume_once():
        db = SessionLocal()
        try:
            barrier.wait(timeout=5)
            consumed = main.consume_otp(db, user_id, "123456", "update_settings")
            db.commit()
            return consumed
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: consume_once(), range(2)))

    assert sorted(results) == [False, True]


def test_old_cookie_is_rejected_after_password_change(client):
    user_id = create_user()
    login(client)
    original_cookie = client.cookies.get(main.SESSION_COOKIE_NAME)
    assert original_cookie
    create_otp(user_id)

    change_response = client.put(
        "/users/password",
        json={
            "current_password": VALID_PASSWORD,
            "new_password": "Changed2@",
            "otp_code": "123456",
        },
    )
    assert change_response.status_code == 200

    old_session = TestClient(main.app, base_url="https://testserver", raise_server_exceptions=False)
    old_session.cookies.set(main.SESSION_COOKIE_NAME, original_cookie, domain="testserver", path="/")
    try:
        assert old_session.get("/users/me").status_code == 401
    finally:
        old_session.close()


def test_email_change_requires_current_password(client):
    user_id = create_user()
    login(client)
    create_otp(user_id)

    response = client.put(
        "/users/email",
        json={"email": "new-address@example.com", "otp_code": "123456"},
    )

    assert response.status_code == 400
    assert "current password" in response.json()["detail"].lower()


def test_metric_agent_rejects_raw_token_without_bearer_prefix():
    server = metric_agent.HTTPServer(("127.0.0.1", 0), metric_agent.MetricHandler)
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    try:
        connection.request(
            "GET",
            "/api/metrics",
            headers={"Authorization": metric_agent.AGENT_AUTH_TOKEN},
        )
        response = connection.getresponse()
        response.read()
        assert response.status == 401
    finally:
        connection.close()
        thread.join(timeout=5)
        server.server_close()


def test_unexpected_database_error_is_masked_with_correlation_id(client):
    raw_database_error = "SELECT password_hash FROM users WHERE secret = 1"

    def broken_database_dependency():
        raise RuntimeError(raw_database_error)
        yield

    main.app.dependency_overrides[main.get_db] = broken_database_dependency
    response = client.get("/users/me")

    assert response.status_code == 500
    payload = response.json()
    assert payload["detail"] == "An unexpected server error occurred"
    assert re.fullmatch(r"[0-9a-f-]{36}", payload["correlation_id"])
    assert raw_database_error not in response.text
    assert "SELECT" not in response.text
