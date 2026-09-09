import { request as httpRequest, Server } from "node:http";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const FAKE_API_KEY = "sk-proxy-smoke-fake";
const FIRST_USER_MESSAGE = "first-turn";
const SECOND_USER_MESSAGE = "second-turn";
const ASSISTANT_SCENE = JSON.stringify({
  mood: "neutral",
  segments: [{ kind: "dialogue", text: "ack", mood: "neutral" }],
  suggestions: [],
});
const SUCCESS_SSE = [
  'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":null}]}',
  "",
  'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
  "",
  "data: [DONE]",
  "",
].join("\n");

class SmokeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "SmokeFailure";
  }
}

function check(condition, code) {
  if (!condition) throw new SmokeFailure(code);
}

function getFetchUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function postChat(port, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/chat",
      method: "POST",
      agent: false,
      headers: {
        Host: "127.0.0.1:0",
        Connection: "close",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-DS-Auth-Mode": "byok",
        "X-DeepSeek-API-Key": FAKE_API_KEY,
        "X-DS-Session-ID": SESSION_ID,
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBody += chunk;
      });
      response.once("error", () => reject(new SmokeFailure("downstream-response-error")));
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        contentType: String(response.headers["content-type"] ?? ""),
        body: responseBody,
      }));
    });
    request.once("error", () => reject(new SmokeFailure("downstream-request-error")));
    request.end(body);
  });
}

function waitUntilListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(reject, new SmokeFailure("listen-timeout")), 2_000);
    const cleanup = () => {
      clearTimeout(timeout);
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const finish = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onListening = () => finish(resolve);
    const onError = () => finish(reject, new SmokeFailure("listen-error"));
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, 1_000);
    server.close(finish);
    server.closeIdleConnections?.();
  });
}

function checkSuccessfulProxyResponse(response, code) {
  check(response.status === 200, `${code}-status`);
  check(response.contentType.toLowerCase().includes("text/event-stream"), `${code}-content-type`);
  check(response.body.includes("data: [DONE]"), `${code}-done`);
}

function checkOfficialBody(body, outputFormat, expectedRoles) {
  check(body && typeof body === "object" && !Array.isArray(body), "upstream-body-object");
  check(
    Object.keys(body).sort().join(",")
      === "max_tokens,messages,model,response_format,stream,thinking,user_id",
    "upstream-body-fields",
  );
  check(body.model === MODEL, "upstream-model");
  check(body.thinking?.type === "disabled", "upstream-thinking");
  check(body.response_format?.type === outputFormat, "upstream-output-format");
  check(body.stream === true, "upstream-stream");
  check(body.max_tokens === 1_600, "upstream-max-tokens");
  check(
    body.user_id === `jingyu_${SESSION_ID.replaceAll("-", "")}`,
    "upstream-user-id",
  );
  check(Array.isArray(body.messages), "upstream-messages-array");
  check(body.messages.map((message) => message.role).join(",") === expectedRoles.join(","), "upstream-roles");
  check(
    typeof body.messages[0]?.content === "string" && body.messages[0].content.includes("JSON"),
    "upstream-system-prompt",
  );
}

const originalFetch = globalThis.fetch;
const originalListen = Server.prototype.listen;
const originalConsoleLog = console.log;
const upstreamBodies = [];
let upstreamCalls = 0;
let capturedServer;
let report;
let failure;

const watchdog = setTimeout(() => {
  capturedServer?.closeAllConnections?.();
  capturedServer?.close?.();
  process.stderr.write("proxy-smoke:child-timeout\n");
  process.exit(1);
}, 10_000);
watchdog.unref();

