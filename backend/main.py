from fastapi import FastAPI, HTTPException, Depends, status, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import requests
from urllib.parse import urlparse
import bcrypt
import jwt
import random
import os
import socket
import ssl
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

load_dotenv()
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

from database import engine, Base, init_db, get_db, SessionLocal, User, OTPCode, Server, NotificationChannel, HealthCheck, MetricRaw, MetricHourly

AGENT_AUTH_TOKEN = os.getenv("AGENT_AUTH_TOKEN", "pulsewatch-agent-secret-token-2026")
ssl_alerts_dispatched: dict[int, set[int]] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WEBSOCKET] Client connected. Total active connections: {len(self.active_connections)}", flush=True)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WEBSOCKET] Client disconnected. Total active connections: {len(self.active_connections)}", flush=True)

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        disconnected = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)

ws_manager = ConnectionManager()

def extract_ssl_expiry(host: str, port: int = 443, timeout: float = 4.0) -> tuple[Optional[str], Optional[int], Optional[str]]:
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
                if not cert or "notAfter" not in cert:
                    return None, None, None
                not_after_str = cert["notAfter"]
                expiry_dt = datetime.strptime(not_after_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                days_left = (expiry_dt - now).days
                return expiry_dt.isoformat(), days_left, None
    except ssl.SSLCertVerificationError as e:
        return None, 0, str(e)
    except ssl.SSLError as e:
        return None, 0, str(e)
    except Exception as e:
        err_msg = str(e)
        if "ssl" in err_msg.lower() or "certificate" in err_msg.lower():
            return None, 0, err_msg
        return None, None, None


SECRET_KEY = "pulsewatch-multi-tenant-jwt-secret-key-32-chars-long"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = BackgroundScheduler()

@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)
    if not scheduler.running:
        scheduler.start()
        print(f"[SCHEDULER] APScheduler background monitoring worker started successfully at {datetime.now(timezone.utc).isoformat()}.", flush=True)

@app.on_event("shutdown")
def shutdown_event():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print(f"[SCHEDULER] APScheduler background worker stopped at {datetime.now(timezone.utc).isoformat()}.", flush=True)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        db = SessionLocal()
        try:
            servers = db.query(Server).all()
            server_payload = [
                {
                    "server_id": s.server_id,
                    "user_id": s.user_id,
                    "hostname": s.hostname,
                    "server_role": s.server_role,
                    "target_address": s.target_address,
                    "active_connections": s.active_connections,
                    "is_active": s.is_active,
                    "ssl_expiry_date": s.ssl_expiry_date,
                    "ssl_days_remaining": s.ssl_days_remaining
                }
                for s in servers
            ]
            await websocket.send_json({
                "type": "INITIAL_STATE",
                "servers": server_payload,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        finally:
            db.close()

        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


security = HTTPBearer()

class UserAuth(BaseModel):
    username: str
    password: str

class LoginVerify(BaseModel):
    username: str
    otp_code: str

class Toggle2FA(BaseModel):
    is_2fa_enabled: Optional[bool] = None

class RequestOTP(BaseModel):
    action: Optional[str] = "update_settings"

class UpdateEmail(BaseModel):
    email: str

class UpdateUsername(BaseModel):
    username: str
    otp_code: str

class UpdatePassword(BaseModel):
    current_password: str
    new_password: str
    otp_code: str

class ServerCreate(BaseModel):
    hostname: str
    server_role: str
    target_address: str

class ServerUpdate(BaseModel):
    is_active: int

class NotificationChannelCreate(BaseModel):
    channel_type: str
    destination_url: str
    is_active: Optional[int] = 1

class NotificationChannelUpdate(BaseModel):
    channel_type: Optional[str] = None
    destination_url: Optional[str] = None
    is_active: Optional[int] = None

def generate_otp_code() -> str:
    return f"{random.randint(100000, 999999)}"

def send_actual_otp_email(to_email: str, code: str):
    smtp_email = os.getenv("SMTP_EMAIL", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    
    if not smtp_email or not smtp_password:
        print(f"[MOCK EMAIL FALLBACK] Sent OTP {code} to {to_email} (Configure SMTP_EMAIL and SMTP_PASSWORD in .env)", flush=True)
        return
        
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "PulseWatch Security Verification Code"
        msg["From"] = smtp_email
        msg["To"] = to_email
        
        text_content = f"Your PulseWatch verification code is: {code}\n\nThis code will expire in 10 minutes."
        html_content = f"""
        <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 8px;">
            <h2 style="color: #3b82f6; margin-top: 0;">⚡ PulseWatch Security</h2>
            <p style="font-size: 14px; color: #94a3b8;">Your one-time security verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #60a5fa; padding: 12px 0; font-family: monospace;">{code}</div>
            <p style="font-size: 12px; color: #64748b;">This code will expire in 10 minutes. If you did not request this code, please secure your account immediately.</p>
        </div>
        """
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))
        
        try:
            context = ssl.create_default_context()
            server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=12)
            server.login(smtp_email, smtp_password)
            server.send_message(msg)
            server.quit()
            print(f"[SMTP EMAIL] Successfully delivered OTP {code} to {to_email} via Port 465 (SSL)", flush=True)
        except Exception:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=10)
            server.starttls()
            server.login(smtp_email, smtp_password)
            server.send_message(msg)
            server.quit()
            print(f"[SMTP EMAIL] Successfully delivered OTP {code} to {to_email} via Port 587 (TLS)", flush=True)
    except Exception as e:
        print(f"[SMTP ERROR] Failed to send email to {to_email}: {e}", flush=True)

