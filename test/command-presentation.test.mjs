import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCommand,
  commandEnvironmentLabel,
  countOutputLines,
  normalizeToolStatus,
  presentCommand,
  summarizeCommand,
  tailOutputLines,
  unwrapShellCommand,
} from "../public/command-presentation.js";

test("unwraps supported shell wrappers without evaluating command text", () => {
  assert.equal(unwrapShellCommand(`/bin/bash -lc "rg -n 'detector.*json' ours angle_detector"`), `rg -n 'detector.*json' ours angle_detector`);
  assert.equal(unwrapShellCommand(`sh -c 'cat "task.json"'`), `cat "task.json"`);
  assert.equal(unwrapShellCommand(`wsl.exe bash -lc "sed -n '1,360p' selector.py"`), `sed -n '1,360p' selector.py`);
  assert.equal(unwrapShellCommand(`env FOO=bar timeout 30 /usr/bin/time -v bash -lc "cat task.json"`), "cat task.json");
  const heredoc = unwrapShellCommand(`bash -lc "cat <<'EOF'\n${"do not execute"}\nEOF"`);
  assert.match(heredoc, /^bash -lc/);
  assert.doesNotMatch(heredoc, /do not execute/);
  assert.equal(unwrapShellCommand(`bash -lc "echo 'a b' && printf '%s' \\"quoted\\""`), `echo 'a b' && printf '%s' "quoted"`);
});
test("summarizes search, read, test, and fallback commands", () => {
  assert.equal(summarizeCommand(`rg -n "detector.*json" ours angle_detector`), `搜索 “detector.*json” · ours、angle_detector`);
  assert.equal(summarizeCommand(`nl -ba selector.py | sed -n '1,360p'`), `查看 selector.py 第 1–360 行`);
  assert.equal(summarizeCommand("tail -n 100 output.log"), "查看 output.log 末尾 100 行");
  assert.equal(summarizeCommand("npm test"), "运行测试");
  assert.ok(summarizeCommand("some-unknown-command --with a very long argument", { maxLength: 40 }).length <= 40);
  const model = presentCommand({ id: "c1", command: "/bin/bash -lc 'cat task.json'", status: "completed" });
  assert.equal(model.rawCommand, "/bin/bash -lc 'cat task.json'");
  assert.equal(model.displayCommand, "cat task.json");
  assert.equal(model.environmentLabel, "Shell");
  assert.equal(model.normalizedStatus.kind, "completed");
});

test("classifies read-only, compound, write, test, and Python commands", () => {
  assert.equal(classifyCommand("rg --files src | sort").groupable, true);
  assert.equal(classifyCommand("git status --short").groupable, true);
  assert.equal(classifyCommand("find . -type f").groupable, true);
  assert.equal(classifyCommand("rg x . > result.txt").readonly, false);
  assert.equal(classifyCommand("rg x . && rm result.txt").groupable, false);
  assert.equal(classifyCommand("git commit -am done").groupable, false);
  assert.equal(classifyCommand("pytest -q").groupable, false);
  assert.equal(classifyCommand(`python -c "from pathlib import Path; print(Path('a').read_text())"`).groupable, true);
  assert.equal(classifyCommand(`python -c "from pathlib import Path; Path('a').write_text('x')"`).groupable, false);
  assert.equal(commandEnvironmentLabel("wsl.exe bash -lc 'pwd'"), "WSL");
  assert.equal(commandEnvironmentLabel("python3 script.py"), "Python");
  assert.equal(commandEnvironmentLabel("npm run check"), "Node");
});

test("normalizes tool status and keeps output tail bounded", () => {
  assert.deepEqual(normalizeToolStatus("in_progress"), { kind: "running", label: "Running", isActive: true, isFailure: false });
  assert.equal(normalizeToolStatus("error").isFailure, true);
  assert.equal(normalizeToolStatus("canceled").kind, "cancelled");
  assert.equal(countOutputLines("a\nb\n"), 2);
  assert.deepEqual(tailOutputLines("a\nb\nc\n", 2), ["b", "c"]);
});
