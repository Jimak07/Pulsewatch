from fastapi import FastAPI, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import sqlite3
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import requests
from urllib.parse import urlparse
import bcrypt
import jwt
import random
import os
import ssl
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))

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

def get_db_connection():
    connection = sqlite3.connect("database.db", timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    return connection

def init_db():
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            is_2fa_enabled INTEGER DEFAULT 0
        )
        """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS otp_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            action TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS Server (
            server_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            hostname TEXT NOT NULL,
            server_role TEXT NOT NULL,
            target_address TEXT NOT NULL,
            active_connections INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
        """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS HealthChecks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER,
            status INTEGER,
            timestamp TEXT,
            cpu_usage REAL,
            ram_usage REAL
        )
        """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS metrics_raw (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER,
            status INTEGER,
            timestamp TEXT,
            cpu_usage REAL,
            ram_usage REAL
        )
        """
    )
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS metrics_hourly (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER,
            timestamp TEXT,
            avg_cpu REAL,
            avg_ram REAL
        )
        """
    )
    
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [row[1] for row in cursor.fetchall()]
    if "email" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN email TEXT")
    if "is_2fa_enabled" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN is_2fa_enabled INTEGER DEFAULT 0")
        
    cursor.execute("PRAGMA table_info(Server)")
    server_columns = [row[1] for row in cursor.fetchall()]
    if "user_id" not in server_columns:
        cursor.execute("ALTER TABLE Server ADD COLUMN user_id INTEGER DEFAULT 1")
        
    cursor.execute("PRAGMA table_info(HealthChecks)")
    columns = [row[1] for row in cursor.fetchall()]
    if "cpu_usage" not in columns:
        cursor.execute("ALTER TABLE HealthChecks ADD COLUMN cpu_usage REAL")
    if "ram_usage" not in columns:
        cursor.execute("ALTER TABLE HealthChecks ADD COLUMN ram_usage REAL")
    
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        default_pwd = hash_password("admin123")
        cursor.execute("INSERT INTO users (id, username, password_hash, email) VALUES (1, 'admin', ?, 'admin@pulsewatch.local')", (default_pwd,))
    
    cursor.execute("UPDATE Server SET user_id = 1 WHERE user_id IS NULL")
    cursor.execute("INSERT OR IGNORE INTO metrics_raw SELECT * FROM HealthChecks")
    
    connection.commit()
    connection.close()

init_db()

@app.post("/register")
def register(auth: UserAuth):
    clean_username = auth.username.strip()
    if not clean_username or not auth.password:
        raise HTTPException(status_code=400, detail="Username and password cannot be empty")
    
    hashed = hash_password(auth.password)
    connection = get_db_connection()
    cursor = connection.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", (clean_username, hashed, f"{clean_username}@pulsewatch.local"))
        user_id = cursor.lastrowid
        connection.commit()
    except sqlite3.IntegrityError:
        connection.close()
        raise HTTPException(status_code=400, detail="Username already exists")
        
    connection.close()
    token = create_access_token(user_id, clean_username)
    return {"access_token": token, "token_type": "bearer", "user_id": user_id, "username": clean_username}

@app.post("/login")
def login(auth: UserAuth, background_tasks: BackgroundTasks = None):
    clean_username = auth.username.strip()
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT id, password_hash, email, is_2fa_enabled FROM users WHERE username = ?", (clean_username,))
    row = cursor.fetchone()
    
    if not row or not verify_password(auth.password, row[1]):
        connection.close()
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    user_id, email, is_2fa = row[0], row[2], bool(row[3])
    
    if is_2fa:
        target_email = email.strip() if email and email.strip() else f"{clean_username}@pulsewatch.local"
        code = generate_otp_code()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        
        cursor.execute("DELETE FROM otp_codes WHERE user_id = ? AND action = 'login'", (user_id,))
        cursor.execute(
            "INSERT INTO otp_codes (user_id, code, action, expires_at) VALUES (?, ?, 'login', ?)",
            (user_id, code, expires_at)
        )
        connection.commit()
        connection.close()
        
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
        
    connection.close()
    token = create_access_token(user_id, clean_username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user_id,
        "username": clean_username,
        "require_2fa": False
    }

@app.post("/login/verify")
def login_verify(data: LoginVerify):
    clean_username = data.username.strip()
    clean_otp = data.otp_code.strip()
    
    if not clean_username or not clean_otp:
        raise HTTPException(status_code=400, detail="Username and verification code are required")
        
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (clean_username,))
    user_row = cursor.fetchone()
    if not user_row:
        connection.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    user_id = user_row[0]
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        "SELECT id FROM otp_codes WHERE user_id = ? AND code = ? AND action = 'login' AND expires_at > ?",
        (user_id, clean_otp, now_iso)
    )
    otp_row = cursor.fetchone()
    if not otp_row:
        connection.close()
        raise HTTPException(status_code=400, detail="Invalid or expired 2FA code")
        
    cursor.execute("DELETE FROM otp_codes WHERE id = ?", (otp_row[0],))
    connection.commit()
    connection.close()
    
    token = create_access_token(user_id, clean_username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user_id,
        "username": clean_username
    }

@app.get("/users/me")
def get_user_profile(current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT id, username, email, is_2fa_enabled FROM users WHERE id = ?", (current_user_id,))
    row = cursor.fetchone()
    connection.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": row[0],
        "username": row[1],
        "email": row[2] or "",
        "is_2fa_enabled": bool(row[3])
    }

@app.put("/users/email")
def update_email(data: UpdateEmail, current_user_id: int = Depends(get_current_user)):
    clean_email = data.email.strip()
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("UPDATE users SET email = ? WHERE id = ?", (clean_email, current_user_id))
    connection.commit()
    connection.close()
    return {"message": "Email updated successfully", "email": clean_email}

@app.put("/users/2fa-toggle")
def toggle_2fa(data: Optional[Toggle2FA] = None, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    if data is not None and data.is_2fa_enabled is not None:
        new_val = 1 if data.is_2fa_enabled else 0
    else:
        cursor.execute("SELECT is_2fa_enabled FROM users WHERE id = ?", (current_user_id,))
        row = cursor.fetchone()
        current_status = row[0] if row and row[0] else 0
        new_val = 0 if current_status else 1
        
    cursor.execute("UPDATE users SET is_2fa_enabled = ? WHERE id = ?", (new_val, current_user_id))
    connection.commit()
    connection.close()
    
    return {
        "message": f"Two-Factor Authentication {'enabled' if new_val else 'disabled'} successfully",
        "is_2fa_enabled": bool(new_val)
    }

@app.post("/users/request-otp")
def request_otp(data: Optional[RequestOTP] = None, background_tasks: BackgroundTasks = None, current_user_id: int = Depends(get_current_user)):
    action = (data.action if data and data.action else "update_settings").strip()
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT username, email FROM users WHERE id = ?", (current_user_id,))
    row = cursor.fetchone()
    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    username, email = row[0], row[1]
    target_email = email.strip() if email and email.strip() else f"{username}@pulsewatch.local"
    
    code = generate_otp_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    
    cursor.execute("DELETE FROM otp_codes WHERE user_id = ? AND action = ?", (current_user_id, action))
    cursor.execute(
        "INSERT INTO otp_codes (user_id, code, action, expires_at) VALUES (?, ?, ?, ?)",
        (current_user_id, code, action, expires_at)
    )
    connection.commit()
    connection.close()
    
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
def update_username(data: UpdateUsername, current_user_id: int = Depends(get_current_user)):
    clean_username = data.username.strip()
    clean_otp = (data.otp_code or "").strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if not clean_otp:
        raise HTTPException(status_code=400, detail="Verification code is required")
        
    connection = get_db_connection()
    cursor = connection.cursor()
    
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        "SELECT id FROM otp_codes WHERE user_id = ? AND code = ? AND action = 'update_settings' AND expires_at > ?",
        (current_user_id, clean_otp, now_iso)
    )
    otp_row = cursor.fetchone()
    if not otp_row:
        connection.close()
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
        
    cursor.execute("SELECT id FROM users WHERE username = ? AND id != ?", (clean_username, current_user_id))
    if cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=400, detail="Username already taken")
        
    cursor.execute("DELETE FROM otp_codes WHERE id = ?", (otp_row[0],))
    cursor.execute("UPDATE users SET username = ? WHERE id = ?", (clean_username, current_user_id))
    connection.commit()
    connection.close()
    
    new_token = create_access_token(current_user_id, clean_username)
    return {
        "message": "Username updated successfully",
        "username": clean_username,
        "access_token": new_token
    }

@app.put("/users/password")
def update_password(data: UpdatePassword, current_user_id: int = Depends(get_current_user)):
    clean_otp = (data.otp_code or "").strip()
    if not data.current_password or not data.new_password:
        raise HTTPException(status_code=400, detail="Current and new password are required")
    if not clean_otp:
        raise HTTPException(status_code=400, detail="Verification code is required")
        
    connection = get_db_connection()
    cursor = connection.cursor()
    
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        "SELECT id FROM otp_codes WHERE user_id = ? AND code = ? AND action = 'update_settings' AND expires_at > ?",
        (current_user_id, clean_otp, now_iso)
    )
    otp_row = cursor.fetchone()
    if not otp_row:
        connection.close()
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
        
    cursor.execute("SELECT password_hash FROM users WHERE id = ?", (current_user_id,))
    row = cursor.fetchone()
    if not row:
        connection.close()
        raise HTTPException(status_code=404, detail="User not found")
        
    stored_hash = row[0]
    if not verify_password(data.current_password, stored_hash):
        connection.close()
        raise HTTPException(status_code=400, detail="Incorrect current password")
        
    new_hash = hash_password(data.new_password)
    cursor.execute("DELETE FROM otp_codes WHERE id = ?", (otp_row[0],))
    cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, current_user_id))
    connection.commit()
    connection.close()
    
    return {"message": "Password updated successfully"}

@app.get("/install.sh")
def get_install_script():
    return FileResponse("install.sh", media_type="text/x-shellscript")

@app.get("/agent/metric_agent.py")
def get_metric_agent():
    return FileResponse("metric_agent.py", media_type="text/x-python")

@app.get("/servers")
def get_servers(current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    
    cursor.execute("SELECT * FROM Server WHERE user_id = ?", (current_user_id,))
    servers = [dict(row) for row in cursor.fetchall()]
    
    connection.close()
    return servers

@app.post("/servers")
def add_server(server: ServerCreate, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute(
        "INSERT INTO Server (user_id, hostname, server_role, target_address) VALUES (?, ?, ?, ?)",
        (current_user_id, server.hostname, server.server_role, server.target_address)
    )
    
    connection.commit()
    connection.close()
    return {"message": "Server added"}

@app.put("/servers/{server_id}")
def update_server(server_id: int, server: ServerUpdate, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT server_id FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    if not cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=404, detail="Server not found")
    
    cursor.execute(
        "UPDATE Server SET is_active = ? WHERE server_id = ? AND user_id = ?",
        (server.is_active, server_id, current_user_id)
    )
    
    timestamp = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        "INSERT INTO HealthChecks (server_id, status, timestamp, cpu_usage, ram_usage) VALUES (?, ?, ?, ?, ?)",
        (server_id, server.is_active, timestamp, None, None)
    )
    cursor.execute(
        "INSERT INTO metrics_raw (server_id, status, timestamp, cpu_usage, ram_usage) VALUES (?, ?, ?, ?, ?)",
        (server_id, server.is_active, timestamp, None, None)
    )
    
    connection.commit()
    connection.close()
    return {"message": "Server updated"}

@app.delete("/servers/{server_id}")
def delete_server(server_id: int, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT server_id FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    if not cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=404, detail="Server not found")
        
    cursor.execute("DELETE FROM HealthChecks WHERE server_id = ?", (server_id,))
    cursor.execute("DELETE FROM metrics_raw WHERE server_id = ?", (server_id,))
    cursor.execute("DELETE FROM metrics_hourly WHERE server_id = ?", (server_id,))
    cursor.execute("DELETE FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    connection.commit()
    connection.close()
    return {"message": "Server deleted"}

@app.get("/servers/{server_id}/history")
def get_server_history(server_id: int, hours: int = 1, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT server_id FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    if not cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=404, detail="Server not found")
        
    cutoff_time = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    
    cursor.execute(
        """
        SELECT status, timestamp, cpu_usage, ram_usage 
        FROM HealthChecks 
        WHERE server_id = ? AND timestamp >= ? 
        ORDER BY timestamp DESC
        """,
        (server_id, cutoff_time)
    )
    
    history = []
    for row in cursor.fetchall():
        history.append({
            "status": row[0],
            "timestamp": row[1],
            "cpu_usage": row[2],
            "ram_usage": row[3]
        })
        
    connection.close()
    return history

@app.get("/servers/{server_id}/logs")
def get_server_logs(server_id: int, status: int, limit: int = 50, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT server_id FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    if not cursor.fetchone():
        connection.close()
        raise HTTPException(status_code=404, detail="Server not found")
        
    cursor.execute(
        """
        SELECT status, timestamp 
        FROM HealthChecks 
        WHERE server_id = ? AND status = ?
        ORDER BY timestamp DESC 
        LIMIT ?
        """,
        (server_id, status, limit)
    )
    
    logs = []
    for row in cursor.fetchall():
        logs.append({
            "status": row[0],
            "timestamp": row[1]
        })
        
    connection.close()
    return logs

@app.get("/servers/{server_id}/uptime")
def get_uptime_matrix(server_id: int, current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT server_id FROM Server WHERE server_id = ? AND user_id = ?", (server_id, current_user_id))
    if not cursor.fetchone():
        connection.close()
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
        cursor.execute(
            """
            SELECT COUNT(*), SUM(status)
            FROM HealthChecks
            WHERE server_id = ? AND timestamp >= ?
            """,
            (server_id, cutoff_time)
        )
        total_checks, online_checks = cursor.fetchone()
        
        if total_checks == 0:
            matrix[label] = "100.00" 
        else:
            online_checks = online_checks or 0 
            percentage = (online_checks / total_checks) * 100
            matrix[label] = f"{percentage:.2f}"
            
    connection.close()
    return matrix

@app.get("/system/retention-stats")
def get_retention_stats(current_user_id: int = Depends(get_current_user)):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM metrics_raw WHERE server_id IN (SELECT server_id FROM Server WHERE user_id = ?)", (current_user_id,))
    raw_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM metrics_hourly WHERE server_id IN (SELECT server_id FROM Server WHERE user_id = ?)", (current_user_id,))
    hourly_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT MIN(timestamp) FROM metrics_raw WHERE server_id IN (SELECT server_id FROM Server WHERE user_id = ?)", (current_user_id,))
    oldest_raw = cursor.fetchone()[0]
    
    cursor.execute("SELECT MIN(timestamp) FROM metrics_hourly WHERE server_id IN (SELECT server_id FROM Server WHERE user_id = ?)", (current_user_id,))
    oldest_hourly = cursor.fetchone()[0]
    
    connection.close()
    
    return {
        "raw_count": raw_count,
        "hourly_count": hourly_count,
        "oldest_raw": oldest_raw or "None",
        "oldest_hourly": oldest_hourly or "None",
        "policy_raw": "30 Days (High-Resolution)",
        "policy_hourly": "15 Months (Hourly Aggregates)",
        "next_schedule": "Daily at 02:00 UTC"
    }

@app.post("/system/trigger-rollup")
def trigger_rollup(current_user_id: int = Depends(get_current_user)):
    process_historical_data()
    return {"message": "Historical rollup and purge executed successfully"}

def monitoring_job():
    connection = get_db_connection()
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    cursor.execute("SELECT server_id, target_address FROM Server")
    servers = [dict(row) for row in cursor.fetchall()]
    connection.close()
    
    timestamp = datetime.now(timezone.utc).isoformat()
    results = []
    
    for server in servers:
        server_id = server["server_id"]
        target = server["target_address"].strip()
        status = 0
        cpu_usage = None
        ram_usage = None
        
        try:
            if target.startswith("http://") or target.startswith("https://"):
                response = requests.get(target, timeout=5)
                if response.status_code < 400:
                    status = 1
                parsed = urlparse(target)
                host = parsed.hostname or "127.0.0.1"
            else:
                status = 1
                host = target.split(":")[0] if ":" in target else target

            metric_url = f"http://{host}:8001/metrics"
            try:
                metric_response = requests.get(metric_url, timeout=3)
                if metric_response.status_code == 200:
                    metrics_data = metric_response.json()
                    cpu_usage = metrics_data.get("cpu_usage")
                    ram_usage = metrics_data.get("ram_usage")
            except Exception:
                pass

        except Exception:
            status = 0
            
        results.append((server_id, status, timestamp, cpu_usage, ram_usage))
        
    connection = get_db_connection()
    cursor = connection.cursor()
    for server_id, status, ts, cpu, ram in results:
        cursor.execute(
            "UPDATE Server SET is_active = ? WHERE server_id = ?",
            (status, server_id)
        )
        cursor.execute(
            "INSERT INTO HealthChecks (server_id, status, timestamp, cpu_usage, ram_usage) VALUES (?, ?, ?, ?, ?)",
            (server_id, status, ts, cpu, ram)
        )
        cursor.execute(
            "INSERT INTO metrics_raw (server_id, status, timestamp, cpu_usage, ram_usage) VALUES (?, ?, ?, ?, ?)",
            (server_id, status, ts, cpu, ram)
        )
    connection.commit()
    connection.close()

def process_historical_data():
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cutoff_15m = (datetime.now(timezone.utc) - timedelta(days=456)).isoformat()
    
    cursor.execute(
        """
        INSERT INTO metrics_hourly (server_id, timestamp, avg_cpu, avg_ram)
        SELECT server_id, strftime('%Y-%m-%d %H:00:00', timestamp), AVG(cpu_usage), AVG(ram_usage)
        FROM metrics_raw
        WHERE timestamp < ?
        GROUP BY server_id, strftime('%Y-%m-%d %H:00:00', timestamp)
        """,
        (cutoff_30d,)
    )
    
    cursor.execute(
        "DELETE FROM metrics_raw WHERE timestamp < ?",
        (cutoff_30d,)
    )
    
    cursor.execute(
        "DELETE FROM HealthChecks WHERE timestamp < ?",
        (cutoff_30d,)
    )
    
    cursor.execute(
        "DELETE FROM metrics_hourly WHERE timestamp < ?",
        (cutoff_15m,)
    )
    
    connection.commit()
    connection.close()
    print(f"Historical data processed: rollup and purge completed at {datetime.now(timezone.utc).isoformat()}", flush=True)

scheduler = BackgroundScheduler()
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
scheduler.start()