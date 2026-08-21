from collections import defaultdict, deque
from threading import Lock
from time import monotonic

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64

def validate_password_policy(password: str) -> None:
    if not isinstance(password, str):
        raise ValueError("Password must be a string")
    if len(password) < PASSWORD_MIN_LENGTH or len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError("Password must be between 8 and 64 characters")
    if not any(character.isdigit() for character in password):
        raise ValueError("Password must contain at least one number")
    if not any(not character.isalnum() for character in password):
        raise ValueError("Password must contain at least one special character")
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password is too long when encoded")

class InMemoryRateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._attempts = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, attempts: deque, now: float) -> None:
        cutoff = now - self.window_seconds
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()

    def retry_after(self, key: str) -> int | None:
        now = monotonic()
        with self._lock:
            attempts = self._attempts[key]
            self._prune(attempts, now)
            if len(attempts) >= self.limit:
                return max(1, int(self.window_seconds - (now - attempts[0])))
            return None

    def record(self, key: str) -> None:
        now = monotonic()
        with self._lock:
            attempts = self._attempts[key]
            self._prune(attempts, now)
            attempts.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)

    def check_and_record(self, key: str) -> int | None:
        retry_after = self.retry_after(key)
        if retry_after is not None:
            return retry_after
        self.record(key)
        return None
