import {
  createSessionClient,
  enforceRateLimit,
  logBackendError,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson,
  validEmail
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const body = readJson(req);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!validEmail(email)) return sendJson(res, 400, { error: "Enter a valid email address." });
    if (!await enforceRateLimit(req, res, "email-recovery", email, 5, 3600)) return;
    const client = createSessionClient(req, res);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${req.headers.origin}/api/auth/callback?flow=recovery`
    });
    if (error) {
      logBackendError("Email recovery request failed", error, [email]);
      return sendJson(res, 503, { error: "Email recovery isn’t available right now. Please try again later." });
    }
    sendJson(res, 200, { message: "If an account uses that email, a secure reset link will arrive shortly." });
  } catch (error) {
    sendError(res, error);
  }
}
