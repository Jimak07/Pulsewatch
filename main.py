from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import sqlite3
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
import requests
from urllib.parse import urlparse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ServerCreate(BaseModel):
    hostname: str
    server_role: str
    target_address: str

class ServerUpdate(BaseModel):
    is_active: int

def get_db_connection():
    connection = sqlite3.connect("database.db", timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    return connection

def init_db():
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS Server (
            server_id INTEGER PRIMARY KEY AUTOINCREMENT,
            hostname TEXT NOT NULL,
            server_role TEXT NOT NULL,
            target_address TEXT NOT NULL,
            active_connections INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
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
    
    cursor.execute("PRAGMA table_info(HealthChecks)")
    columns = [row[1] for row in cursor.fetchall()]
    if "cpu_usage" not in columns:
        cursor.execute("ALTER TABLE HealthChecks ADD COLUMN cpu_usage REAL")
    if "ram_usage" not in columns:
        cursor.execute("ALTER TABLE HealthChecks ADD COLUMN ram_usage REAL")
    
    connection.commit()
    connection.close()

init_db()

@app.get("/install.sh")
def get_install_script():
    return FileResponse("install.sh", media_type="text/x-shellscript")

@app.get("/agent/metric_agent.py")
def get_metric_agent():
    return FileResponse("metric_agent.py", media_type="text/x-python")

@app.get("/servers")
def get_servers():
    connection = get_db_connection()
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    
    cursor.execute("SELECT * FROM Server")
    servers = [dict(row) for row in cursor.fetchall()]
    
    connection.close()
    return servers

@app.post("/servers")
def add_server(server: ServerCreate):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute(
        "INSERT INTO Server (hostname, server_role, target_address) VALUES (?, ?, ?)",
        (server.hostname, server.server_role, server.target_address)
    )
    
    connection.commit()
    connection.close()
    return {"message": "Server added"}

@app.put("/servers/{server_id}")
def update_server(server_id: int, server: ServerUpdate):
    connection = get_db_connection()
    cursor = connection.cursor()
    
    cursor.execute(
        "UPDATE Server SET is_active = ? WHERE server_id = ?",
        (server.is_active, server_id)
    )
    
    timestamp = datetime.now(timezone.utc).isoformat()
    cursor.execute(
        "INSERT INTO HealthChecks (server_id, status, timestamp, cpu_usage, ram_usage) VALUES (?, ?, ?, ?, ?)",
        (server_id, server.is_active, timestamp, None, None)
    )
    
    connection.commit()
    connection.close()
    return {"message": "Server updated"}

@app.delete("/servers/{server_id}")
def delete_server(server_id: int):
    connection = get_db_connection()
    cursor = connection.cursor()
    cursor.execute("DELETE FROM HealthChecks WHERE server_id = ?", (server_id,))
    cursor.execute("DELETE FROM Server WHERE server_id = ?", (server_id,))
    connection.commit()
    connection.close()
    return {"message": "Server deleted"}

@app.get("/servers/{server_id}/history")
def get_server_history(server_id: int, hours: int = 1):
    connection = get_db_connection()
    cursor = connection.cursor()
    
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
def get_server_logs(server_id: int, status: int, limit: int = 50):
    connection = get_db_connection()
    cursor = connection.cursor()
    
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
def get_uptime_matrix(server_id: int):
    connection = get_db_connection()
    cursor = connection.cursor()
    
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
    connection.commit()
    connection.close()

scheduler = BackgroundScheduler()
scheduler.add_job(
    monitoring_job, 
    'interval', 
    seconds=30, 
    misfire_grace_time=15,
    max_instances=5,
    next_run_time=datetime.now(timezone.utc)
)
scheduler.start()