from dotenv import load_dotenv
import os
import sqlite3
from pathlib import Path

load_dotenv()
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey, event, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL is None or not DATABASE_URL.strip():
    raise RuntimeError(
        "Fatal configuration error: required environment variable DATABASE_URL is missing or empty. "
        "Set it in the process environment or backend/.env before starting PulseWatch."
    )

DATABASE_URL = DATABASE_URL.strip()

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)

if engine.dialect.name == "sqlite":
    # SQLite ignores foreign keys unless they are enabled per connection, which
    # would leave ON DELETE CASCADE rules inert on the development database.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    email = Column(String, nullable=True)
    is_2fa_enabled = Column(Integer, default=0)
    session_version = Column(Integer, nullable=False, default=0)

class OTPCode(Base):
    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    code = Column(String, nullable=False)
    action = Column(String, nullable=False)
    expires_at = Column(String, nullable=False)

class Server(Base):
    __tablename__ = "Server"

    server_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    hostname = Column(String, nullable=False)
    server_role = Column(String, nullable=False)
    target_address = Column(String, nullable=False)
    monitor_type = Column(String, nullable=False, default="http", server_default="http")
    port = Column(Integer, nullable=True)
    push_token = Column(String, nullable=True, unique=True, index=True)
    expected_status_code = Column(Integer, nullable=False, default=200, server_default="200")
    heartbeat_interval_seconds = Column(Integer, nullable=True)
    dns_record_type = Column(String, nullable=True, default="A", server_default="A")
    last_heartbeat_at = Column(String, nullable=True)
    active_connections = Column(Integer, default=0)
    is_active = Column(Integer, default=1)
    ssl_expiry_date = Column(String, nullable=True)
    ssl_days_remaining = Column(Integer, nullable=True)

class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # NULL means the channel is an account-wide fallback that receives alerts
    # for every monitor owned by user_id. A pinned channel is removed with the
    # monitor it targets.
    server_id = Column(Integer, ForeignKey("Server.server_id", ondelete="CASCADE"), nullable=True, index=True)
    channel_type = Column(String, nullable=False)
    destination_url = Column(String, nullable=False)
    is_active = Column(Integer, default=1)

class HealthCheck(Base):
    __tablename__ = "HealthChecks"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, nullable=True)
    status = Column(Integer, nullable=True)
    timestamp = Column(String, nullable=True)
    cpu_usage = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)
    telemetry_json = Column(String, nullable=True)

class MetricRaw(Base):
    __tablename__ = "metrics_raw"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, nullable=True)
    status = Column(Integer, nullable=True)
    timestamp = Column(String, nullable=True)
    cpu_usage = Column(Float, nullable=True)
    ram_usage = Column(Float, nullable=True)

class MetricHourly(Base):
    __tablename__ = "metrics_hourly"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, nullable=True)
    timestamp = Column(String, nullable=True)
    avg_cpu = Column(Float, nullable=True)
    avg_ram = Column(Float, nullable=True)

NOTIFICATION_CHANNEL_CREATE_SQL = """
CREATE TABLE notification_channels (
    id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    server_id INTEGER,
    channel_type VARCHAR NOT NULL,
    destination_url VARCHAR NOT NULL,
    is_active INTEGER,
    PRIMARY KEY (id),
    CONSTRAINT notification_channels_user_id_fkey FOREIGN KEY(user_id) REFERENCES users (id),
    CONSTRAINT notification_channels_server_id_fkey FOREIGN KEY(server_id) REFERENCES "Server" (server_id) ON DELETE CASCADE
)
"""


def _has_server_cascade(inspector) -> bool:
    for foreign_key in inspector.get_foreign_keys("notification_channels"):
        referred_table = (foreign_key.get("referred_table") or "").lower()
        if referred_table == "server" and "server_id" in (foreign_key.get("constrained_columns") or []):
            return True
    return False


def _purge_orphaned_channel_targets() -> int:
    """Drop channels pinned to monitors that no longer exist.

    These rows can never fire an alert, and once foreign keys are enforced they
    would block updates to the channel, so they are removed during the upgrade.
    """
    with engine.begin() as conn:
        result = conn.execute(text(
            "DELETE FROM notification_channels WHERE server_id IS NOT NULL "
            'AND server_id NOT IN (SELECT server_id FROM "Server")'
        ))
        return result.rowcount or 0


