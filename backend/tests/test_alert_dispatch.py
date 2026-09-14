"""Contract tests for the state-transition webhook dispatcher.

These cover the payload shape expected by the frontend-configured channels:
red embeds for outages, green embeds for recoveries, the probe's failure reason
carried through to every channel type, and per-monitor alert routing.
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx
import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

TEST_DIR = Path(tempfile.mkdtemp(prefix="pulsewatch-alert-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_DIR / 'alerts.db').as_posix()}"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-with-at-least-32-bytes"
os.environ["AGENT_AUTH_TOKEN"] = "test-agent-token"
os.environ["ALLOWED_ORIGINS"] = "https://testserver"

import main  # noqa: E402
from database import Base, NotificationChannel, Server, SessionLocal, User, engine  # noqa: E402
from sqlalchemy import text  # noqa: E402


DISCORD_RED = 15158332
DISCORD_GREEN = 3066993

DOWN_ALERT = {
    "server_id": 7,
    "user_id": None,
    "hostname": "api-gateway",
    "server_role": "API",
    "target_address": "https://api.example.com/health",
    "status": "DOWN",
    "previous_status": "UP",
    "reason": "Expected HTTP 200, got 503",
    "timestamp": "2026-09-14T10:00:00+00:00",
    "message": "api-gateway is DOWN",
}


class Recorder:
    """Replays response statuses in order and captures every outbound POST."""

    def __init__(self, statuses=(204,)):
        self.statuses = list(statuses)
        self.payloads = []
        self.urls = []
        self.count = 0
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self._handle))

    def _handle(self, request):
        self.payloads.append(json.loads(request.content.decode()))
        self.urls.append(str(request.url))
        index = min(self.count, len(self.statuses) - 1)
        self.count += 1
        return httpx.Response(self.statuses[index], json={"ok": self.statuses[index] < 400})


@pytest.fixture(autouse=True)
def clean_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def no_dispatch_backoff(monkeypatch):
    monkeypatch.setattr(main, "ALERT_DISPATCH_BACKOFF_SECONDS", 0)


def dispatch_direct(channel_type, alert, statuses=(204,)):
    recorder = Recorder(statuses)

    async def run():
        async with recorder.client:
            return await main.dispatch_single_notification(
                recorder.client,
                {"channel_type": channel_type, "destination_url": "https://hooks.test/endpoint"},
                alert,
            )

    return asyncio.run(run()), recorder


def create_user(username):
    db = SessionLocal()
    try:
        user = User(username=username, password_hash="hash")
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def create_monitor(user_id, hostname):
    db = SessionLocal()
    try:
        monitor = Server(
            user_id=user_id,
            hostname=hostname,
            server_role="Web",
            target_address=f"https://{hostname}.example.com",
        )
        db.add(monitor)
        db.commit()
        return monitor.server_id
    finally:
        db.close()


def create_channel(user_id, destination_url, server_id=None, is_active=1, channel_type="webhook"):
    db = SessionLocal()
    try:
        channel = NotificationChannel(
            user_id=user_id,
            server_id=server_id,
            channel_type=channel_type,
            destination_url=destination_url,
            is_active=is_active,
        )
        db.add(channel)
        db.commit()
        return channel.id
    finally:
        db.close()


def dispatch_transitions(monkeypatch, transitions):
    recorder = Recorder()

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return recorder.client

        async def __aexit__(self, *exc_info):
            return False

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    asyncio.run(main.dispatch_state_transition_alerts(transitions))
    return recorder


def test_discord_outage_uses_red_theme_and_includes_monitor_and_reason():
    _, recorder = dispatch_direct("discord", DOWN_ALERT)
    embed = recorder.payloads[0]["embeds"][0]
    assert embed["color"] == DISCORD_RED
    fields = {field["name"]: field["value"] for field in embed["fields"]}
    assert fields["Hostname"] == "api-gateway"
    assert fields["Reason"] == "Expected HTTP 200, got 503"
    assert embed["title"] == "Server Status: DOWN"


def test_discord_recovery_uses_green_theme():
    alert = {**DOWN_ALERT, "status": "UP", "previous_status": "DOWN"}
    alert["reason"] = "Health check is passing again."
    _, recorder = dispatch_direct("discord", alert)
    embed = recorder.payloads[0]["embeds"][0]
    assert embed["color"] == DISCORD_GREEN
    fields = {field["name"]: field["value"] for field in embed["fields"]}
    assert fields["Status"] == "UP"
    assert fields["Reason"] == "Health check is passing again."


def test_slack_payload_includes_monitor_and_reason():
    _, recorder = dispatch_direct("slack", DOWN_ALERT)
    text = recorder.payloads[0]["text"]
    assert "api-gateway" in text
    assert "DOWN" in text
    assert "*Reason:* Expected HTTP 200, got 503" in text


def test_generic_webhook_payload_carries_reason_and_transition():
    _, recorder = dispatch_direct("webhook", DOWN_ALERT)
    payload = recorder.payloads[0]
    assert payload["event"] == "server.status_change"
    assert payload["status"] == "DOWN"
    assert payload["previous_status"] == "UP"
    assert payload["reason"] == "Expected HTTP 200, got 503"


def test_dispatch_retries_transient_failure_then_succeeds():
    _, recorder = dispatch_direct("discord", DOWN_ALERT, statuses=(500, 204))
    assert recorder.count == 2
    assert len(recorder.payloads) == 2


def test_dispatch_gives_up_after_configured_attempts():
    response, recorder = dispatch_direct("discord", DOWN_ALERT, statuses=(500,))
    assert response is None
    assert recorder.count == main.ALERT_DISPATCH_ATTEMPTS


def test_monitor_scoped_channel_only_receives_its_own_monitor_alerts(monkeypatch):
    user_id = create_user("owner")
    api_id = create_monitor(user_id, "api")
    web_id = create_monitor(user_id, "web")
    create_channel(user_id, "https://hooks.test/api-only", server_id=api_id)
    create_channel(user_id, "https://hooks.test/web-only", server_id=web_id)

    recorder = dispatch_transitions(
        monkeypatch, [{**DOWN_ALERT, "user_id": user_id, "server_id": api_id}]
    )

    assert recorder.urls == ["https://hooks.test/api-only"]


def test_global_channel_is_a_fallback_for_every_monitor(monkeypatch):
    user_id = create_user("owner")
    api_id = create_monitor(user_id, "api")
    web_id = create_monitor(user_id, "web")
    create_channel(user_id, "https://hooks.test/global")
    create_channel(user_id, "https://hooks.test/api-only", server_id=api_id)

    recorder = dispatch_transitions(
        monkeypatch,
        [
            {**DOWN_ALERT, "user_id": user_id, "server_id": api_id},
            {**DOWN_ALERT, "user_id": user_id, "server_id": web_id},
        ],
    )

    assert sorted(recorder.urls) == [
        "https://hooks.test/api-only",
        "https://hooks.test/global",
        "https://hooks.test/global",
    ]


def test_paused_channels_and_other_accounts_are_never_dispatched(monkeypatch):
    owner_id = create_user("owner")
    other_id = create_user("other")
    monitor_id = create_monitor(owner_id, "api")
    create_channel(owner_id, "https://hooks.test/active", server_id=monitor_id)
    create_channel(owner_id, "https://hooks.test/paused", server_id=monitor_id, is_active=0)
    create_channel(other_id, "https://hooks.test/other-account")

    recorder = dispatch_transitions(
        monkeypatch, [{**DOWN_ALERT, "user_id": owner_id, "server_id": monitor_id}]
    )

    assert recorder.urls == ["https://hooks.test/active"]
    assert recorder.payloads[0]["reason"] == "Expected HTTP 200, got 503"


def test_channel_cannot_target_another_accounts_monitor():
    owner_id = create_user("owner")
    other_id = create_user("other")
    foreign_monitor = create_monitor(other_id, "foreign")

    db = SessionLocal()
    try:
        assert main.resolve_channel_server_id(db, owner_id, None) is None
        with pytest.raises(main.HTTPException) as exc_info:
            main.resolve_channel_server_id(db, owner_id, foreign_monitor)
    finally:
        db.close()

    assert exc_info.value.status_code == 404


def test_delete_server_removes_pinned_channels_and_keeps_global_ones():
    user_id = create_user("owner")
    monitor_id = create_monitor(user_id, "api")
    other_monitor_id = create_monitor(user_id, "web")
    create_channel(user_id, "https://hooks.test/pinned", server_id=monitor_id)
    create_channel(user_id, "https://hooks.test/other-monitor", server_id=other_monitor_id)
    create_channel(user_id, "https://hooks.test/global")

    db = SessionLocal()
    try:
        result = main.delete_server(monitor_id, current_user_id=user_id, db=db)
    finally:
        db.close()

    assert result["notification_channels_removed"] == 1

    db = SessionLocal()
    try:
        remaining_urls = [
            row[0]
            for row in db.query(NotificationChannel.destination_url)
            .order_by(NotificationChannel.id)
            .all()
        ]
        assert db.query(Server).filter(Server.server_id == monitor_id).first() is None
    finally:
        db.close()

    assert remaining_urls == ["https://hooks.test/other-monitor", "https://hooks.test/global"]


def test_database_level_cascade_removes_pinned_channels_with_the_monitor_row():
    """The schema rule itself must fire, not just the endpoint's explicit delete."""
    user_id = create_user("owner")
    monitor_id = create_monitor(user_id, "api")
    other_monitor_id = create_monitor(user_id, "web")
    create_channel(user_id, "https://hooks.test/pinned", server_id=monitor_id)
    create_channel(user_id, "https://hooks.test/other-monitor", server_id=other_monitor_id)
    create_channel(user_id, "https://hooks.test/global")

    db = SessionLocal()
    try:
        db.execute(text('DELETE FROM "Server" WHERE server_id = :sid'), {"sid": monitor_id})
        db.commit()
        remaining_urls = [
            row[0]
            for row in db.query(NotificationChannel.destination_url)
            .order_by(NotificationChannel.id)
            .all()
        ]
    finally:
        db.close()

    assert remaining_urls == ["https://hooks.test/other-monitor", "https://hooks.test/global"]
