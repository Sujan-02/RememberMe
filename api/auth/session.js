import {
  authenticatedProfile,
  createSessionClient,
  requireMethod,
  sendError,
  sendJson
} from "../_lib/server.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  try {
    const client = createSessionClient(req, res);
    const result = await authenticatedProfile(client);
    if (!result) return sendJson(res, 401, { error: "Not signed in." });
    sendJson(res, 200, { profile: result.profile });
  } catch (error) {
    sendError(res, error);
  }
}
