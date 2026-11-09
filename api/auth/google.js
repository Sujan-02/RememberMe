import { createSessionClient, requireMethod, requireSameOrigin, sendError, sendJson } from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST") || !requireSameOrigin(req, res)) return;
  try {
    const client = createSessionClient(req, res);
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${req.headers.origin}/api/auth/callback?flow=oauth` }
    });
    if (error || !data.url) {
      return sendJson(res, 503, { error: "Google sign-in isn’t configured yet. Please try email or username sign-in." });
    }
    sendJson(res, 200, { url: data.url });
  } catch (error) {
    sendError(res, error);
  }
}
