import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDeepSeekBody, normalizeChatMessages } from "./shared/chatRequest.mjs";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const API_URL = "https://api.deepseek.com/chat/completions";
const MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const ALLOW_BYOK = process.env.ALLOW_BYOK === "true" || !IS_PRODUCTION;
const SERVER_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const REQUEST_TIMEOUT_MS = 90_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const parsedRateLimit = Number(process.env.RATE_LIMIT_MAX || 30);
const RATE_LIMIT_MAX = Number.isFinite(parsedRateLimit) && parsedRateLimit > 0
  ? Math.floor(parsedRateLimit)
  : 30;
const parsedConcurrencyLimit = Number(process.env.MAX_CONCURRENT_REQUESTS || 6);
const MAX_CONCURRENT_REQUESTS = Number.isFinite(parsedConcurrencyLimit) && parsedConcurrencyLimit > 0
  ? Math.floor(parsedConcurrencyLimit)
  : 6;
const rateLimitBuckets = new Map();
let activeRequests = 0;

function isValidApiKey(value) {
  return value.length <= 512 && /^sk-[!-~]+$/.test(value);
}

const SYSTEM_PROMPT = (
  await readFile(path.join(ROOT_DIR, "shared", "persona.txt"), "utf8")
).trim();

const app = express();
app.disable("x-powered-by");
if (IS_PRODUCTION) app.set("env", "production");

const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy && trustProxy !== "false" && trustProxy !== "0") {
  if (trustProxy === "true") {
    throw new Error("TRUST_PROXY 必须是明确的代理跳数或 IP/CIDR 列表，不能使用 true");
  }
  app.set(
    "trust proxy",
    /^\d+$/.test(trustProxy)
      ? Number(trustProxy)
      : trustProxy.split(",").map((value) => value.trim()).filter(Boolean),
  );
}

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PRODUCTION) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; media-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'",
    );
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (publicOrigin.startsWith("https://")) {
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
  }
  next();
});

function parsePublicOrigin(value) {
  if (!value) return "";
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("PUBLIC_ORIGIN 必须是 http(s) 来源");
  }
  return url.origin;
}

const publicOrigin = parsePublicOrigin(process.env.PUBLIC_ORIGIN?.trim());
if (IS_PRODUCTION && ALLOW_BYOK && publicOrigin) {
  const url = new URL(publicOrigin);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !loopback) {
    throw new Error("生产环境远程 BYOK 必须使用 HTTPS");
  }
}
const allowedOrigins = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://[::1]:${PORT}`,
  ...(publicOrigin ? [publicOrigin] : []),
]);
if (HOST !== "0.0.0.0" && HOST !== "::") {
  const originHost = HOST.includes(":") && !HOST.startsWith("[") ? `[${HOST}]` : HOST;
  allowedOrigins.add(new URL(`http://${originHost}:${PORT}`).origin);
}
const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host.toLowerCase()));

app.use("/api", (request, response, next) => {
  response.setHeader("Cache-Control", "private, no-store");
  const host = String(request.get("host") || "").toLowerCase();
  const origin = request.get("origin");
  const fetchSite = request.get("sec-fetch-site");
  if (!allowedHosts.has(host)) {
    return response.status(403).json({ error: "请求主机不在允许列表中" });
  }
  if ((origin && !allowedOrigins.has(origin)) || fetchSite === "cross-site") {
    return response.status(403).json({ error: "拒绝跨站 API 请求" });
  }
  next();
});

app.get("/api/config", (_request, response) => {
  response.json({
    byokAllowed: ALLOW_BYOK,
    serverKeyConfigured: isValidApiKey(SERVER_API_KEY),
    models: [...MODELS],
  });
});

function providerStatusMessage(status, requestedMode) {
  if (status === 401) {
    return requestedMode === "byok" ? "API Key 无效或已失效" : "服务端 DeepSeek 凭据不可用";
  }
  if (status === 402) return "DeepSeek 账户余额不足";
  if (status === 429) return "请求太频繁，请稍后再试";
  return `DeepSeek 服务暂时不可用（${status}）`;
}

function providerError(status, body, requestedMode, apiKey) {
  if (requestedMode === "server") return providerStatusMessage(status, requestedMode);
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message || parsed?.message;
    if (typeof message === "string" && message.trim()) {
      return message
        .split(apiKey).join("sk-***")
        .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-***")
        .replace(/[\r\n\t]+/g, " ")
        .trim()
        .slice(0, 240);
    }
  } catch {
    // Provider returned a non-JSON error page.
  }
  return providerStatusMessage(status, requestedMode);
}

function waitForDrain(response, signal) {
  if (response.destroyed || signal.aborted) {
    return Promise.reject(new Error("response closed"));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", onDrain);
      response.off("close", onClose);
      response.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (callback, value) => {
      cleanup();
      callback(value);
    };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(reject, new Error("response closed"));
    const onError = (error) => finish(reject, error);
    const onAbort = () => finish(reject, new Error("request aborted"));
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function rateLimit(request, response, next) {
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const current = rateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    : current;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  response.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  response.setHeader("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX - bucket.count)));
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    response.setHeader("Retry-After", String(retryAfter));
    return response.status(429).json({ error: "本地代理请求太频繁，请稍后再试" });
  }
  next();
}

function limitConcurrency(_request, response, next) {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    response.setHeader("Retry-After", "3");
    return response.status(503).json({ error: "海底线路正忙，请稍后再试" });
  }
  activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests = Math.max(0, activeRequests - 1);
  };
  response.once("finish", release);
  response.once("close", release);
  next();
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS);
cleanupTimer.unref();

