import {
  createSessionClient,
  logBackendError,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson,
  validPassword
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const body = readJson(req);
    if (!validPassword(body.password)) return sendJson(res, 400, { error: "Your password must be between 10 and 128 characters." });
    const client = createSessionClient(req, res);
    const { data, error: userError } = await client.auth.getUser();
    if (userError || !data.user) {
      if (userError) logBackendError("Email recovery session verification failed", userError);
      return sendJson(res, 401, { error: "Your reset session expired. Request a new reset link." });
    }
    const { error } = await client.auth.updateUser({ password: body.password });
    if (error) {
      logBackendError("Email recovery password update failed", error, [body.password]);
      throw new Error("The password could not be updated. Please try again.");
    }
    sendJson(res, 200, { updated: true });
  } catch (error) {
    sendError(res, error);
  }
}
