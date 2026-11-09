import {
  createAdminClient,
  enforceRateLimit,
  normalizeUsername,
  requireMethod,
  sendError,
  sendJson,
  validUsername
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  try {
    const username = normalizeUsername(req.query?.username);
    if (!validUsername(username)) return sendJson(res, 200, { available: false });
    if (!await enforceRateLimit(req, res, "username-check", "", 40, 3600)) return;
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("user_id")
      .eq("username", username)
      .maybeSingle();
    if (error) throw new Error("Username availability could not be checked.");
    sendJson(res, 200, { available: !data });
  } catch (error) {
    sendError(res, error);
  }
}
