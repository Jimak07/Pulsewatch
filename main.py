from fastapi import FastAPI, HTTPException, Depends, status
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
from typing import Optional

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

class ServerCreate(BaseModel):
    hostname: str
    server_role: str
    target_address: str

class ServerUpdate(BaseModel):
    is_active: int

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
            password_hash TEXT NOT NULL
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
    
    cursor.execute("SELECT id FROM users WHERE username = 'admin'")
    admin_row = cursor.fetchone()
    default_pwd = hash_password("admin123")
    if not admin_row:
        cursor.execute("INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', ?)", (default_pwd,))
    else:
        cursor.execute("UPDATE users SET password_hash = ? WHERE username = 'admin'", (default_pwd,))
    
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
        cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (clean_username, hashed))
        user_id = cursor.lastrowid
        connection.commit()
    except sqlite3.IntegrityError:
        connection.close()
        raise HTTPException(status_code=400, detail="Username already exists")
        
    connection.close()
    token = create_access_token(user_id, clean_username)
    return {"access_token": token, "token_type": "bearer", "user_id": user_id, "username": clean_username}

@app.post("/login")
def login(auth: UserAuth):
    clean_username = auth.username.strip()
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE username = ?", (clean_username,))
    row = cursor.fetchone()
    connection.close()
    
    if not row or not verify_password(auth.password, row[1]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    user_id = row[0]
    token = create_access_token(user_id, clean_username)
    return {"access_token": token, "token_type": "bearer", "user_id": user_id, "username": clean_username}

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