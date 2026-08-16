from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from sqlalchemy import create_engine, Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is missing from environment variables!")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    email = Column(String, nullable=True)
    is_2fa_enabled = Column(Integer, default=0)

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
    active_connections = Column(Integer, default=0)
    is_active = Column(Integer, default=1)

class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
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

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
