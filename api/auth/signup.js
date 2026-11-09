import { randomUUID } from "node:crypto";
import {
  authenticatedProfile,
  createAdminClient,
  createSessionClient,
  enforceRateLimit,
  getProfile,
  hashRecoveryCode,
  newRecoveryCode,
  normalizeUsername,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson,
  validEmail,
  validPassword,
  validUsername
} from "../_lib/server.js";

async function saveRecoveryHash(admin, userId, recoveryCode) {
  const recoveryHash = await hashRecoveryCode(recoveryCode);
  const { data, error } = await admin
    .from("profiles")
    .update({ recovery_hash: recoveryHash })
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error || !data) throw new Error("The recovery code could not be secured to this account.");
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const body = readJson(req);
    const username = normalizeUsername(body.username);
    const email = body.email == null || body.email === "" ? "" : String(body.email).trim().toLowerCase();
    const password = body.password;
    if (!validUsername(username)) return sendJson(res, 400, { error: "Use 3–24 lowercase letters, numbers, or underscores for your username." });
    if (!validPassword(password)) return sendJson(res, 400, { error: "Your password must be between 10 and 128 characters." });
    if (email && !validEmail(email)) return sendJson(res, 400, { error: "Enter a valid email address, or leave the field blank." });
    if (!await enforceRateLimit(req, res, "signup", username, 5, 3600)) return;

    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin
      .from("profiles")
      .select("user_id")
      .eq("username", username)
      .maybeSingle();
    if (lookupError) throw new Error("Username availability could not be checked.");
    if (existing) return sendJson(res, 409, { error: "That username is already taken. Please choose another." });

    const recoveryCode = newRecoveryCode();
    const recoveryHash = await hashRecoveryCode(recoveryCode);
    if (email) {
      const client = createSessionClient(req, res);
      const redirectTo = `${req.headers.origin}/api/auth/callback?flow=signup`;
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: redirectTo }
      });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          return sendJson(res, 200, { message: "If an account can be created, you’ll receive the next steps by email." });
        }
        return sendJson(res, 400, { error: "We couldn’t create the account. Check your details and try again." });
      }
      if (!data.user || !data.user.identities?.length) {
        return sendJson(res, 200, { message: "If an account can be created, you’ll receive the next steps by email." });
      }
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("user_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (profileError || !profile) throw new Error("The new account profile could not be prepared.");
      const { error: saveError } = await admin
        .from("profiles")
        .update({ recovery_hash: recoveryHash })
        .eq("user_id", data.user.id);
      if (saveError) throw new Error("The recovery code could not be secured to this account.");

      const profileData = data.session ? await getProfile(client, data.user) : null;
      sendJson(res, 201, {
        recoveryCode,
        requiresEmailConfirmation: !data.session,
        profile: profileData
      });
      return;
    }

    const userEmail = `account.${randomUUID()}@accounts.rememberme.invalid`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: userEmail,
      password,
      email_confirm: true,
      user_metadata: { username }
    });
    if (createError || !created.user) {
      if (/already exists|already registered/i.test(createError?.message || "")) {
        return sendJson(res, 409, { error: "That username is already taken. Please choose another." });
      }
      throw new Error("The username account could not be created.");
    }

    try {
      await saveRecoveryHash(admin, created.user.id, recoveryCode);
      const client = createSessionClient(req, res);
      const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({
        email: userEmail,
        password
      });
      if (signInError || !sessionData.user) throw new Error("The new account could not be signed in.");
      const result = await authenticatedProfile(client);
      if (!result) throw new Error("The new account session could not be verified.");
      sendJson(res, 201, { recoveryCode, requiresEmailConfirmation: false, profile: result.profile });
    } catch (error) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
      if (deleteError) console.error("Could not clean up incomplete account:", deleteError.message);
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
}