def _rebuild_notification_channels_for_sqlite_cascade() -> None:
    """Recreate the table so SQLite picks up the ON DELETE CASCADE rule.

    SQLite cannot add a foreign key with ALTER TABLE, so the documented table
    rebuild is used. A dedicated autocommit connection is opened because
    PRAGMA foreign_keys is silently ignored inside a transaction.
    """
    db_path = engine.url.database
    if not db_path or db_path == ":memory:":
        return

    connection = sqlite3.connect(db_path, isolation_level=None)
    try:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("BEGIN")
        cursor.execute("ALTER TABLE notification_channels RENAME TO notification_channels_pre_cascade")
        cursor.execute(NOTIFICATION_CHANNEL_CREATE_SQL)
        cursor.execute(
            "INSERT INTO notification_channels (id, user_id, server_id, channel_type, destination_url, is_active) "
            "SELECT id, user_id, server_id, channel_type, destination_url, is_active "
            "FROM notification_channels_pre_cascade"
        )
        cursor.execute("DROP TABLE notification_channels_pre_cascade")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_notification_channels_server_id ON notification_channels (server_id)")
        cursor.execute("COMMIT")
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_notification_channel_cascade() -> None:
    """Apply ON DELETE CASCADE to notification_channels.server_id.

    create_all only covers brand new tables, so existing databases are upgraded
    in place: PostgreSQL can add the constraint directly, SQLite is rebuilt.
    """
    inspector = inspect(engine)
    if "notification_channels" not in inspector.get_table_names():
        return
    if _has_server_cascade(inspector):
        return

    removed = _purge_orphaned_channel_targets()
    if removed:
        print(
            f"[MIGRATION] Removed {removed} notification channel(s) pinned to monitors that no longer exist.",
            flush=True,
        )

    if engine.dialect.name == "sqlite":
        _rebuild_notification_channels_for_sqlite_cascade()
    else:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE notification_channels ADD CONSTRAINT notification_channels_server_id_fkey "
                'FOREIGN KEY (server_id) REFERENCES "Server" (server_id) ON DELETE CASCADE'
            ))


def init_db():
    Base.metadata.create_all(bind=engine)
    migrations = (
        ("Server", "ssl_expiry_date", 'ALTER TABLE "Server" ADD COLUMN ssl_expiry_date VARCHAR'),
        ("Server", "ssl_days_remaining", 'ALTER TABLE "Server" ADD COLUMN ssl_days_remaining INTEGER'),
        ("Server", "monitor_type", 'ALTER TABLE "Server" ADD COLUMN monitor_type VARCHAR NOT NULL DEFAULT \'http\''),
        ("Server", "port", 'ALTER TABLE "Server" ADD COLUMN port INTEGER'),
        ("Server", "push_token", 'ALTER TABLE "Server" ADD COLUMN push_token VARCHAR'),
        ("Server", "expected_status_code", 'ALTER TABLE "Server" ADD COLUMN expected_status_code INTEGER NOT NULL DEFAULT 200'),
        ("Server", "heartbeat_interval_seconds", 'ALTER TABLE "Server" ADD COLUMN heartbeat_interval_seconds INTEGER'),
        ("Server", "dns_record_type", 'ALTER TABLE "Server" ADD COLUMN dns_record_type VARCHAR DEFAULT \'A\''),
        ("Server", "last_heartbeat_at", 'ALTER TABLE "Server" ADD COLUMN last_heartbeat_at VARCHAR'),
        ("users", "session_version", 'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'),
        ("HealthChecks", "telemetry_json", 'ALTER TABLE "HealthChecks" ADD COLUMN telemetry_json VARCHAR'),
        ("notification_channels", "server_id", 'ALTER TABLE notification_channels ADD COLUMN server_id INTEGER'),
    )
    with engine.begin() as conn:
        inspector = inspect(conn)
        for table_name, column_name, statement in migrations:
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if column_name not in columns:
                conn.execute(text(statement))

    _ensure_notification_channel_cascade()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
