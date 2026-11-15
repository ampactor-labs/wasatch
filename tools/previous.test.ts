import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { previousFile } from "./previous.ts";

test("a download that fails is tried again before it counts as gone", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    if (req.url === "/flaky.json" && calls < 3) res.writeHead(calls === 1 ? 503 : 404).end();
    else if (req.url === "/flaky.json") res.writeHead(200).end('{"ok":1}');
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    assert.equal(await previousFile(base, "flaky.json", { backoffMs: 5 }), '{"ok":1}');
    assert.equal(calls, 3);
    calls = 0;
    assert.equal(await previousFile(base, "gone.json", { tries: 3, backoffMs: 5 }), null);
    assert.equal(calls, 3, "every try spent before giving up");
  } finally {
    server.close();
  }
});
