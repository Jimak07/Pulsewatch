import unittest

from cors_config import CorsConfigurationError, normalize_origin, parse_allowed_origins


class CorsConfigurationTests(unittest.TestCase):
    def test_parses_and_normalizes_explicit_origins(self):
        origins = parse_allowed_origins(
            "https://app.example.com/, http://localhost:5173, https://app.example.com"
        )
        self.assertEqual(origins, ["https://app.example.com", "http://localhost:5173"])

    def test_rejects_wildcards_and_empty_configuration(self):
        for value in ("", "*", "https://*.example.com"):
            with self.subTest(value=value):
                with self.assertRaises(CorsConfigurationError):
                    parse_allowed_origins(value)

    def test_rejects_non_http_origins_and_paths(self):
        for value in ("ftp://example.com", "https://example.com/application"):
            with self.subTest(value=value):
                with self.assertRaises(CorsConfigurationError):
                    parse_allowed_origins(value)

    def test_normalizes_default_ports(self):
        self.assertEqual(normalize_origin("https://example.com:443"), "https://example.com")
        self.assertEqual(normalize_origin("http://example.com:80"), "http://example.com")


if __name__ == "__main__":
    unittest.main()
