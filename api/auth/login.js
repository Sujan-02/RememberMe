import {
  authenticatedProfile,
  createAdminClient,
  createSessionClient,
  enforceRateLimit,
  logBackendError,
  normalizeUsername,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson,
  validUsername
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const body = readJson(req);
    const mode = body.mode;
    const username = normalizeUsername(body.username);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    if (!["email", "username"].includes(mode) || typeof password !== "string" || password.length > 128) {
      return sendJson(res, 400, { error: "Enter a valid sign-in and password." });
    }
    if (mode === "username" && !validUsername(username)) {
      return sendJson(res, 400, { error: "Username or password is incorrect." });
    }
    if (mode === "email" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return sendJson(res, 400, { error: "Email or password is incorrect." });
    }
    if (!await enforceRateLimit(req, res, "login", mode === "email" ? email : username, 10, 900)) return;

    let signInEmail = email;
    if (mode === "username") {
      const admin = createAdminClient();
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("user_id")
        .eq("username", username)
        .maybeSingle();
      if (profileError) logBackendError("Username sign-in lookup failed", profileError);
      if (profileError) throw new Error("Username lookup is unavailable.");
      if (!profile) return sendJson(res, 401, { error: "Username or password is incorrect." });
      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
      if (userError || !userResult.user?.email) {
        if (userError) logBackendError("Username account lookup failed", userError);
        return sendJson(res, 401, { error: "Username or password is incorrect." });
      }
      signInEmail = userResult.user.email;
    }

    const client = createSessionClient(req, res);
    const { data, error } = await client.auth.signInWithPassword({ email: signInEmail, password });
    if (error || !data.user) {
      if (error) logBackendError("Password sign-in rejected", error, [email, signInEmail, password]);
      return sendJson(res, 401, { error: "Sign-in details are incorrect." });
    }
    const result = await authenticatedProfile(client);
    if (!result) return sendJson(res, 401, { error: "Your session could not be verified. Please sign in again." });
    sendJson(res, 200, { profile: result.profile });
  } catch (error) {
    sendError(res, error);
  }
}
