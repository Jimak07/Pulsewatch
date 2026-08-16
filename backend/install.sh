#!/usr/bin/env bash
set -euo pipefail

main() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "This script must be run as root or with sudo." >&2
        exit 1
    fi

    local AGENT_URL="${1:-http://YOUR_SERVER_IP/agent/metric_agent.py}"
    local INSTALL_DIR="/opt/pulsewatch"
    local SERVICE_FILE="/etc/systemd/system/pulsewatch-agent.service"

    if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -y
        apt-get install -y python3 python3-pip python3-psutil curl
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y python3 python3-pip python3-psutil curl
    elif command -v yum >/dev/null 2>&1; then
        yum install -y python3 python3-pip python3-psutil curl
    elif command -v zypper >/dev/null 2>&1; then
        zypper --non-interactive install python3 python3-pip python3-psutil curl
    else
        echo "Supported package manager not found." >&2
        exit 1
    fi

    python3 -c "import psutil" >/dev/null 2>&1 || pip3 install psutil --break-system-packages 2>/dev/null || pip3 install psutil || true

    mkdir -p "${INSTALL_DIR}"

    curl -fsSL "${AGENT_URL}" -o "${INSTALL_DIR}/metric_agent.py"
    chmod 755 "${INSTALL_DIR}/metric_agent.py"

    cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=PulseWatch Metric Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/metric_agent.py 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable pulsewatch-agent.service
    systemctl restart pulsewatch-agent.service

    if command -v ufw >/dev/null 2>&1 && ufw status | grep -qw "active"; then
        ufw allow 8001/tcp
    elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
        firewall-cmd --permanent --add-port=8001/tcp
        firewall-cmd --reload
    fi

    echo "PulseWatch metric agent successfully installed and running on port 8001."
}

main "$@"
