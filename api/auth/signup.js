import { randomUUID } from "node:crypto";
import {
  authenticatedProfile,
  createAdminClient,
  createSessionClient,
  enforceRateLimit,
  getProfile,
  hashRecoveryCode,
  logBackendError,
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
  if (error) logBackendError("Saving recovery hash failed", error, [recoveryHash]);
  if (error || !data) throw new Error("The recovery code could not be secured to this account.");
}

function isUsernameConflict(error) {
  const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  return error?.code === "23505" && /profiles_username_key|profiles.*username|username.*unique/i.test(details);
}

async function usernameIsTaken(admin, username) {
  const { data, error } = await admin
    .from("profiles")
    .select("user_id")
    .eq("username", username)
    .maybeSingle();
  if (error) logBackendError("Username conflict recheck failed", error);
  return Boolean(data);
}

async function removeIncompleteAccount(admin, userId, client) {
  if (client) {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) logBackendError("Could not clear incomplete signup session", error);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) logBackendError("Could not remove incomplete signup account", error);
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
    if (lookupError) logBackendError("Username availability query failed", lookupError);
    if (lookupError) throw new Error("Username availability could not be checked.");
    if (existing) return sendJson(res, 409, { error: "That username is already taken. Please choose another." });
    const recoveryCode = newRecoveryCode();
    const recoveryCode = newRecoveryCode();
    if (email) {
      const client = createSessionClient(req, res);
      const redirectTo = `${req.headers.origin}/api/auth/callback?flow=signup`;
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: redirectTo }
      });
      if (error) {
        logBackendError("Supabase email signup failed", error, [email, password]);
        if (isUsernameConflict(error) || await usernameIsTaken(admin, username)) {
          return sendJson(res, 409, { error: "That username is already taken. Please choose another." });
        }
        if (/already registered|already exists/i.test(error.message)) {
          return sendJson(res, 200, { message: "If an account can be created, you’ll receive the next steps by email." });
        }
        return sendJson(res, 400, { error: "We couldn’t create the account. Check your details and try again." });
      }
      if (!data.user || !data.user.identities?.length) {
        return sendJson(res, 200, { message: "If an account can be created, you’ll receive the next steps by email." });
      }
      try {
        await saveRecoveryHash(admin, data.user.id, recoveryCode);
        const profileData = data.session ? await getProfile(client, data.user) : null;
        sendJson(res, 201, {
          recoveryCode,
          requiresEmailConfirmation: !data.session,
          profile: profileData
        });
      } catch (error) {
        await removeIncompleteAccount(admin, data.user.id, client);
        throw error;
      }
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
      if (createError) logBackendError("Supabase username signup failed", createError, [userEmail, password]);
      if (isUsernameConflict(createError) || await usernameIsTaken(admin, username)) {
        return sendJson(res, 409, { error: "That username is already taken. Please choose another." });
      }
      if (/already exists|already registered/i.test(createError?.message || "")) {
        return sendJson(res, 409, { error: "That username is already taken. Please choose another." });
      }
      throw new Error("The username account could not be created.");
    }

    let client;
    try {
      await saveRecoveryHash(admin, created.user.id, recoveryCode);
      client = createSessionClient(req, res);
      const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({
        email: userEmail,
        password
      });
      if (signInError) logBackendError("New username account sign-in failed", signInError, [userEmail, password]);
      if (signInError || !sessionData.user) throw new Error("The new account could not be signed in.");
      const result = await authenticatedProfile(client);
      if (!result) throw new Error("The new account session could not be verified.");
      sendJson(res, 201, { recoveryCode, requiresEmailConfirmation: false, profile: result.profile });
    } catch (error) {
      await removeIncompleteAccount(admin, created.user.id, client);
      throw error;
    }
  } catch (error) {
    sendError(res, error);
  }
}
