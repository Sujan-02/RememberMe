import {
  createAdminClient,
  enforceRateLimit,
  normalizeUsername,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson,
  validPassword,
  validUsername,
  verifyRecoveryCode
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const body = readJson(req);
    const username = normalizeUsername(body.username);
    if (!validUsername(username) || typeof body.recoveryCode !== "string" || !validPassword(body.password)) {
      return sendJson(res, 400, { error: "Username, recovery code, or new password is invalid." });
    }
    if (!await enforceRateLimit(req, res, "username-recovery", username, 5, 3600)) return;
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id, recovery_hash")
      .eq("username", username)
      .maybeSingle();
    if (profileError) throw new Error("Account recovery is unavailable.");
    if (!profile || !await verifyRecoveryCode(body.recoveryCode, profile.recovery_hash)) {
      return sendJson(res, 400, { error: "Username or recovery code is incorrect." });
    }
    const { error } = await admin.auth.admin.updateUserById(profile.user_id, { password: body.password });
    if (error) throw new Error("The password could not be updated. Please try again.");
    sendJson(res, 200, { recovered: true });
  } catch (error) {
    sendError(res, error);
  }
}