def send_alert_email(to_email: str, alert_data: dict):
    smtp_email = os.getenv("SMTP_EMAIL", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    
    if not smtp_email or not smtp_password:
        print(f"[MOCK EMAIL FALLBACK] Alert to {to_email}: {alert_data.get('message')}", flush=True)
        return
        
    try:
        hostname = alert_data.get("hostname", "Unknown")
        status_str = alert_data.get("status", "UNKNOWN")
        alert_type = alert_data.get("alert_type", "STATE_TRANSITION")
        is_ssl = alert_type == "SSL_EXPIRATION_WARNING"
        is_down = status_str == "DOWN"
        
        if is_ssl:
            status_color = "#f59e0b"
            badge_text = "SSL CERTIFICATE EXPIRATION WARNING"
            subject_str = f"PulseWatch [SSL EXPIRING]: Server {hostname} certificate expires in {alert_data.get('ssl_days_remaining')} days"
            detail_html = f"""
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Hostname:</strong> {hostname}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Target Address:</strong> {alert_data.get('target_address', 'N/A')}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">SSL Expiry Date:</strong> <span style="color: #f59e0b; font-weight: bold;">{alert_data.get('ssl_expiry_date', 'N/A')}</span></div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Days Remaining:</strong> <span style="color: #f59e0b; font-weight: bold;">{alert_data.get('ssl_days_remaining', 'N/A')} day(s)</span></div>
                <div><strong style="color: #94a3b8;">Timestamp:</strong> {alert_data.get('timestamp', '')}</div>
            """
            title_html = f"SSL Certificate Expiring Soon for '{hostname}'"
            text_content = f"PulseWatch SSL Alert: Server '{hostname}' certificate expires in {alert_data.get('ssl_days_remaining')} day(s) on {alert_data.get('ssl_expiry_date')}.\nTarget: {alert_data.get('target_address', 'N/A')}\nTimestamp: {alert_data.get('timestamp', '')}\n"
        elif is_down:
            status_color = "#ef4444"
            badge_text = "CRITICAL ALERT"
            subject_str = f"PulseWatch [{status_str}]: Server {hostname} is {status_str}"
            detail_html = f"""
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Hostname:</strong> {hostname}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Role:</strong> {alert_data.get('server_role', 'Server')}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Target Address:</strong> {alert_data.get('target_address', 'N/A')}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Status:</strong> <span style="color: {status_color}; font-weight: bold;">{status_str}</span></div>
                <div><strong style="color: #94a3b8;">Timestamp:</strong> {alert_data.get('timestamp', '')}</div>
            """
            title_html = f"Server '{hostname}' is {status_str}"
            text_content = f"PulseWatch Alert: Server '{hostname}' transitioned to {status_str}.\nRole: {alert_data.get('server_role', 'Server')}\nTarget: {alert_data.get('target_address', 'N/A')}\nTimestamp: {alert_data.get('timestamp', '')}\n"
        else:
            status_color = "#22c55e"
            badge_text = "RECOVERY NOTIFICATION"
            subject_str = f"PulseWatch [{status_str}]: Server {hostname} is {status_str}"
            detail_html = f"""
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Hostname:</strong> {hostname}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Role:</strong> {alert_data.get('server_role', 'Server')}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Target Address:</strong> {alert_data.get('target_address', 'N/A')}</div>
                <div style="margin-bottom: 6px;"><strong style="color: #94a3b8;">Status:</strong> <span style="color: {status_color}; font-weight: bold;">{status_str}</span></div>
                <div><strong style="color: #94a3b8;">Timestamp:</strong> {alert_data.get('timestamp', '')}</div>
            """
            title_html = f"Server '{hostname}' is {status_str}"
            text_content = f"PulseWatch Alert: Server '{hostname}' transitioned to {status_str}.\nRole: {alert_data.get('server_role', 'Server')}\nTarget: {alert_data.get('target_address', 'N/A')}\nTimestamp: {alert_data.get('timestamp', '')}\n"
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject_str
        msg["From"] = smtp_email
        msg["To"] = to_email
        
        html_content = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 28px; border-radius: 12px; max-width: 600px;">
            <div style="font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; color: {status_color}; margin-bottom: 8px;">{badge_text}</div>
            <h2 style="color: #f8fafc; margin-top: 0; margin-bottom: 16px; font-size: 22px;">{title_html}</h2>
            <div style="background-color: #1e293b; padding: 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; line-height: 1.6;">
                {detail_html}
            </div>
            <p style="font-size: 12px; color: #64748b; margin: 0;">Automated alert from PulseWatch Monitoring System.</p>
        </div>
        """
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))
        
        try:
            context = ssl.create_default_context()
            server = smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=12)
            server.login(smtp_email, smtp_password)
            server.send_message(msg)
            server.quit()
            print(f"[ALERT EMAIL] Successfully sent alert to {to_email} via Port 465 (SSL)", flush=True)
        except Exception:
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=10)
            server.starttls()
            server.login(smtp_email, smtp_password)
            server.send_message(msg)
            server.quit()
            print(f"[ALERT EMAIL] Successfully sent alert to {to_email} via Port 587 (TLS)", flush=True)
    except Exception as e:
        print(f"[ALERT EMAIL ERROR] Failed to send alert email to {to_email}: {e}", flush=True)

async def dispatch_single_notification(client: httpx.AsyncClient, channel: dict, alert_data: dict):
    channel_type = (channel.get("channel_type") or "").strip().lower()
    destination = (channel.get("destination_url") or "").strip()
    
    if not destination:
        return

    hostname = alert_data.get("hostname", "Unknown")
    status_str = alert_data.get("status", "UNKNOWN")
    alert_type = alert_data.get("alert_type", "STATE_TRANSITION")
    is_ssl = alert_type == "SSL_EXPIRATION_WARNING"
    is_down = status_str == "DOWN"
    emoji = "⚠️" if is_ssl else ("🔴" if is_down else "🟢")

    try:
        if channel_type == "email":
            send_alert_email(destination, alert_data)
        elif channel_type == "discord":
            embed_color = 16107020 if is_ssl else (15158332 if is_down else 3066993)
            fields = [
                {"name": "Hostname", "value": hostname, "inline": True},
                {"name": "Status", "value": status_str, "inline": True},
                {"name": "Target", "value": alert_data.get("target_address", "N/A"), "inline": False}
            ]
            if is_ssl:
                fields.append({"name": "SSL Expiry", "value": alert_data.get("ssl_expiry_date", "N/A"), "inline": True})
                fields.append({"name": "Days Left", "value": str(alert_data.get("ssl_days_remaining", "N/A")), "inline": True})
            fields.append({"name": "Timestamp", "value": alert_data.get("timestamp", ""), "inline": False})
            
            payload = {
                "content": f"{emoji} **[PulseWatch Alert]** Server `{hostname}`: **{status_str}**!",
                "embeds": [
                    {
                        "title": f"SSL Warning: {alert_data.get('ssl_days_remaining')} Days Left" if is_ssl else f"Server Status: {status_str}",
                        "color": embed_color,
                        "fields": fields,
                        "footer": {"text": "PulseWatch Alerting Engine"}
                    }
                ]
            }
            res = await client.post(destination, json=payload, timeout=8.0)
            print(f"[DISPATCH DISCORD] Status {res.status_code} for {destination}", flush=True)
        elif channel_type == "slack":
            if is_ssl:
                msg_txt = f"⚠️ *[PulseWatch SSL Warning]* SSL Certificate for *{hostname}* ({alert_data.get('target_address')}) will expire in *{alert_data.get('ssl_days_remaining')} day(s)* on {alert_data.get('ssl_expiry_date')}."
            else:
                msg_txt = f"{emoji} *[PulseWatch Alert]* Server *{hostname}* is now *{status_str}*!\n*Target:* {alert_data.get('target_address')}\n*Time:* {alert_data.get('timestamp')}"
            payload = {"text": msg_txt}
            res = await client.post(destination, json=payload, timeout=8.0)
            print(f"[DISPATCH SLACK] Status {res.status_code} for {destination}", flush=True)
        elif channel_type == "telegram":
            payload = {
                "event": "ssl.expiration_warning" if is_ssl else "server.status_change",
                "hostname": hostname,
                "status": status_str,
                "target_address": alert_data.get("target_address"),
                "ssl_expiry_date": alert_data.get("ssl_expiry_date"),
                "ssl_days_remaining": alert_data.get("ssl_days_remaining"),
                "timestamp": alert_data.get("timestamp")
            }
            res = await client.post(destination, json=payload, timeout=8.0)
            print(f"[DISPATCH TELEGRAM] Status {res.status_code} for {destination}", flush=True)
        else:
            payload = {
                "event": "ssl.expiration_warning" if is_ssl else "server.status_change",
                "server_id": alert_data.get("server_id"),
                "hostname": hostname,
                "server_role": alert_data.get("server_role"),
                "target_address": alert_data.get("target_address"),
                "status": status_str,
                "previous_status": alert_data.get("previous_status"),
                "ssl_expiry_date": alert_data.get("ssl_expiry_date"),
                "ssl_days_remaining": alert_data.get("ssl_days_remaining"),
                "timestamp": alert_data.get("timestamp"),
                "message": alert_data.get("message", f"Server '{hostname}' alert")
            }
            res = await client.post(destination, json=payload, timeout=8.0)
            print(f"[DISPATCH WEBHOOK] Status {res.status_code} for {destination}", flush=True)
    except Exception as e:
        print(f"[DISPATCH ERROR] Failed to send alert to {channel_type} ({destination}): {e}", flush=True)

async def dispatch_state_transition_alerts(transitions: list[dict]):
    if not transitions:
        return
        
    db = SessionLocal()
    try:
        user_ids = {t["user_id"] for t in transitions if t.get("user_id") is not None}
        if not user_ids:
            channels = db.query(NotificationChannel).filter(NotificationChannel.is_active == 1).all()
        else:
            channels = db.query(NotificationChannel).filter(
                NotificationChannel.user_id.in_(user_ids),
                NotificationChannel.is_active == 1
            ).all()
        
        user_channels: dict[int, list[dict]] = {}
        for ch in channels:
            user_channels.setdefault(ch.user_id, []).append({
                "id": ch.id,
                "channel_type": ch.channel_type,
                "destination_url": ch.destination_url
            })
    finally:
        db.close()

    async with httpx.AsyncClient(verify=False) as client:
        tasks = []
        for t in transitions:
            u_id = t.get("user_id")
            dest_channels = user_channels.get(u_id, [])
            print(f"[ALERT DISPATCH] Preparing to dispatch {t['status']} alert for server '{t['hostname']}' to {len(dest_channels)} active notification channel(s)...", flush=True)
            for ch in dest_channels:
                tasks.append(dispatch_single_notification(client, ch, t))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            print(f"[ALERT DISPATCH] Completed dispatching {len(tasks)} notification task(s).", flush=True)

def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pwd_bytes = plain_password.encode("utf-8")[:72]
        return bcrypt.checkpw(pwd_bytes, hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: int, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "user_id": user_id,
        "sub": username,
        "exp": expire
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> int:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
                headers={"WWW-Authenticate": "Bearer"}
            )
        return user_id
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )

def init_db():
    Base.metadata.create_all(bind=engine)


@app.post("/register")
def register(auth: UserAuth, db: Session = Depends(get_db)):
    clean_username = auth.username.strip()
    if not clean_username or not auth.password:
        raise HTTPException(status_code=400, detail="Username and password cannot be empty")
    
    existing_user = db.query(User).filter(User.username == clean_username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    hashed = hash_password(auth.password)
    new_user = User(
        username=clean_username,
        password_hash=hashed,
        email=f"{clean_username}@pulsewatch.local",
        is_2fa_enabled=0
    )
    
    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username already exists")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
    token = create_access_token(new_user.id, new_user.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": new_user.id,
        "username": new_user.username
    }

@app.post("/login")
def login(auth: UserAuth, background_tasks: BackgroundTasks = None, db: Session = Depends(get_db)):
    clean_username = auth.username.strip()
    user = db.query(User).filter(User.username == clean_username).first()
    
    if not user or not verify_password(auth.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    if user.is_2fa_enabled:
        target_email = user.email.strip() if user.email and user.email.strip() else f"{clean_username}@pulsewatch.local"
        code = generate_otp_code()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        
        db.query(OTPCode).filter(OTPCode.user_id == user.id, OTPCode.action == "login").delete()
        otp = OTPCode(user_id=user.id, code=code, action="login", expires_at=expires_at)
        db.add(otp)
        db.commit()
        
        if background_tasks:
            background_tasks.add_task(send_actual_otp_email, target_email, code)
        else:
            send_actual_otp_email(target_email, code)
            
        return {
            "require_2fa": True,
            "username": clean_username,
            "email": target_email,
            "message": f"Two-factor authentication code sent to {target_email}"
        }
        
    token = create_access_token(user.id, clean_username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": clean_username,
        "require_2fa": False
    }

@app.post("/login/verify")
def login_verify(data: LoginVerify, db: Session = Depends(get_db)):
    clean_username = data.username.strip()
    clean_otp = data.otp_code.strip()
    
    if not clean_username or not clean_otp:
        raise HTTPException(status_code=400, detail="Username and verification code are required")
        
    user = db.query(User).filter(User.username == clean_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    now_iso = datetime.now(timezone.utc).isoformat()
    otp = db.query(OTPCode).filter(
        OTPCode.user_id == user.id,
        OTPCode.code == clean_otp,
        OTPCode.action == "login",
        OTPCode.expires_at > now_iso
    ).first()
    
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired 2FA code")
        
    db.delete(otp)
    db.commit()
    
    token = create_access_token(user.id, clean_username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": clean_username
    }

@app.get("/users/me")
def get_user_profile(current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email or "",
        "is_2fa_enabled": bool(user.is_2fa_enabled)
    }

@app.put("/users/email")
def update_email(data: UpdateEmail, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_email = data.email.strip()
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.email = clean_email
    db.commit()
    return {"message": "Email updated successfully", "email": clean_email}

@app.put("/users/2fa-toggle")
def toggle_2fa(data: Optional[Toggle2FA] = None, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data is not None and data.is_2fa_enabled is not None:
        new_val = 1 if data.is_2fa_enabled else 0
    else:
        new_val = 0 if user.is_2fa_enabled else 1
    user.is_2fa_enabled = new_val
    db.commit()
    return {
        "message": f"Two-Factor Authentication {'enabled' if new_val else 'disabled'} successfully",
        "is_2fa_enabled": bool(new_val)
    }

@app.post("/users/request-otp")
def request_otp(data: Optional[RequestOTP] = None, background_tasks: BackgroundTasks = None, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    action = (data.action if data and data.action else "update_settings").strip()
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    target_email = user.email.strip() if user.email and user.email.strip() else f"{user.username}@pulsewatch.local"
    code = generate_otp_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    
    db.query(OTPCode).filter(OTPCode.user_id == current_user_id, OTPCode.action == action).delete()
    otp = OTPCode(user_id=current_user_id, code=code, action=action, expires_at=expires_at)
    db.add(otp)
    db.commit()
    
    if background_tasks:
        background_tasks.add_task(send_actual_otp_email, target_email, code)
    else:
        send_actual_otp_email(target_email, code)
        
    return {
        "message": f"Verification code sent to {target_email}",
        "email": target_email,
        "expires_in_minutes": 10
    }

@app.put("/users/username")
def update_username(data: UpdateUsername, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_username = data.username.strip()
    clean_otp = (data.otp_code or "").strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if not clean_otp:
        raise HTTPException(status_code=400, detail="Verification code is required")
        
    now_iso = datetime.now(timezone.utc).isoformat()
    otp = db.query(OTPCode).filter(
        OTPCode.user_id == current_user_id,
        OTPCode.code == clean_otp,
        OTPCode.action == "update_settings",
        OTPCode.expires_at > now_iso
    ).first()
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
        
    existing = db.query(User).filter(User.username == clean_username, User.id != current_user_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
        
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    db.delete(otp)
    user.username = clean_username
    db.commit()
    
    new_token = create_access_token(current_user_id, clean_username)
    return {
        "message": "Username updated successfully",
        "username": clean_username,
        "access_token": new_token
    }

@app.put("/users/password")
def update_password(data: UpdatePassword, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_otp = (data.otp_code or "").strip()
    if not data.current_password or not data.new_password:
        raise HTTPException(status_code=400, detail="Current and new password are required")
    if not clean_otp:
        raise HTTPException(status_code=400, detail="Verification code is required")
        
    now_iso = datetime.now(timezone.utc).isoformat()
    otp = db.query(OTPCode).filter(
        OTPCode.user_id == current_user_id,
        OTPCode.code == clean_otp,
        OTPCode.action == "update_settings",
        OTPCode.expires_at > now_iso
    ).first()
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
        
    user = db.query(User).filter(User.id == current_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password")
        
    user.password_hash = hash_password(data.new_password)
    db.delete(otp)
    db.commit()
    
    return {"message": "Password updated successfully"}

@app.get("/install.sh")
def get_install_script():
    return FileResponse("install.sh", media_type="text/x-shellscript")

@app.get("/agent/metric_agent.py")
def get_metric_agent():
    return FileResponse("metric_agent.py", media_type="text/x-python")

@app.get("/servers")
def get_servers(current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    servers = db.query(Server).filter(Server.user_id == current_user_id).all()
    return [
        {
            "server_id": s.server_id,
            "user_id": s.user_id,
            "hostname": s.hostname,
            "server_role": s.server_role,
            "target_address": s.target_address,
            "active_connections": s.active_connections,
            "is_active": s.is_active,
            "ssl_expiry_date": s.ssl_expiry_date,
            "ssl_days_remaining": s.ssl_days_remaining
        }
        for s in servers
    ]

@app.post("/servers")
def add_server(server: ServerCreate, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    new_server = Server(
        user_id=current_user_id,
        hostname=server.hostname.strip(),
        server_role=server.server_role.strip(),
        target_address=server.target_address.strip(),
        active_connections=0,
        is_active=1
    )
    db.add(new_server)
    db.commit()
    db.refresh(new_server)
    return {
        "server_id": new_server.server_id,
        "user_id": new_server.user_id,
        "hostname": new_server.hostname,
        "server_role": new_server.server_role,
        "target_address": new_server.target_address,
        "active_connections": new_server.active_connections,
        "is_active": new_server.is_active,
        "ssl_expiry_date": new_server.ssl_expiry_date,
        "ssl_days_remaining": new_server.ssl_days_remaining,
        "message": "Server added"
    }

@app.put("/servers/{server_id}")
def update_server(server_id: int, server: ServerUpdate, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    server_obj = db.query(Server).filter(Server.server_id == server_id, Server.user_id == current_user_id).first()
    if not server_obj:
        raise HTTPException(status_code=404, detail="Server not found")
        
    server_obj.is_active = server.is_active
    timestamp = datetime.now(timezone.utc).isoformat()
    
    hc = HealthCheck(server_id=server_id, status=server.is_active, timestamp=timestamp, cpu_usage=None, ram_usage=None)
    mr = MetricRaw(server_id=server_id, status=server.is_active, timestamp=timestamp, cpu_usage=None, ram_usage=None)
    db.add(hc)
    db.add(mr)
    db.commit()
    return {"message": "Server updated"}

@app.delete("/servers/{server_id}")
def delete_server(server_id: int, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    server_obj = db.query(Server).filter(Server.server_id == server_id, Server.user_id == current_user_id).first()
    if not server_obj:
        raise HTTPException(status_code=404, detail="Server not found")
        
    db.query(HealthCheck).filter(HealthCheck.server_id == server_id).delete()
    db.query(MetricRaw).filter(MetricRaw.server_id == server_id).delete()
    db.query(MetricHourly).filter(MetricHourly.server_id == server_id).delete()
    db.delete(server_obj)
    db.commit()
    return {"message": "Server deleted"}

@app.get("/servers/{server_id}/history")
def get_server_history(server_id: int, hours: int = 1, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    server_obj = db.query(Server).filter(Server.server_id == server_id, Server.user_id == current_user_id).first()
    if not server_obj:
        raise HTTPException(status_code=404, detail="Server not found")
        
    cutoff_time = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    checks = db.query(HealthCheck).filter(
        HealthCheck.server_id == server_id,
        HealthCheck.timestamp >= cutoff_time
    ).order_by(HealthCheck.timestamp.desc()).all()
    
    return [
        {
            "status": c.status,
            "timestamp": c.timestamp,
            "cpu_usage": c.cpu_usage,
            "ram_usage": c.ram_usage
        }
        for c in checks
    ]

@app.get("/servers/{server_id}/logs")
def get_server_logs(server_id: int, status: int, limit: int = 50, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    server_obj = db.query(Server).filter(Server.server_id == server_id, Server.user_id == current_user_id).first()
    if not server_obj:
        raise HTTPException(status_code=404, detail="Server not found")
        
    checks = db.query(HealthCheck).filter(
        HealthCheck.server_id == server_id,
        HealthCheck.status == status
    ).order_by(HealthCheck.timestamp.desc()).limit(limit).all()
    
    return [
        {
            "status": c.status,
            "timestamp": c.timestamp
        }
        for c in checks
    ]

@app.get("/servers/{server_id}/uptime")
def get_uptime_matrix(server_id: int, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    server_obj = db.query(Server).filter(Server.server_id == server_id, Server.user_id == current_user_id).first()
    if not server_obj:
        raise HTTPException(status_code=404, detail="Server not found")
        
    now = datetime.now(timezone.utc)
    timeframes = {
        "24h": (now - timedelta(days=1)).isoformat(),
        "7d": (now - timedelta(days=7)).isoformat(),
        "14d": (now - timedelta(days=14)).isoformat(),
        "30d": (now - timedelta(days=30)).isoformat()
    }
    
    matrix = {}
    for label, cutoff_time in timeframes.items():
        total_checks = db.query(HealthCheck).filter(
            HealthCheck.server_id == server_id,
            HealthCheck.timestamp >= cutoff_time
        ).count()
        
        if total_checks == 0:
            matrix[label] = "100.00"
        else:
            online_checks = db.query(HealthCheck).filter(
                HealthCheck.server_id == server_id,
                HealthCheck.timestamp >= cutoff_time,
                HealthCheck.status == 1
            ).count()
            percentage = (online_checks / total_checks) * 100
            matrix[label] = f"{percentage:.2f}"
            
    return matrix

@app.get("/system/retention-stats")
def get_retention_stats(current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    user_servers = db.query(Server.server_id).filter(Server.user_id == current_user_id).all()
    server_ids = [s[0] for s in user_servers]
    
    if not server_ids:
        return {
            "raw_count": 0,
            "hourly_count": 0,
            "oldest_raw": "None",
            "oldest_hourly": "None",
            "policy_raw": "30 Days (High-Resolution)",
            "policy_hourly": "15 Months (Hourly Aggregates)",
            "next_schedule": "Daily at 02:00 UTC"
        }
        
    raw_count = db.query(MetricRaw).filter(MetricRaw.server_id.in_(server_ids)).count()
    hourly_count = db.query(MetricHourly).filter(MetricHourly.server_id.in_(server_ids)).count()
    
    oldest_raw_row = db.query(MetricRaw.timestamp).filter(MetricRaw.server_id.in_(server_ids)).order_by(MetricRaw.timestamp.asc()).first()
    oldest_hourly_row = db.query(MetricHourly.timestamp).filter(MetricHourly.server_id.in_(server_ids)).order_by(MetricHourly.timestamp.asc()).first()
    
    return {
        "raw_count": raw_count,
        "hourly_count": hourly_count,
        "oldest_raw": oldest_raw_row[0] if oldest_raw_row else "None",
        "oldest_hourly": oldest_hourly_row[0] if oldest_hourly_row else "None",
        "policy_raw": "30 Days (High-Resolution)",
        "policy_hourly": "15 Months (Hourly Aggregates)",
        "next_schedule": "Daily at 02:00 UTC"
    }

@app.post("/system/trigger-rollup")
def trigger_rollup(current_user_id: int = Depends(get_current_user)):
    process_historical_data()
    return {"message": "Historical rollup and purge executed successfully"}

@app.get("/notification-channels")
def get_notification_channels(current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    channels = db.query(NotificationChannel).filter(NotificationChannel.user_id == current_user_id).all()
    return [
        {
            "id": c.id,
            "user_id": c.user_id,
            "channel_type": c.channel_type,
            "destination_url": c.destination_url,
            "is_active": c.is_active
        }
        for c in channels
    ]

@app.post("/notification-channels")
def create_notification_channel(data: NotificationChannelCreate, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_type = data.channel_type.strip().lower()
    clean_url = data.destination_url.strip()
    if not clean_type or not clean_url:
        raise HTTPException(status_code=400, detail="Channel type and destination are required")
        
    valid_types = ["email", "webhook", "discord", "slack", "telegram"]
    if clean_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid channel type. Must be one of: {', '.join(valid_types)}")
        
    channel = NotificationChannel(
        user_id=current_user_id,
        channel_type=clean_type,
        destination_url=clean_url,
        is_active=1 if data.is_active is None or data.is_active == 1 else 0
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return {
        "id": channel.id,
        "user_id": channel.user_id,
        "channel_type": channel.channel_type,
        "destination_url": channel.destination_url,
        "is_active": channel.is_active,
        "message": "Notification channel created successfully"
    }

@app.put("/notification-channels/{channel_id}")
def update_notification_channel(channel_id: int, data: NotificationChannelUpdate, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(NotificationChannel).filter(
        NotificationChannel.id == channel_id,
        NotificationChannel.user_id == current_user_id
    ).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Notification channel not found")
        
    if data.channel_type is not None:
        clean_type = data.channel_type.strip().lower()
        valid_types = ["email", "webhook", "discord", "slack", "telegram"]
        if clean_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid channel type. Must be one of: {', '.join(valid_types)}")
        channel.channel_type = clean_type
        
    if data.destination_url is not None:
        clean_url = data.destination_url.strip()
        if not clean_url:
            raise HTTPException(status_code=400, detail="Destination cannot be empty")
        channel.destination_url = clean_url
        
    if data.is_active is not None:
        channel.is_active = 1 if data.is_active else 0
        
    db.commit()
    db.refresh(channel)
    return {
        "id": channel.id,
        "user_id": channel.user_id,
        "channel_type": channel.channel_type,
        "destination_url": channel.destination_url,
        "is_active": channel.is_active,
        "message": "Notification channel updated successfully"
    }

@app.delete("/notification-channels/{channel_id}")
def delete_notification_channel(channel_id: int, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(NotificationChannel).filter(
        NotificationChannel.id == channel_id,
        NotificationChannel.user_id == current_user_id
    ).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Notification channel not found")
        
    db.delete(channel)
    db.commit()
    return {"message": "Notification channel deleted successfully"}

@app.post("/notification-channels/{channel_id}/test")
async def test_notification_channel(channel_id: int, current_user_id: int = Depends(get_current_user), db: Session = Depends(get_db)):
    channel = db.query(NotificationChannel).filter(
        NotificationChannel.id == channel_id,
        NotificationChannel.user_id == current_user_id
    ).first()
    if not channel:
        raise HTTPException(status_code=404, detail="Notification channel not found")
        
    test_alert = {
        "server_id": 0,
        "user_id": current_user_id,
        "hostname": "test-node-pulsewatch",
        "server_role": "Diagnostic Probe",
        "target_address": "http://127.0.0.1:8000",
        "status": "UP",
        "previous_status": "DOWN",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": "PulseWatch notification channel verification test"
    }
    
    async with httpx.AsyncClient(verify=False) as client:
        await dispatch_single_notification(client, {
            "id": channel.id,
            "channel_type": channel.channel_type,
            "destination_url": channel.destination_url
        }, test_alert)
        
    return {"message": f"Test alert dispatched to {channel.channel_type} channel ({channel.destination_url})"}

consecutive_failures: dict[int, int] = {}
CONSECUTIVE_FAILURES_THRESHOLD = 3

async def check_single_server(client: httpx.AsyncClient, server_id: int, target_address: str, hostname: str, current_active: int):
    target = (target_address or "").strip()
    status = 0
    cpu_usage = None
    ram_usage = None
    ssl_expiry_date = None
    ssl_days_remaining = None
    ssl_error = None
    
    print(f"[PROBE] Checking server #{server_id} ('{hostname}') -> target: {target}", flush=True)

    try:
        if target.startswith("http://") or target.startswith("https://"):
            parsed = urlparse(target)
            host = parsed.hostname or "127.0.0.1"

            if target.startswith("https://"):
                try:
                    ssl_port = parsed.port or 443
                    ssl_date, days_left, ssl_err = await asyncio.to_thread(extract_ssl_expiry, host, ssl_port)
                    ssl_expiry_date = ssl_date
                    ssl_days_remaining = days_left
                    if ssl_err:
                        ssl_error = ssl_err
                        ssl_days_remaining = 0
                        print(f"[SSL ERROR] Server #{server_id} ('{hostname}') TLS handshake failed: {ssl_err}", flush=True)
                    elif ssl_days_remaining is not None:
                        print(f"[SSL INSPECTION] Server #{server_id} ('{hostname}') TLS certificate valid until {ssl_expiry_date} ({ssl_days_remaining} day(s) remaining)", flush=True)
                except Exception as e:
                    ssl_error = str(e)
                    ssl_days_remaining = 0
                    print(f"[SSL ERROR] Server #{server_id} ('{hostname}') TLS check exception: {e}", flush=True)

            try:
                response = await client.get(target, timeout=5.0)
                if response.status_code < 400 and not ssl_error:
                    status = 1
                else:
                    status = 0
            except (httpx.ConnectError, ssl.SSLError) as e:
                status = 0
                if not ssl_error and target.startswith("https://"):
                    ssl_error = str(e)
                    ssl_days_remaining = 0
                    print(f"[SSL ERROR] Server #{server_id} ('{hostname}') HTTPS request failed: {e}", flush=True)
            except Exception:
                status = 0
        else:
            status = 1
            host = target.split(":")[0] if ":" in target else target

        metric_url = f"http://{host}:8001/metrics"
        try:
            agent_headers = {"Authorization": f"Bearer {AGENT_AUTH_TOKEN}"}
            metric_response = await client.get(metric_url, headers=agent_headers, timeout=3.0)
            if metric_response.status_code == 200:
                metrics_data = metric_response.json()
                cpu_usage = metrics_data.get("cpu_usage")
                ram_usage = metrics_data.get("ram_usage")
        except Exception:
            pass
    except Exception:
        status = 0

    if status == 1 and not ssl_error:
        prev_strikes = consecutive_failures.get(server_id, 0)
        consecutive_failures[server_id] = 0
        effective_active = 1
        if prev_strikes > 0:
            print(f"[PROBE RECOVERED] Server #{server_id} ('{hostname}') check succeeded. Failure strike counter reset from {prev_strikes} to 0.", flush=True)
        else:
            print(f"[PROBE OK] Server #{server_id} ('{hostname}') check succeeded (status=1). CPU: {cpu_usage}%, RAM: {ram_usage}%", flush=True)
    else:
        new_strikes = consecutive_failures.get(server_id, 0) + 1
        consecutive_failures[server_id] = new_strikes
        if new_strikes >= CONSECUTIVE_FAILURES_THRESHOLD:
            effective_active = 0
            print(f"[PROBE FAILED] Server #{server_id} ('{hostname}') check failed! Strike {new_strikes}/{CONSECUTIVE_FAILURES_THRESHOLD} -> marking DOWN (is_active=0).", flush=True)
        else:
            effective_active = current_active
            print(f"[PROBE FAILED] Server #{server_id} ('{hostname}') check failed! Strike {new_strikes}/{CONSECUTIVE_FAILURES_THRESHOLD} (debouncing flap, effective status={effective_active}).", flush=True)

    return {
        "server_id": server_id,
        "raw_status": status,
        "effective_active": effective_active,
        "cpu_usage": cpu_usage,
        "ram_usage": ram_usage,
        "ssl_expiry_date": ssl_expiry_date,
        "ssl_days_remaining": ssl_days_remaining,
        "ssl_error": ssl_error
    }

async def async_monitoring_job():
    db = SessionLocal()
    try:
        servers = db.query(Server).all()
        server_list = [
            {
                "server_id": s.server_id,
                "user_id": s.user_id,
                "hostname": s.hostname,
                "server_role": s.server_role,
                "target_address": s.target_address,
                "previous_active": s.is_active if s.is_active is not None else 1
            }
            for s in servers
        ]
    finally:
        db.close()

    if not server_list:
        print(f"[MONITORING] No servers found in database. Polling cycle skipped at {datetime.now(timezone.utc).isoformat()}.", flush=True)
        return

    print(f"[MONITORING] Starting concurrent polling cycle for {len(server_list)} server(s)...", flush=True)

    limits = httpx.Limits(max_keepalive_connections=50, max_connections=100)
    async with httpx.AsyncClient(limits=limits, verify=True) as client:
        tasks = [
            check_single_server(
                client=client,
                server_id=s["server_id"],
                target_address=s["target_address"],
                hostname=s["hostname"],
                current_active=s["previous_active"]
            )
            for s in server_list
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    timestamp = datetime.now(timezone.utc).isoformat()
    transitions = []
    ssl_warnings = []
    
    db = SessionLocal()
    try:
        for idx, res in enumerate(results):
            if isinstance(res, Exception) or not isinstance(res, dict):
                continue
            server_id = res["server_id"]
            effective_active = res["effective_active"]
            cpu = res["cpu_usage"]
            ram = res["ram_usage"]
            ssl_expiry_date = res.get("ssl_expiry_date")
            ssl_days_remaining = res.get("ssl_days_remaining")
            
            s_info = server_list[idx]
            prev_active = s_info["previous_active"]

            if prev_active == 1 and effective_active == 0:
                print(f"[STATE TRANSITION] Outage detected: Server #{server_id} ('{s_info.get('hostname')}') transitioned from UP -> DOWN!", flush=True)
                transitions.append({
                    "server_id": server_id,
                    "user_id": s_info.get("user_id"),
                    "hostname": s_info.get("hostname", f"Server-{server_id}"),
                    "server_role": s_info.get("server_role", "Server"),
                    "target_address": s_info.get("target_address", ""),
                    "status": "DOWN",
                    "previous_status": "UP",
                    "timestamp": timestamp,
                    "message": f"Server '{s_info.get('hostname')}' transitioned to DOWN"
                })
            elif prev_active == 0 and effective_active == 1:
                print(f"[STATE TRANSITION] Recovery detected: Server #{server_id} ('{s_info.get('hostname')}') transitioned from DOWN -> UP!", flush=True)
                transitions.append({
                    "server_id": server_id,
                    "user_id": s_info.get("user_id"),
                    "hostname": s_info.get("hostname", f"Server-{server_id}"),
                    "server_role": s_info.get("server_role", "Server"),
                    "target_address": s_info.get("target_address", ""),
                    "status": "UP",
                    "previous_status": "DOWN",
                    "timestamp": timestamp,
                    "message": f"Server '{s_info.get('hostname')}' recovered to UP"
                })

            if ssl_days_remaining is not None:
                dispatched_set = ssl_alerts_dispatched.setdefault(server_id, set())
                if ssl_days_remaining > 30:
                    dispatched_set.clear()
                else:
                    for threshold in (30, 14, 7):
                        if ssl_days_remaining <= threshold and threshold not in dispatched_set:
                            dispatched_set.add(threshold)
                            print(f"[SSL WARNING] Server #{server_id} ('{s_info.get('hostname')}') certificate expires in {ssl_days_remaining} days (<= {threshold}d threshold)!", flush=True)
                            ssl_warnings.append({
                                "server_id": server_id,
                                "user_id": s_info.get("user_id"),
                                "hostname": s_info.get("hostname", f"Server-{server_id}"),
                                "server_role": s_info.get("server_role", "Server"),
                                "target_address": s_info.get("target_address", ""),
                                "alert_type": "SSL_EXPIRATION_WARNING",
                                "status": f"SSL EXPIRING IN {ssl_days_remaining} DAYS",
                                "ssl_expiry_date": ssl_expiry_date,
                                "ssl_days_remaining": ssl_days_remaining,
                                "threshold_days": threshold,
                                "timestamp": timestamp,
                                "message": f"SSL certificate for '{s_info.get('hostname')}' expires in {ssl_days_remaining} day(s) on {ssl_expiry_date}."
                            })

            server_obj = db.query(Server).filter(Server.server_id == server_id).first()
            if server_obj:
                server_obj.is_active = effective_active
                if ssl_expiry_date is not None:
                    server_obj.ssl_expiry_date = ssl_expiry_date
                    server_obj.ssl_days_remaining = ssl_days_remaining

            hc = HealthCheck(
                server_id=server_id,
                status=effective_active,
                timestamp=timestamp,
                cpu_usage=cpu,
                ram_usage=ram
            )
            db.add(hc)

            mr = MetricRaw(
                server_id=server_id,
                status=effective_active,
                timestamp=timestamp,
                cpu_usage=cpu,
                ram_usage=ram
            )
            db.add(mr)

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[MONITORING ERROR] Failed to save batch metrics: {e}", flush=True)
    finally:
        db.close()

    if transitions:
        asyncio.create_task(dispatch_state_transition_alerts(transitions))

    if ssl_warnings:
        asyncio.create_task(dispatch_state_transition_alerts(ssl_warnings))

    try:
        db = SessionLocal()
        try:
            all_servers = db.query(Server).all()
            broadcast_servers = [
                {
                    "server_id": s.server_id,
                    "user_id": s.user_id,
                    "hostname": s.hostname,
                    "server_role": s.server_role,
                    "target_address": s.target_address,
                    "active_connections": s.active_connections,
                    "is_active": s.is_active,
                    "ssl_expiry_date": s.ssl_expiry_date,
                    "ssl_days_remaining": s.ssl_days_remaining
                }
                for s in all_servers
            ]
        finally:
            db.close()

        metrics_map = {
            r["server_id"]: {
                "cpu_usage": r.get("cpu_usage"),
                "ram_usage": r.get("ram_usage"),
                "status": r.get("effective_active"),
                "ssl_days_remaining": r.get("ssl_days_remaining"),
                "ssl_expiry_date": r.get("ssl_expiry_date")
            }
            for r in results if isinstance(r, dict)
        }

        await ws_manager.broadcast({
            "type": "SERVERS_UPDATE",
            "servers": broadcast_servers,
            "metrics": metrics_map,
            "timestamp": timestamp
        })
    except Exception as e:
        print(f"[WEBSOCKET BROADCAST ERROR] {e}", flush=True)

    print(f"[MONITORING] Finished cycle for {len(server_list)} server(s) at {timestamp}.", flush=True)

def monitoring_job():
    try:
        asyncio.run(async_monitoring_job())
    except Exception as e:
        print(f"[MONITORING LOOP ERROR] {e}", flush=True)

def process_historical_data():
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cutoff_15m = (datetime.now(timezone.utc) - timedelta(days=456)).isoformat()
    
    db = SessionLocal()
    try:
        is_postgres = "postgresql" in str(engine.url)
        if is_postgres:
            db.execute(
                text("""
                INSERT INTO metrics_hourly (server_id, timestamp, avg_cpu, avg_ram)
                SELECT server_id, to_char(to_timestamp(timestamp, 'YYYY-MM-DD"T"HH24:MI:SS'), 'YYYY-MM-DD HH24:00:00'), AVG(cpu_usage), AVG(ram_usage)
                FROM metrics_raw
                WHERE timestamp < :cutoff_30d
                GROUP BY server_id, to_char(to_timestamp(timestamp, 'YYYY-MM-DD"T"HH24:MI:SS'), 'YYYY-MM-DD HH24:00:00')
                """),
                {"cutoff_30d": cutoff_30d}
            )
        else:
            db.execute(
                text("""
                INSERT INTO metrics_hourly (server_id, timestamp, avg_cpu, avg_ram)
                SELECT server_id, strftime('%Y-%m-%d %H:00:00', timestamp), AVG(cpu_usage), AVG(ram_usage)
                FROM metrics_raw
                WHERE timestamp < :cutoff_30d
                GROUP BY server_id, strftime('%Y-%m-%d %H:00:00', timestamp)
                """),
                {"cutoff_30d": cutoff_30d}
            )
        db.query(MetricRaw).filter(MetricRaw.timestamp < cutoff_30d).delete(synchronize_session=False)
        db.query(HealthCheck).filter(HealthCheck.timestamp < cutoff_30d).delete(synchronize_session=False)
        db.query(MetricHourly).filter(MetricHourly.timestamp < cutoff_15m).delete(synchronize_session=False)
        db.commit()
        print(f"Historical data processed: rollup and purge completed at {datetime.now(timezone.utc).isoformat()}", flush=True)
    except Exception as e:
        db.rollback()
        print(f"[ROLLUP ERROR] Failed to process historical data: {e}", flush=True)
    finally:
        db.close()

scheduler.add_job(
    monitoring_job, 
    'interval', 
    seconds=30, 
    misfire_grace_time=15,
    max_instances=5,
    next_run_time=datetime.now(timezone.utc)
)
scheduler.add_job(
    process_historical_data,
    'cron',
    hour=2,
    minute=0
)
if not scheduler.running:
    scheduler.start()
    print(f"[SCHEDULER] APScheduler background monitoring worker started at module initialization ({datetime.now(timezone.utc).isoformat()}).", flush=True)