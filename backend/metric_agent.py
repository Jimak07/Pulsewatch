from dotenv import load_dotenv
import json
import sys
import os
from pathlib import Path
import psutil
from http.server import HTTPServer, BaseHTTPRequestHandler

load_dotenv()
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

AGENT_AUTH_TOKEN = os.getenv("AGENT_AUTH_TOKEN", "pulsewatch-agent-secret-token-2026")

class MetricHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/metrics"):
            auth_header = self.headers.get("Authorization", "").strip()
            expected_bearer = f"Bearer {AGENT_AUTH_TOKEN}"
            
            if auth_header != expected_bearer and auth_header != AGENT_AUTH_TOKEN:
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                err_payload = json.dumps({
                    "error": "Unauthorized",
                    "message": "Invalid or missing Bearer authorization token"
                }).encode("utf-8")
                self.send_header("Content-Length", str(len(err_payload)))
                self.end_headers()
                self.wfile.write(err_payload)
                return

            cpu_usage = psutil.cpu_percent(interval=0.1)
            ram_usage = psutil.virtual_memory().percent
            response_data = {
                "cpu_usage": cpu_usage,
                "ram_usage": ram_usage
            }
            payload = json.dumps(response_data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

def run(port=8001):
    global AGENT_AUTH_TOKEN
    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, MetricHandler)
    print(f"PulseWatch Hardened Metric Agent running on port {port} (Token authentication enabled)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    port = 8001
    args = sys.argv[1:]
    idx = 0
    while idx < len(args):
        arg = args[idx]
        if arg == "--token" and idx + 1 < len(args):
            AGENT_AUTH_TOKEN = args[idx + 1]
            idx += 2
        elif arg.isdigit():
            port = int(arg)
            idx += 1
        else:
            idx += 1
    run(port=port)
