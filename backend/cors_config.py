from urllib.parse import urlsplit


class CorsConfigurationError(ValueError):
    pass


def normalize_origin(origin: str) -> str:
    value = (origin or "").strip()
    if not value or value == "null" or "*" in value:
        raise CorsConfigurationError("origins must be explicit and cannot contain wildcards")

    parsed = urlsplit(value)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise CorsConfigurationError("origins must use http or https")
    if parsed.username is not None or parsed.password is not None:
        raise CorsConfigurationError("origins must not contain credentials")
    if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise CorsConfigurationError("origins must not contain paths, queries, or fragments")

    hostname = parsed.hostname
    if not hostname:
        raise CorsConfigurationError("origins must include a hostname")
    try:
        hostname = hostname.rstrip(".").lower().encode("idna").decode("ascii")
        port = parsed.port
    except (UnicodeError, ValueError) as exc:
        raise CorsConfigurationError("origin contains an invalid hostname or port") from exc

    default_port = 443 if scheme == "https" else 80
    formatted_host = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != default_port:
        formatted_host = f"{formatted_host}:{port}"
    return f"{scheme}://{formatted_host}"


def parse_allowed_origins(raw_origins: str) -> list[str]:
    configured_origins = [item.strip() for item in (raw_origins or "").split(",") if item.strip()]
    if not configured_origins:
        raise CorsConfigurationError("at least one allowed origin is required")

    normalized_origins = []
    for origin in configured_origins:
        normalized = normalize_origin(origin)
        if normalized not in normalized_origins:
            normalized_origins.append(normalized)
    return normalized_origins
