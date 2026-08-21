import unittest

from auth_security import InMemoryRateLimiter, validate_password_policy


class PasswordPolicyTests(unittest.TestCase):
    def test_accepts_compliant_password(self):
        validate_password_policy("secure1!")

    def test_rejects_short_password(self):
        with self.assertRaisesRegex(ValueError, "between 8 and 64"):
            validate_password_policy("short1!")

    def test_requires_number_and_special_character(self):
        with self.assertRaisesRegex(ValueError, "number"):
            validate_password_policy("NoNumbers!")
        with self.assertRaisesRegex(ValueError, "special"):
            validate_password_policy("NoSpecial1")


class RateLimiterTests(unittest.TestCase):
    def test_blocks_after_configured_attempt_count(self):
        limiter = InMemoryRateLimiter(limit=2, window_seconds=300)
        self.assertIsNone(limiter.check_and_record("login:127.0.0.1"))
        self.assertIsNone(limiter.check_and_record("login:127.0.0.1"))
        self.assertGreater(limiter.check_and_record("login:127.0.0.1"), 0)

    def test_failed_attempts_can_be_reset_after_success(self):
        limiter = InMemoryRateLimiter(limit=1, window_seconds=300)
        limiter.record("login:127.0.0.1")
        self.assertIsNotNone(limiter.retry_after("login:127.0.0.1"))
        limiter.reset("login:127.0.0.1")
        self.assertIsNone(limiter.retry_after("login:127.0.0.1"))


if __name__ == "__main__":
    unittest.main()
