import { createSessionClient, logBackendError } from "../_lib/server.js";

function redirect(res, path) {
  res.statusCode = 303;
  res.setHeader("Location", path);
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return redirect(res, "/?authError=1");
  }
  try {
    const client = createSessionClient(req, res);
    const code = typeof req.query?.code === "string" ? req.query.code : "";
    if (!code) return redirect(res, "/?authError=1");
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      logBackendError("Auth callback exchange failed", error, [code]);
      return redirect(res, "/?authError=1");
    }

    const flow = typeof req.query?.flow === "string" ? req.query.flow : "";
    if (flow === "recovery") return redirect(res, "/?reset=1");
    if (flow === "signup") return redirect(res, "/?auth=confirmed");
    redirect(res, "/");
  } catch (error) {
    logBackendError("Auth callback failed", error);
    redirect(res, "/?authError=1");
  }
}
