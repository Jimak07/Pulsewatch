import socket
import unittest
from unittest.mock import patch

from target_security import UnsafeTargetError, validate_and_resolve_target


def dns_results(*addresses: str):
    results = []
    for address in addresses:
        if ":" in address:
            socket_address = (address, 443, 0, 0)
            family = socket.AF_INET6
        else:
            socket_address = (address, 443)
            family = socket.AF_INET
        results.append((family, socket.SOCK_STREAM, 6, "", socket_address))
    return results


class TargetSecurityTests(unittest.TestCase):
    def assert_target_rejected(self, url: str, *addresses: str):
        resolved = addresses or ("93.184.216.34",)
        with patch("target_security.socket.getaddrinfo", return_value=dns_results(*resolved)):
            with self.assertRaises(UnsafeTargetError):
                validate_and_resolve_target(url)

    def test_rejects_non_http_schemes_and_embedded_credentials(self):
        self.assert_target_rejected("ftp://example.com")
        self.assert_target_rejected("http://user:pass@example.com")

    def test_rejects_local_and_metadata_hostnames(self):
        self.assert_target_rejected("http://localhost")
        self.assert_target_rejected("http://service.localhost")
        self.assert_target_rejected("http://metadata.google.internal")

    def test_rejects_non_public_ip_ranges(self):
        for address in (
            "127.0.0.1",
            "10.0.0.8",
            "172.16.0.1",
            "192.168.1.5",
            "169.254.169.254",
            "::1",
            "fe80::1",
        ):
            with self.subTest(address=address):
                self.assert_target_rejected("http://example.com", address)

    def test_rejects_hostname_if_any_dns_answer_is_non_public(self):
        self.assert_target_rejected("http://example.com", "93.184.216.34", "10.0.0.8")

    def test_pins_public_target_to_validated_ip(self):
        with patch(
            "target_security.socket.getaddrinfo",
            return_value=dns_results("93.184.216.34"),
        ):
            target = validate_and_resolve_target("https://example.com:8443/health?full=1")

        self.assertEqual(target.resolved_ip, "93.184.216.34")
        self.assertEqual(target.pinned_url(), "https://93.184.216.34:8443/health?full=1")
        self.assertEqual(target.host_header(), "example.com:8443")


if __name__ == "__main__":
    unittest.main()
