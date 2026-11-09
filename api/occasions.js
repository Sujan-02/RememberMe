import {
  authenticatedProfile,
  createSessionClient,
  readJson,
  requireMethod,
  requireSameOrigin,
  sendError,
  sendJson
} from "./_lib/server.js";

const CATEGORIES = new Set(["Birthday", "Anniversary", "College event", "Festival", "Meeting", "Personal", "Other"]);
const OCCASION_FIELDS = "id, name, date, category, notes, repeat_yearly";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateOccasion(value, imported = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Each occasion must be an object." };
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const date = typeof value.date === "string" ? value.date : "";
  const category = value.category;
  const notes = typeof value.notes === "string" ? value.notes.trim() : "";
  if (!name || name.length > 60) return { error: "Occasion names must be between 1 and 60 characters." };
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: "Enter a valid occasion date." };
  }
  if (!CATEGORIES.has(category)) return { error: "Choose a valid occasion category." };
  if (notes.length > 240) return { error: "Occasion notes must be 240 characters or fewer." };
  if (typeof value.repeat !== "boolean") return { error: "Choose whether this occasion repeats yearly." };
  const row = {
    name,
    date,
    category,
    notes,
    repeat_yearly: value.repeat
  };
  if (imported) {
    const legacyId = String(value.legacyId ?? "");
    if (!legacyId || legacyId.length > 100) return { error: "A saved occasion could not be identified for import." };
    row.legacy_id = legacyId;
  }
  return { row };
}

function formatOccasion(row) {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    category: row.category,
    notes: row.notes || "",
    repeat: Boolean(row.repeat_yearly)
  };
}

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  if (req.method !== "GET" && !requireSameOrigin(req, res)) return;
  try {
    const client = createSessionClient(req, res);
    const auth = await authenticatedProfile(client);
    if (!auth) return sendJson(res, 401, { error: "Your session has expired. Please log in again." });

    if (req.method === "GET") {
      const { data, error } = await client
        .from("occasions")
        .select(OCCASION_FIELDS)
        .order("date", { ascending: true });
      if (error) throw new Error("Your occasions could not be loaded.");
      return sendJson(res, 200, { occasions: data.map(formatOccasion) });
    }

    const body = readJson(req);
    if (req.method === "POST" && Array.isArray(body.items)) {
      if (body.items.length > 500) return sendJson(res, 400, { error: "Import up to 500 occasions at a time." });
      const validated = body.items.map(item => validateOccasion(item, true));
      const invalid = validated.find(item => item.error);
      if (invalid) return sendJson(res, 400, { error: invalid.error });
      if (!validated.length) return sendJson(res, 200, { imported: 0 });
      const rows = validated.map(item => ({ ...item.row, user_id: auth.user.id }));
      const { error } = await client
        .from("occasions")
        .upsert(rows, { onConflict: "user_id,legacy_id", ignoreDuplicates: true });
      if (error) throw new Error("Saved occasions could not be imported.");
      return sendJson(res, 200, { imported: rows.length });
    }

    if (req.method === "POST") {
      const validated = validateOccasion(body);
      if (validated.error) return sendJson(res, 400, { error: validated.error });
      const { data, error } = await client
        .from("occasions")
        .insert({ ...validated.row, user_id: auth.user.id })
        .select(OCCASION_FIELDS)
        .single();
      if (error) throw new Error("The occasion could not be saved.");
      return sendJson(res, 201, { occasion: formatOccasion(data) });
    }

    if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
      return sendJson(res, 400, { error: "A valid occasion ID is required." });
    }
    if (req.method === "PATCH") {
      const validated = validateOccasion(body);
      if (validated.error) return sendJson(res, 400, { error: validated.error });
      const { data, error } = await client
        .from("occasions")
        .update(validated.row)
        .eq("id", body.id)
        .eq("user_id", auth.user.id)
        .select(OCCASION_FIELDS)
        .maybeSingle();
      if (error) throw new Error("The occasion could not be updated.");
      if (!data) return sendJson(res, 404, { error: "That occasion was not found." });
      return sendJson(res, 200, { occasion: formatOccasion(data) });
    }

    const { data, error } = await client
      .from("occasions")
      .delete()
      .eq("id", body.id)
      .eq("user_id", auth.user.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("The occasion could not be deleted.");
    if (!data) return sendJson(res, 404, { error: "That occasion was not found." });
    sendJson(res, 200, { deleted: true });
  } catch (error) {
    sendError(res, error);
  }
}