try {
  console.log = () => {};
  globalThis.fetch = async (input, init = {}) => {
    upstreamCalls += 1;
    check(getFetchUrl(input) === DEEPSEEK_URL, "unexpected-upstream-url");
    check(init.method === "POST", "upstream-method");

    const headers = new Headers(init.headers);
    check(headers.get("authorization") === `Bearer ${FAKE_API_KEY}`, "upstream-authorization");
    check(headers.get("content-type") === "application/json", "upstream-content-type");
    check(typeof init.body === "string", "upstream-body-type");

    let parsedBody;
    try {
      parsedBody = JSON.parse(init.body);
    } catch {
      throw new SmokeFailure("upstream-body-json");
    }
    upstreamBodies.push(parsedBody);

    if (upstreamCalls === 4) {
      return new Response(JSON.stringify({ error: { message: "Authentication failed" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(SUCCESS_SSE, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  Server.prototype.listen = function patchedListen(...args) {
    capturedServer = this;
    return Reflect.apply(originalListen, this, args);
  };

  try {
    await import(new URL("../../../server.mjs", import.meta.url));
  } finally {
    Server.prototype.listen = originalListen;
  }

  check(capturedServer, "server-not-captured");
  await waitUntilListening(capturedServer);
  const address = capturedServer.address();
  check(address && typeof address === "object" && address.port > 0, "ephemeral-port");
  const port = address.port;

  const firstResponse = await postChat(port, {
    model: MODEL,
    messages: [{ role: "user", content: FIRST_USER_MESSAGE }],
  });
  checkSuccessfulProxyResponse(firstResponse, "first-round");

  const secondRoundMessages = [
    { role: "user", content: FIRST_USER_MESSAGE },
    { role: "assistant", content: ASSISTANT_SCENE },
    { role: "user", content: SECOND_USER_MESSAGE },
  ];
  const secondResponse = await postChat(port, {
    model: MODEL,
    messages: secondRoundMessages,
    outputFormat: "json_object",
  });
  checkSuccessfulProxyResponse(secondResponse, "second-round");

  const retryResponse = await postChat(port, {
    model: MODEL,
    messages: secondRoundMessages,
    outputFormat: "text",
  });
  checkSuccessfulProxyResponse(retryResponse, "text-retry");

  check(upstreamBodies.length === 3, "success-upstream-count");
  checkOfficialBody(upstreamBodies[0], "json_object", ["system", "user"]);
  check(upstreamBodies[0].messages[1]?.content === FIRST_USER_MESSAGE, "first-user-content");
  for (const [index, outputFormat] of [[1, "json_object"], [2, "text"]]) {
    const body = upstreamBodies[index];
    checkOfficialBody(body, outputFormat, ["system", "user", "assistant", "user"]);
    check(body.messages[1]?.content === FIRST_USER_MESSAGE, "history-first-user-content");
    check(body.messages[2]?.content === ASSISTANT_SCENE, "history-assistant-json");
    check(body.messages[3]?.content === SECOND_USER_MESSAGE, "history-second-user-content");
  }

  const callsBeforeInvalidFormat = upstreamCalls;
  const invalidResponse = await postChat(port, {
    model: MODEL,
    messages: [{ role: "user", content: FIRST_USER_MESSAGE }],
    outputFormat: "yaml",
  });
  check(invalidResponse.status === 400, "invalid-format-status");
  check(upstreamCalls === callsBeforeInvalidFormat, "invalid-format-fetch");

  const callsBeforeUnauthorized = upstreamCalls;
  const unauthorizedResponse = await postChat(port, {
    model: MODEL,
    messages: [{ role: "user", content: FIRST_USER_MESSAGE }],
  });
  check(unauthorizedResponse.status === 401, "unauthorized-status");
  check(upstreamCalls === callsBeforeUnauthorized + 1, "unauthorized-retry");
  check(upstreamBodies.length === 4, "unauthorized-upstream-count");
  checkOfficialBody(upstreamBodies[3], "json_object", ["system", "user"]);

  report = {
    ok: true,
    fetchCalls: upstreamCalls,
    successfulRequests: 3,
    invalidStatus: invalidResponse.status,
    unauthorizedStatus: unauthorizedResponse.status,
  };
} catch (error) {
  failure = error;
} finally {
  Server.prototype.listen = originalListen;
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
  await closeServer(capturedServer);
  clearTimeout(watchdog);
}

if (failure) {
  const code = failure instanceof SmokeFailure ? failure.message : "unexpected-error";
  process.stderr.write(`proxy-smoke:${code}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
