import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("current Codex app-server supports Web slash command RPC contracts", () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-schema-"));
  try {
    execFileSync("codex", [
      "app-server", "generate-json-schema", "--out", output, "--experimental",
    ], { stdio: "pipe" });

    const requests = fs.readFileSync(path.join(output, "ClientRequest.json"), "utf8");
    for (const method of [
      "thread/list",
      "fuzzyFileSearch",
      "thread/settings/update",
      "thread/approveGuardianDeniedAction",
      "mcpServerStatus/list",
      "thread/compact/start",
    ]) {
      assert.match(requests, new RegExp(`"${method.replaceAll("/", "\\/")}"`), method);
    }

    const threadList = JSON.parse(
      fs.readFileSync(path.join(output, "v2", "ThreadListParams.json"), "utf8"),
    );
    for (const field of ["cursor", "limit", "searchTerm", "sortKey", "sortDirection"]) {
      assert.ok(threadList.properties[field], `thread/list supports ${field}`);
    }

    const threadListResponse = JSON.parse(
      fs.readFileSync(path.join(output, "v2", "ThreadListResponse.json"), "utf8"),
    );
    const thread = threadListResponse.definitions.Thread;
    for (const field of ["id", "name", "preview", "createdAt", "updatedAt", "recencyAt"]) {
      assert.ok(thread.properties[field], `thread/list returns ${field}`);
    }
    assert.ok(thread.properties.gitInfo, "Thread returns gitInfo");

    const clientRequest = JSON.parse(requests);
    const userInputTitles = clientRequest.definitions.UserInput.oneOf.map((entry) => entry.title);
    assert.ok(userInputTitles.includes("TextUserInput"));
    assert.ok(userInputTitles.includes("ImageUserInput"));
    assert.ok(userInputTitles.includes("MentionUserInput"));

    const fuzzy = JSON.parse(fs.readFileSync(path.join(output, "FuzzyFileSearchParams.json"), "utf8"));
    assert.deepEqual(new Set(fuzzy.required), new Set(["query", "roots"]));

    const turn = threadListResponse.definitions.Turn;
    for (const field of ["startedAt", "completedAt", "durationMs", "status", "items"]) {
      assert.ok(turn.properties[field], `Turn returns ${field}`);
    }
    for (const field of ["aggregatedOutput", "cwd", "durationMs", "exitCode"]) {
      assert.match(JSON.stringify(threadListResponse.definitions.ThreadItem), new RegExp(`"${field}"`), `Command returns ${field}`);
    }

    const settings = JSON.parse(
      fs.readFileSync(path.join(output, "v2", "ThreadSettingsUpdateParams.json"), "utf8"),
    );
    assert.ok(settings.properties.personality);
    assert.ok(settings.properties.collaborationMode);

    const approval = JSON.parse(
      fs.readFileSync(path.join(output, "v2", "ThreadApproveGuardianDeniedActionParams.json"), "utf8"),
    );
    assert.deepEqual(new Set(approval.required), new Set(["event", "threadId"]));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
