import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { parse, serialize } from "cookie";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getConfig() {
  const config = {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    rateLimitSecret: process.env.RATE_LIMIT_SECRET
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Authentication backend is not configured. Set ${missing.join(", ")} in the server environment.`);
  }
  if (Buffer.byteLength(config.rateLimitSecret, "utf8") < 32) {
    throw new Error("Authentication backend is not configured. RATE_LIMIT_SECRET must contain at least 32 bytes.");
  }
  return config;
}

export function createSessionClient(req, res) {
  const { url, anonKey } = getConfig();
  const cookies = parse(req.headers.cookie || "");
  const cookieOptions = {
    name: "rememberme-auth",
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7
  };
  return createServerClient(url, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, flowType: "pkce" },
    cookies: {
      getAll() {
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        const existing = res.getHeader("Set-Cookie");
        const outgoing = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
        for (const { name, value, options } of cookiesToSet) {
          outgoing.push(serialize(name, value, { ...cookieOptions, ...options, httpOnly: true }));
        }
        res.setHeader("Set-Cookie", outgoing);
      }
    }
  });
}

export function createAdminClient() {
  const { url, serviceRoleKey } = getConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}

export function logBackendError(context, error, sensitiveValues = []) {
  const source = error && typeof error === "object" ? error : {};
  let message = typeof source.message === "string"
    ? source.message
    : error instanceof Error ? error.message : "Unknown backend error.";
  for (const value of sensitiveValues) {
    if (typeof value === "string" && value) message = message.split(value).join("[redacted]");
  }
  console.error(`RememberMe ${context}:`, {
    code: typeof source.code === "string" ? source.code : undefined,
    status: Number.isFinite(source.status) ? source.status : undefined,
    message: message.replace(/[\r\n]+/g, " ").slice(0, 500)
  });
}

export function sendError(res, error) {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  logBackendError("API request failed", error);
  const status = error instanceof RequestError
    ? error.status
    : /not configured|rate limiter is unavailable/i.test(message) ? 503 : 500;
  sendJson(res, status, {
    error: status === 400 ? message : status === 503 ? message : "We couldn’t complete that request. Please try again."
  });
}

export function requireMethod(req, res, method) {
  if (req.method !== method) {
    res.setHeader("Allow", method);
    sendJson(res, 405, { error: "Method not allowed." });
    return false;
  }
  return true;
}

export function requireSameOrigin(req, res) {
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (!origin || !host || origin !== `${proto}://${host}`) {
    sendJson(res, 403, { error: "This request could not be verified. Reload the page and try again." });
    return false;
  }
  return true;
}

export function readJson(req) {
  const length = Number(req.headers["content-length"] || 0);
  if (length > 16000) throw new RequestError(413, "Request is too large.");
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      throw new RequestError(400, "Request body must be valid JSON.");
    }
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  return req.body;
}

export function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validUsername(value) {
  return /^[a-z0-9_]{3,24}$/.test(value);
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  return forwarded.split(",").map(value => value.trim()).filter(Boolean).pop() || "unknown";
}

export async function enforceRateLimit(req, res, action, subject, limit = 10, windowSeconds = 900) {
  const { rateLimitSecret } = getConfig();
  const admin = createAdminClient();
  const dimensions = [`ip:${requestIp(req)}`];
  if (subject) dimensions.push(`subject:${String(subject).toLowerCase()}`);
  for (const dimension of dimensions) {
    const bucket = createHmac("sha256", rateLimitSecret).update(`${action}:${dimension}`).digest("hex");
    const { data, error } = await admin.rpc("consume_auth_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    if (error) {
      logBackendError("Rate-limit RPC failed", error);
      throw new Error(`Rate limiter is unavailable: ${error.message}`);
    }
    if (data !== true) {
      sendJson(res, 429, { error: "Too many attempts. Please wait a little while and try again." });
      return false;
    }
  }
  return true;
}

export async function getProfile(client, user) {
  const { data, error } = await client
    .from("profiles")
    .select("username, display_name, has_email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) logBackendError("Profile query failed", error);
  if (error || !data) throw new Error("Your account profile could not be loaded.");
  return {
    username: data.username,
    displayName: data.display_name || "",
    hasEmail: Boolean(data.has_email)
  };
}

export async function authenticatedProfile(client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { user: data.user, profile: await getProfile(client, data.user) };
}

export function newRecoveryCode() {
  return randomBytes(16).toString("hex").toUpperCase().match(/.{1,4}/g).join("-");
}

export async function hashRecoveryCode(code) {
  const salt = randomBytes(16);
  const digest = await scrypt(code.replace(/[^a-f0-9]/gi, "").toLowerCase(), salt, 32);
  return `${salt.toString("hex")}:${digest.toString("hex")}`;
}

export async function verifyRecoveryCode(code, storedHash) {
  if (typeof code !== "string" || typeof storedHash !== "string") return false;
  const [saltHex, digestHex] = storedHash.split(":");
  if (!/^[a-f0-9]{32}$/i.test(saltHex || "") || !/^[a-f0-9]{64}$/i.test(digestHex || "")) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(digestHex, "hex");
  const actual = await scrypt(code.replace(/[^a-f0-9]/gi, "").toLowerCase(), salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function internalEmail(userId) {
  return `account.${userId}@accounts.rememberme.invalid`;
}
