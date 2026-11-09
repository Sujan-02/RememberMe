import { createSessionClient, logBackendError, requireMethod, requireSameOrigin, sendError, sendJson } from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const client = createSessionClient(req, res);
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      logBackendError("Sign-out failed", error);
      throw new Error("Your session could not be cleared. Please reload and try again.");
    }
    sendJson(res, 200, { signedOut: true });
  } catch (error) {
    sendError(res, error);
  }
}
