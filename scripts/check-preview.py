"""Verifies the GameVault preview on a given base URL: 302 preview redirect + clean teardown."""
import json
import struct
import urllib.error
import urllib.request
import zlib

BASE = "http://169.254.0.21:9100"


def req(url, method="GET", body=None, headers=None):
    r = urllib.request.Request(url, method=method, data=body, headers=headers or {})
    with urllib.request.urlopen(r, timeout=20) as resp:
        return resp.status, resp.read(), dict(resp.headers)


def make_png(w=24, h=16):
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            raw += bytes((200, 80 + (y * 5) % 120, 120))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


data = make_png()
status, body, _ = req(
    f"{BASE}/api/assets/upload-url",
    "POST",
    json.dumps({"filename": "redirect_check.png", "size": len(data)}).encode(),
    {"Content-Type": "application/json"},
)
ticket = json.loads(body)
req(ticket["uploadUrl"], "PUT", data, {"Content-Type": ticket["contentType"]})
status, body, _ = req(
    f"{BASE}/api/assets/confirm-upload",
    "POST",
    json.dumps({"assetId": ticket["assetId"]}).encode(),
    {"Content-Type": "application/json"},
)
asset = json.loads(body)["asset"]

opener = urllib.request.build_opener(NoRedirect)
try:
    resp = opener.open(f"{BASE}/api/assets/{asset['id']}/file", timeout=20)
    code, location = resp.status, resp.headers.get("Location", "")
except urllib.error.HTTPError as err:
    code, location = err.code, err.headers.get("Location", "")

signed = "X-Amz-Signature" in location or "Signature" in location
print(f"GET /api/assets/:id/file -> HTTP {code}  presigned={signed}")

status, body, _ = req(f"{BASE}/api/assets/{asset['id']}", "DELETE")
print(f"cleanup DELETE          -> HTTP {status}")
status, body, _ = req(f"{BASE}/api/assets")
print(f"library total           -> {json.loads(body)['total']}")
