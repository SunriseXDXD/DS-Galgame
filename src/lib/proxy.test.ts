/// <reference types="node" />

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FixtureReport {
  ok: boolean;
  fetchCalls: number;
  successfulRequests: number;
  invalidStatus: number;
  unauthorizedStatus: number;
}

interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const fixturePath = fileURLToPath(new URL("./fixtures/proxy-smoke.mjs", import.meta.url));
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

function runProxyFixture(): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath], {
      cwd: projectRoot,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        NODE_ENV: "production",
        PORT: "0",
        HOST: "127.0.0.1",
        ALLOW_BYOK: "true",
        DEEPSEEK_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 12_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-20_000);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

describe("server /api/chat proxy", () => {
  it("preserves the official request contract across history and the text fallback", async () => {
    const result = await runProxyFixture();

    expect(result.timedOut).toBe(false);
    if (result.code !== 0) {
      throw new Error(`proxy fixture failed (${result.code ?? result.signal ?? "unknown"}): ${result.stderr.trim()}`);
    }

    const report = JSON.parse(result.stdout.trim()) as FixtureReport;
    expect(report).toEqual({
      ok: true,
      fetchCalls: 4,
      successfulRequests: 3,
      invalidStatus: 400,
      unauthorizedStatus: 401,
    });
  }, 15_000);
});
