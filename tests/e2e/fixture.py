"""Minimal synthetic HTTPS upstream, confined to the disposable test VM.

This is an encoding/routing fixture, not an emulator of xMatters semantics.
It records only methods, paths and authentication outcomes, never credentials.
"""

import base64
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import ssl
from urllib.parse import parse_qs, urlsplit


STATE = Path("/var/lib/xmatters-fixture")
AUTH = (
    "Basic "
    + base64.b64encode(b"x-api-key-synthetic-e2e:synthetic-upstream-secret").decode()
)
PERSON = {"id": "synthetic-person", "targetName": "synthetic-person"}


class Handler(BaseHTTPRequestHandler):
    people = {}
    attachment = None

    def log_message(self, format, *args):
        pass  # BaseHTTPRequestHandler's raw request logging is unnecessary.

    def respond(
        self, status, body=None, *, content_type="application/json", headers=None
    ):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        if status == 204:
            data = b""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self):
        authenticated = self.headers.get("Authorization") == AUTH
        with (STATE / "requests.jsonl").open("a") as journal:
            journal.write(
                json.dumps(
                    {
                        "method": self.command,
                        "path": self.path,
                        "authenticated": authenticated,
                    }
                )
                + "\n"
            )
        if not authenticated or self.headers.get("Host") != "example.xmatters.com":
            self.respond(
                401, {"error": "Incorrect synthetic upstream authentication or host"}
            )
            return
        url = urlsplit(self.path)
        if self.command == "GET" and url.path == "/api/xm/1/people":
            query = parse_qs(url.query)
            if query == {"limit": ["1"], "offset": ["429"]}:
                # Deliberately echo fake secrets to exercise upstream-error suppression.
                self.respond(
                    429,
                    {"error": AUTH + " synthetic-upstream-secret"},
                    headers={"Retry-After": "7"},
                )
            elif query == {"limit": ["1"], "offset": ["302"]}:
                self.respond(
                    302,
                    {},
                    headers={
                        "Location": "https://example.xmatters.com/redirect-must-not-be-followed"
                    },
                )
            elif query == {"limit": ["1"], "offset": ["0"]}:
                self.respond(200, {"data": [PERSON], "count": 1, "total": 1})
            else:
                self.respond(400, {"error": "Unexpected synthetic query"})
        elif self.command == "GET" and url.path == "/api/xm/1/people/synthetic-created":
            person = self.people.get("synthetic-created")
            self.respond(200 if person else 404, person)
        elif self.command == "POST" and url.path == "/api/xm/1/people":
            body = self.read_body()
            if self.headers.get("Content-Type") != "application/json" or json.loads(
                body
            ) != {"targetName": "synthetic-created"}:
                self.respond(400, {"error": "Unexpected synthetic person payload"})
                return
            person = {"id": "synthetic-created", "targetName": "synthetic-created"}
            self.people[person["id"]] = person
            self.respond(201, person)
        elif (
            self.command == "DELETE"
            and url.path == "/api/xm/1/people/synthetic-created"
        ):
            self.people.pop("synthetic-created", None)
            self.respond(204)
        elif (
            self.command == "POST"
            and url.path
            == "/api/xm/1/forms/synthetic-form/scenarios/synthetic-scenario/attachments"
        ):
            content_type = self.headers.get("Content-Type", "")
            body = self.read_body()
            message = BytesParser(policy=policy.default).parsebytes(
                f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
                + body
            )
            parts = list(message.iter_parts())
            if not content_type.startswith("multipart/form-data;") or len(parts) != 1:
                self.respond(400, {"error": "Expected one synthetic multipart file"})
                return
            part = parts[0]
            payload = part.get_payload(decode=True)
            if (
                part.get_filename() != "synthetic.txt"
                or part.get_param("name", header="content-disposition") != "file"
                or part.get_content_type() != "text/plain"
                or payload != b"synthetic attachment\n"
            ):
                self.respond(400, {"error": "Incorrect synthetic multipart encoding"})
                return
            Handler.attachment = payload
            self.respond(201, {"name": "synthetic.txt", "size": len(payload)})
        elif (
            self.command == "GET"
            and url.path == "/api/xm/1/events/synthetic-event/attachments/synthetic.txt"
            and self.attachment is not None
        ):
            self.respond(200, self.attachment, content_type="text/plain")
        else:
            self.respond(500, {"error": "Unexpected request in synthetic fixture"})

    def read_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 <= size <= 8192:
            raise ValueError("Synthetic request exceeds fixture limit")
        return self.rfile.read(size)

    do_GET = dispatch
    do_POST = dispatch
    do_DELETE = dispatch
    do_PUT = dispatch
    do_PATCH = dispatch


if __name__ == "__main__":
    (STATE / "requests.jsonl").touch()
    server = HTTPServer(("127.0.0.1", 443), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(STATE / "cert.pem", STATE / "key.pem")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()
