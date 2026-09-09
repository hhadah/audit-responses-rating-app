import { getStore } from "@netlify/blobs";

import {
  buildStoredAnswer,
  countResponses,
  legacyPairsToBundle,
  normalizeBundle,
  responsesCsv,
  responsesJson,
} from "./lib.mjs";

const LEGACY_PASSCODE = (process.env.PASSCODE || "").trim();
const PARTICIPANT_PASSCODE = (process.env.PARTICIPANT_PASSCODE || LEGACY_PASSCODE).trim();
const ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || LEGACY_PASSCODE).trim();

const configStore = () => getStore({ name: "config", consistency: "strong" });
const responseStore = () => getStore({ name: "responses", consistency: "strong" });

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return "";
  }
}

function participantCredential(request) {
  return (
    request.headers.get("x-passcode")?.trim() ||
    cookieValue(request, "participant_passcode") ||
    cookieValue(request, "passcode")
  );
}

function adminCredential(request) {
  const explicit =
    request.headers.get("x-admin-passcode")?.trim() || cookieValue(request, "admin_passcode");
  if (explicit) return explicit;
  if (ADMIN_PASSCODE === LEGACY_PASSCODE) {
    return request.headers.get("x-passcode")?.trim() || cookieValue(request, "passcode");
  }
  return "";
}

function participantAuthorized(request) {
  return Boolean(PARTICIPANT_PASSCODE) && participantCredential(request) === PARTICIPANT_PASSCODE;
}

function adminAuthorized(request) {
  return Boolean(ADMIN_PASSCODE) && adminCredential(request) === ADMIN_PASSCODE;
}

async function loadBundle() {
  const store = configStore();
  const storedBundle = await store.get("bundle", { type: "json" });
  if (storedBundle) return normalizeBundle(storedBundle);
  const legacyPairs = await store.get("pairs", { type: "json" });
  return legacyPairs ? legacyPairsToBundle(legacyPairs) : null;
}

async function loadAllResponses() {
  const store = responseStore();
  const { blobs } = await store.list();
  const responses = {};
  for (const blob of blobs) {
    let participantId;
    try {
      participantId = decodeURIComponent(blob.key);
    } catch {
      participantId = blob.key;
    }
    responses[participantId] = (await store.get(blob.key, { type: "json" })) || {};
  }
  return responses;
}

async function saveResponse(request) {
  const bundle = await loadBundle();
  if (!bundle) return json({ error: "study data has not been uploaded" }, 409);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "request body must be valid JSON" }, 400);
  }

  let normalized;
  try {
    normalized = buildStoredAnswer(payload, bundle);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const store = responseStore();
  const key = encodeURIComponent(normalized.participantId);
  const answers = (await store.get(key, { type: "json" })) || {};
  answers[normalized.itemId] = normalized.answer;
  await store.setJSON(key, answers);
  return json({ ok: true, answered: Object.keys(answers).length });
}

async function uploadStudy(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "uploaded file must contain valid JSON" }, 400);
  }

  let bundle;
  try {
    bundle = Array.isArray(payload) ? legacyPairsToBundle(payload) : normalizeBundle(payload);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const existingResponses = await loadAllResponses();
  if (
    countResponses(existingResponses) > 0 &&
    request.headers.get("x-confirm-study-replacement") !== "replace-study"
  ) {
    return json(
      {
        error:
          "responses already exist; confirm that you backed them up before replacing the study",
      },
      409,
    );
  }

  await configStore().setJSON("bundle", bundle);
  return json({
    ok: true,
    count: bundle.items.length,
    study_id: bundle.study.id,
    title: bundle.study.title,
    compatibility_mode: bundle.compatibility_mode,
  });
}