app.post("/api/chat", rateLimit, express.json({ limit: "768kb" }), limitConcurrency, async (request, response) => {
  const requestedMode = request.get("X-DS-Auth-Mode");
  if (requestedMode !== "byok" && requestedMode !== "server") {
    return response.status(400).json({ error: "连接模式无效" });
  }
  const byokKey = String(request.get("X-DeepSeek-API-Key") || "");
  if (requestedMode === "byok" && !ALLOW_BYOK) {
    return response.status(403).json({ error: "当前环境不允许浏览器提供 API Key" });
  }
  if (requestedMode === "byok" && !isValidApiKey(byokKey)) {
    return response.status(400).json({
      error: "API Key 格式无效：请只填写 Key 本体，且不要包含空格、换行或非 ASCII 字符",
    });
  }
  if (requestedMode === "server" && !isValidApiKey(SERVER_API_KEY)) {
    return response.status(503).json({
      error: "服务端 DeepSeek API Key 未配置或格式无效",
    });
  }
  const apiKey = requestedMode === "byok" ? byokKey : SERVER_API_KEY;

  const model = String(request.body?.model || "");
  if (!MODELS.has(model)) {
    return response.status(400).json({ error: "不支持的模型" });
  }

  const outputFormat = request.body?.outputFormat ?? "json_object";
  if (outputFormat !== "json_object" && outputFormat !== "text") {
    return response.status(400).json({ error: "回复格式无效" });
  }
  const messages = normalizeChatMessages(request.body?.messages);
  if (!messages.length || messages.at(-1)?.role !== "user") {
    return response.status(400).json({ error: "缺少有效的玩家消息" });
  }

  const requestedSessionId = String(request.get("X-DS-Session-ID") || "").trim();
  const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedSessionId)
    ? requestedSessionId
    : randomUUID();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  const abortUpstream = () => {
    if (!response.writableEnded) controller.abort("client disconnected");
  };
  response.on("close", abortUpstream);

  try {
    const upstream = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createDeepSeekBody({
        model,
        messages,
        systemPrompt: SYSTEM_PROMPT,
        sessionId,
        outputFormat,
      })),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const body = (await upstream.text()).slice(0, 4_000);
      return response.status(upstream.status).json({
        error: providerError(upstream.status, body, requestedMode, apiKey),
      });
    }
    if (!upstream.body) {
      return response.status(502).json({ error: "DeepSeek 没有返回响应流" });
    }
    if (!upstream.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      await upstream.body.cancel().catch(() => undefined);
      return response.status(502).json({ error: "DeepSeek 返回了非流式响应" });
    }

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) {
        await waitForDrain(response, controller.signal);
      }
    }
    response.end();
  } catch (error) {
    const timedOut = controller.signal.aborted && controller.signal.reason === "timeout";
    if (!response.headersSent) {
      response.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? "海底线路等待超时，请稍后再试"
          : "暂时无法连接 DeepSeek",
      });
    } else if (!response.destroyed && !response.writableEnded) {
      response.write(
        `data: ${JSON.stringify({ error: timedOut ? "timeout" : "upstream_error" })}\n\n`,
      );
      response.write("data: [DONE]\n\n");
      response.end();
    }
  } finally {
    clearTimeout(timeout);
    response.off("close", abortUpstream);
  }
});

app.use("/api", (error, _request, response, _next) => {
  if (response.headersSent) {
    if (!response.destroyed) response.end();
    return;
  }
  if (error?.type === "entity.too.large") {
    return response.status(413).json({ error: "请求内容过长，请开始新一轮后重试" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "请求 JSON 格式无效" });
  }
  return response.status(500).json({ error: "本地代理处理请求时发生错误" });
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found" });
});

if (IS_PRODUCTION) {
  app.use(express.static(path.join(ROOT_DIR, "dist"), {
    index: false,
    maxAge: "1h",
    setHeaders(response, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));
  app.use(async (request, response, next) => {
    if (request.method !== "GET" || !request.accepts("html")) return next();
    response.setHeader("Cache-Control", "no-cache");
    response.sendFile(path.join(ROOT_DIR, "dist", "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT_DIR,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  return response.status(500).json({ error: "服务器处理请求时发生错误" });
});

const httpServer = app.listen(PORT, HOST, () => {
  const mode = IS_PRODUCTION ? "production" : "development";
  const displayHost = HOST.includes(":") && !HOST.startsWith("[") ? `[${HOST}]` : HOST;
  console.log(`鲸语 ${mode} server: http://${displayHost}:${PORT}`);
});
httpServer.headersTimeout = 10_000;
httpServer.requestTimeout = 15_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxHeadersCount = 100;
