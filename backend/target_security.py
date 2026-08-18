from dataclasses import dataclass
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


BLOCKED_HOSTNAMES = {
    "instance-data",
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
}


class UnsafeTargetError(ValueError):
    pass


def _format_url_host(host: str) -> str:
    return f"[{host}]" if ":" in host else host


def _format_host_header(host: str, port: int, default_port: int) -> str:
    formatted_host = _format_url_host(host)
    return formatted_host if port == default_port else f"{formatted_host}:{port}"


@dataclass(frozen=True)
class ValidatedTarget:
    original_url: str
    scheme: str
    hostname: str
    port: int
    resolved_ip: str
    path: str
    query: str

    def pinned_url(
        self,
        *,
        scheme: str | None = None,
        port: int | None = None,
        path: str | None = None,
        query: str | None = None,
    ) -> str:
        request_scheme = scheme or self.scheme
        request_port = port or self.port
        request_path = self.path if path is None else path
        request_query = self.query if query is None else query
        netloc = f"{_format_url_host(self.resolved_ip)}:{request_port}"
        return urlunsplit((request_scheme, netloc, request_path or "/", request_query, ""))

    def host_header(self, *, port: int | None = None, scheme: str | None = None) -> str:
        request_scheme = scheme or self.scheme
        request_port = port or self.port
        default_port = 443 if request_scheme == "https" else 80
        return _format_host_header(self.hostname, request_port, default_port)


def _validate_ip_address(address: str) -> str:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError as exc:
        raise UnsafeTargetError("Target resolved to an invalid IP address") from exc

    if not ip.is_global:
        raise UnsafeTargetError(
            "Target resolves to a loopback, private, link-local, reserved, or otherwise non-public IP address"
        )
    return ip.compressed


def validate_and_resolve_target(target_address: str) -> ValidatedTarget:
    target = (target_address or "").strip()
    if not target:
        raise UnsafeTargetError("Target address is required")
    if "\\" in target or any(ord(char) < 32 or ord(char) == 127 for char in target):
        raise UnsafeTargetError("Target address contains invalid characters")

    parsed = urlsplit(target)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise UnsafeTargetError("Target URL scheme must be http or https")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeTargetError("Target URL must not contain embedded credentials")

    hostname = parsed.hostname
    if not hostname:
        raise UnsafeTargetError("Target URL must include a hostname")
    hostname = hostname.rstrip(".").lower()
    try:
        hostname = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise UnsafeTargetError("Target URL contains an invalid hostname") from exc
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname in BLOCKED_HOSTNAMES:
        raise UnsafeTargetError("Target hostname is not allowed")

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeTargetError("Target URL contains an invalid port") from exc
    if port < 1 or port > 65535:
        raise UnsafeTargetError("Target URL contains an invalid port")

    try:
        address_info = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UnsafeTargetError("Target hostname could not be resolved") from exc

    resolved_addresses = []
    for _, _, _, _, socket_address in address_info:
        address = socket_address[0]
        if address not in resolved_addresses:
            resolved_addresses.append(address)
    if not resolved_addresses:
        raise UnsafeTargetError("Target hostname did not resolve to an IP address")

    validated_addresses = [_validate_ip_address(address) for address in resolved_addresses]
    return ValidatedTarget(
        original_url=target,
        scheme=scheme,
        hostname=hostname,
        port=port,
        resolved_ip=validated_addresses[0],
        path=parsed.path or "/",
        query=parsed.query,
    )
