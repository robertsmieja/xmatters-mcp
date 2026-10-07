"""Opt-in VM acceptance tests. Every identity and response is synthetic."""

import base64
import http.client
import itertools
import json
import os
from pathlib import Path
import unittest
from typing import Any


TOKEN = "synthetic-e2e-mcp-token-0123456789abcdef"
PROTOCOL = "2026-07-28"
IDS = itertools.count(1)


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Required paths are supplied inside the disposable NixOS VM only.
        cls.catalog = json.loads(Path(os.environ["E2E_CATALOG"]).read_text())
        cls.journal = Path(os.environ["E2E_JOURNAL"])

    def requests(self):
        return [json.loads(line) for line in self.journal.read_text().splitlines()]

    def rpc(
        self, method, params=None, *, port=3000, token=TOKEN, headers=None
    ) -> tuple[int, str | dict[str, Any]]:
        request_id = next(IDS)
        params = dict(params or {})
        params["_meta"] = {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
                "name": "nix-vm-acceptance",
                "version": "1.0.0",
            },
        }
        wire_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL,
            "Mcp-Method": method,
        }
        if token is not None:
            wire_headers["Authorization"] = f"Bearer {token}"
        if method == "tools/call":
            wire_headers["Mcp-Name"] = params["name"]
        elif method == "resources/read":
            wire_headers["Mcp-Name"] = params["uri"]
        wire_headers.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            connection.request(
                "POST",
                "/mcp",
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": method,
                        "params": params,
                    }
                ),
                wire_headers,
            )
            response = connection.getresponse()
            body = response.read().decode()
            if response.status != 200:
                return response.status, body
            self.assertIsNone(response.getheader("Mcp-Session-Id"))
            self.assertIn("no-store", response.getheader("Cache-Control", ""))
            message = json.loads(body)
            self.assertEqual(message["id"], request_id)
            self.assertEqual(message["jsonrpc"], "2.0")
            result = message["result"]
            self.assertEqual(result["resultType"], "complete")
            return response.status, result
        finally:
            connection.close()

    def result(self, method, params=None, **options):
        status, result = self.rpc(method, params, **options)
        self.assertEqual(status, 200, result)
        assert isinstance(result, dict)
        return result

    def tool(self, name, arguments, **options):
        return self.result(
            "tools/call", {"name": name, "arguments": arguments}, **options
        )

    def test_discovery_and_complete_catalog(self):
        before = self.requests()
        discovered = self.result("server/discover")
        self.assertEqual(discovered["supportedVersions"], [PROTOCOL])
        self.assertEqual(
            discovered["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
            "xmatters-mcp",
        )
        tools = self.result("tools/list")["tools"]
        self.assertEqual(
            [tool["name"] for tool in tools], [op["id"] for op in self.catalog]
        )
        resource = self.result("resources/read", {"uri": "xmatters://api/catalog"})
        catalog = json.loads(resource["contents"][0]["text"])
        self.assertEqual(catalog["operations"], self.catalog)
        self.assertEqual(catalog["operationCount"], len(self.catalog))
        self.assertEqual(self.requests(), before)

    def test_https_get_and_upstream_authentication(self):
        before = len(self.requests())
        result = self.tool("xmatters_get_people", {"query": {"limit": 1, "offset": 0}})
        self.assertFalse(result["isError"])
        self.assertEqual(
            result["structuredContent"]["data"],
            {
                "data": [{"id": "synthetic-person", "targetName": "synthetic-person"}],
                "count": 1,
                "total": 1,
            },
        )
        self.assertEqual(
            self.requests()[before:],
            [
                {
                    "method": "GET",
                    "path": "/api/xm/1/people?limit=1&offset=0",
                    "authenticated": True,
                }
            ],
        )

    def test_local_authentication_and_rebinding_guards_do_not_dispatch(self):
        before = self.requests()
        for token in [None, "synthetic-wrong-token-0123456789abcdef"]:
            with self.subTest(token=token):
                status, _ = self.rpc("server/discover", token=token)
                self.assertEqual(status, 401)
        for headers in [
            {"Origin": "https://attacker.invalid"},
            {"Host": "attacker.invalid"},
        ]:
            with self.subTest(headers=headers):
                status, _ = self.rpc("server/discover", headers=headers)
                self.assertEqual(status, 403)
        invalid = self.tool("xmatters_get_people", {"url": "https://attacker.invalid"})
        self.assertTrue(invalid["isError"])
        self.assertEqual(self.requests(), before)

    def test_write_opt_in_confirmation_and_read_back(self):
        arguments = {"body": {"targetName": "synthetic-created"}, "confirm": True}
        before = self.requests()
        blocked = self.tool("xmatters_create_a_person", arguments)
        self.assertTrue(blocked["isError"])
        self.assertIn("Writes are disabled", blocked["structuredContent"]["error"])
        unconfirmed = self.tool(
            "xmatters_create_a_person", {"body": arguments["body"]}, port=3001
        )
        self.assertTrue(unconfirmed["isError"])
        self.assertEqual(self.requests(), before)
        created = self.tool("xmatters_create_a_person", arguments, port=3001)
        self.assertFalse(created["isError"])
        expected = {"id": "synthetic-created", "targetName": "synthetic-created"}
        self.assertEqual(created["structuredContent"]["data"], expected)
        read_back = self.tool(
            "xmatters_get_a_person_by_id", {"path": {"personID": expected["id"]}}
        )
        self.assertEqual(read_back["structuredContent"]["data"], expected)
        deleted = self.tool(
            "xmatters_delete_a_person",
            {"path": {"personID": expected["id"]}, "confirm": True},
            port=3001,
        )
        self.assertFalse(deleted["isError"])
        self.assertIsNone(deleted["structuredContent"]["data"])
        missing = self.tool(
            "xmatters_get_a_person_by_id", {"path": {"personID": expected["id"]}}
        )
        self.assertTrue(missing["isError"])
        self.assertEqual(missing["structuredContent"]["status"], 404)
        self.assertEqual(
            [entry["method"] for entry in self.requests()[len(before) :]],
            ["POST", "GET", "DELETE", "GET"],
        )

    def test_multipart_upload_and_binary_download(self):
        payload = b"synthetic attachment\n"
        encoded = base64.b64encode(payload).decode()
        uploaded = self.tool(
            "xmatters_upload_attachment_to_a_scenario",
            {
                "path": {
                    "formId": "synthetic-form",
                    "scenarioId": "synthetic-scenario",
                },
                "upload": {
                    "name": "synthetic.txt",
                    "contentBase64": encoded,
                    "mimeType": "text/plain",
                },
                "confirm": True,
            },
            port=3001,
        )
        self.assertFalse(uploaded["isError"])
        self.assertEqual(
            uploaded["structuredContent"]["data"],
            {"name": "synthetic.txt", "size": len(payload)},
        )
        downloaded = self.tool(
            "xmatters_get_an_event_attachment",
            {
                "path": {"eventId": "synthetic-event", "attachmentId": "synthetic.txt"},
            },
        )
        self.assertFalse(downloaded["isError"])
        self.assertEqual(
            downloaded["structuredContent"]["data"],
            {"contentBase64": encoded, "mimeType": "text/plain"},
        )

    def test_upstream_failures_are_sanitized_and_not_retried(self):
        for offset, code, status in [
            (429, "HTTP_ERROR", 429),
            (302, "REDIRECT_REJECTED", 302),
        ]:
            with self.subTest(offset=offset):
                before = len(self.requests())
                result = self.tool(
                    "xmatters_get_people", {"query": {"limit": 1, "offset": offset}}
                )
                self.assertTrue(result["isError"])
                self.assertEqual(result["structuredContent"]["code"], code)
                self.assertEqual(result["structuredContent"]["status"], status)
                if offset == 429:
                    self.assertEqual(result["structuredContent"]["retryAfter"], 7)
                for value in [
                    "synthetic-upstream-secret",
                    "x-api-key-synthetic-e2e",
                    TOKEN,
                ]:
                    self.assertNotIn(value, json.dumps(result))
                self.assertEqual(len(self.requests()), before + 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