async function responseStatus() {
  const bundle = await loadBundle();
  const responses = await loadAllResponses();
  return json({
    ready: Boolean(bundle),
    study_id: bundle?.study.id ?? null,
    title: bundle?.study.title ?? null,
    item_count: bundle?.items.length ?? 0,
    participant_count: Object.keys(responses).length,
    response_count: countResponses(responses),
    compatibility_mode: bundle?.compatibility_mode ?? null,
  });
}

async function downloadCsv() {
  const bundle = await loadBundle();
  if (!bundle) return json({ error: "study data has not been uploaded" }, 409);
  const responses = await loadAllResponses();
  return new Response(responsesCsv(responses, bundle), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="responses.csv"',
      "Cache-Control": "no-store",
    },
  });
}

async function downloadJson() {
  const bundle = await loadBundle();
  if (!bundle) return json({ error: "study data has not been uploaded" }, 409);
  const responses = await loadAllResponses();
  return new Response(responsesJson(responses, bundle), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="responses-backup.json"',
      "Cache-Control": "no-store",
    },
  });
}

async function route(request) {
  const path = new URL(request.url).pathname;

  if (path === "/api/config") {
    const bundle = await loadBundle();
    return json({
      auth_required: true,
      ready: Boolean(PARTICIPANT_PASSCODE) && Boolean(bundle),
      study_title: bundle?.study.title ?? null,
    });
  }

  if (path === "/api/login" && request.method === "POST") {
    if (!PARTICIPANT_PASSCODE) {
      return json({ error: "PARTICIPANT_PASSCODE is not configured" }, 503);
    }
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "request body must be valid JSON" }, 400);
    }
    if ((payload.passcode || "").trim() !== PARTICIPANT_PASSCODE) {
      return json({ ok: false }, 401);
    }
    return json({ ok: true });
  }

  if (path.startsWith("/admin/")) {
    if (!ADMIN_PASSCODE) return json({ error: "ADMIN_PASSCODE is not configured" }, 503);
    if (!adminAuthorized(request)) return json({ error: "admin passcode required" }, 401);
    if (path === "/admin/status" && request.method === "GET") return responseStatus();
    if (path === "/admin/responses.csv" && request.method === "GET") return downloadCsv();
    if (path === "/admin/responses.json" && request.method === "GET") return downloadJson();
    if (path === "/admin/upload-study" && request.method === "POST") return uploadStudy(request);
    // Compatibility with the original app's admin page.
    if (path === "/admin/upload-data" && request.method === "POST") return uploadStudy(request);
    return json({ error: "not found" }, 404);
  }

  if (!participantAuthorized(request)) return json({ error: "participant passcode required" }, 401);

  if (path === "/api/study" && request.method === "GET") {
    const bundle = await loadBundle();
    return bundle ? json(bundle) : json({ error: "study data has not been uploaded" }, 409);
  }

  if (path === "/api/pairs" && request.method === "GET") {
    const pairs = await configStore().get("pairs", { type: "json" });
    if (pairs) return json(pairs);
    const bundle = await loadBundle();
    if (!bundle) return json({ error: "study data has not been uploaded" }, 409);
    return json(
      bundle.items.map((item) => ({
        id: item.id,
        school: item.label,
        contact_email: item.metadata.contact_email ?? "",
        email_round1: item.versions[0].content,
        email_round2: item.versions[1].content,
      })),
    );
  }

  if (path === "/api/progress" && request.method === "GET") {
    const participantId = (new URL(request.url).searchParams.get("rater") || "").trim();
    if (!participantId) return json({ answers: {} });
    const answers =
      (await responseStore().get(encodeURIComponent(participantId), { type: "json" })) || {};
    return json({ answers });
  }

  if (path === "/api/response" && request.method === "POST") return saveResponse(request);
  return json({ error: "not found" }, 404);
}

export default async function handler(request) {
  try {
    return await route(request);
  } catch (error) {
    console.error(error);
    return json({ error: "internal server error" }, 500);
  }
}

export const config = {
  path: ["/api/*", "/admin/*"],
};
