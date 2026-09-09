"""Async monitor protocol checks used by the background polling worker."""

import asyncio
import socket
import subprocess
import sys
import time
from typing import Any

import httpx


async def check_http(url: str, method: str = "GET", expected_code: int = 200) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        request_method = method.upper()
        if request_method not in {"GET", "HEAD"}:
            raise ValueError("HTTP monitor method must be GET or HEAD")
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False, verify=True) as client:
            response = await client.request(request_method, url)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {
            "ok": response.status_code == expected_code,
            "status_code": response.status_code,
            "response_time_ms": elapsed_ms,
            "ssl_days_left": None,
            "is_success": response.status_code == expected_code,
            "error": None if response.status_code == expected_code else f"Expected HTTP {expected_code}, got {response.status_code}",
        }
    except Exception as exc:
        return {"ok": False, "status_code": None, "response_time_ms": None, "error": str(exc)}


async def check_tcp(host: str, port: int, timeout: float = 5) -> dict[str, Any]:
    started = time.perf_counter()
    writer = None
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        return {"ok": True, "response_time_ms": round((time.perf_counter() - started) * 1000, 2), "error": None}
    except Exception as exc:
        return {"ok": False, "response_time_ms": None, "error": str(exc)}
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()


async def check_dns(domain: str, record_type: str = "A") -> dict[str, Any]:
    if record_type.upper() != "A":
        return {"ok": False, "response_time_ms": None, "error": "Only A records are currently supported"}
    started = time.perf_counter()
    try:
        records = await asyncio.to_thread(socket.getaddrinfo, domain, None, socket.AF_INET)
        resolved = records[0][4][0] if records else None
        return {"ok": bool(records), "resolved_value": resolved, "response_time_ms": round((time.perf_counter() - started) * 1000, 2), "error": None}
    except Exception as exc:
        return {"ok": False, "response_time_ms": None, "error": str(exc)}


async def check_ping(host: str, timeout: float = 5) -> dict[str, Any]:
    started = time.perf_counter()
    command = ["ping", "-n", "1", "-w", str(int(timeout * 1000)), host] if sys.platform == "win32" else ["ping", "-c", "1", "-W", str(max(1, int(timeout))), host]
    try:
        result = await asyncio.to_thread(subprocess.run, command, capture_output=True, check=False, timeout=timeout + 1)
        return {"ok": result.returncode == 0, "response_time_ms": round((time.perf_counter() - started) * 1000, 2) if result.returncode == 0 else None, "error": None if result.returncode == 0 else "Ping failed"}
    except Exception as exc:
        return {"ok": False, "response_time_ms": None, "error": str(exc)}
