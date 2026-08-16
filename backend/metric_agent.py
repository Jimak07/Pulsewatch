import json
import sys
import psutil
from http.server import HTTPServer, BaseHTTPRequestHandler

class MetricHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/metrics"):
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
    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, MetricHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    port = 8001
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run(port=port)
