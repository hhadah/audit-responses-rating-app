const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const STUDY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const DEFAULT_SCALE = [
  { value: -2, label: "Strongly prefer left", export_label: "strongly prefer left" },
  { value: -1, label: "Prefer left", export_label: "prefer left" },
  { value: 0, label: "Neutral", export_label: "neutral" },
  { value: 1, label: "Prefer right", export_label: "prefer right" },
  { value: 2, label: "Strongly prefer right", export_label: "strongly prefer right" },
];

const DEFAULT_COPY = {
  description: "Compare the two responses and record which one you prefer and why. Your answers are saved after every item, so you can stop and resume later.",
  participant_prompt: "Before we start, what is your name or rater ID?",
  participant_help: "Use the exact same value to resume a previous session.",
  participant_placeholder: "Rater name or ID",
  item_term: "item",
  comparison_instructions: "Read both responses, then answer the questions below.",
  left_heading: "RESPONSE ON THE LEFT",
  right_heading: "RESPONSE ON THE RIGHT",
  rating_question: "Which response do you prefer?",
  reason_question: "Why is the response you preferred better?",
  reason_help: "Check all that apply.",
  other_prompt: "Please explain:",
  completion_title: "All done — thank you!",
  completion_message: "Your answers have been saved.",
  accent_color: "#2f5e9e",
};

export const LEGACY_REASON_KEYS = [
  "friendliness",
  "more_details",
  "explained_process",
  "other_more_negative",
  "facilitated_application",
  "other",
];

export const LEGACY_CSV_COLUMNS = [
  "rater",
  "pair_id",
  "school",
  "contact_email",
  "left_round",
  "right_round",
  "rating",
  "rating_label",
  "preferred_round",
  "reason_friendliness",
  "reason_more_details",
  "reason_explained_process",
  "reason_other_more_negative",
  "reason_facilitated_application",
  "reason_other",
  "other_text",
  "timestamp",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, field, fallback = undefined, maxLength = 10000) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const result = candidate.trim();
  if (result.length > maxLength) throw new Error(`${field} is too long`);
  return result;
}

function optionalText(value, field, fallback = "", maxLength = 10000) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${field} is too long`);
  return result;
}

function normalizeMetadata(value, field) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`${field} key ${JSON.stringify(key)} must contain only letters, numbers, and underscores`);
    }
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) {
      throw new Error(`${field}.${key} must be a string, number, boolean, or null`);
    }
    result[key] = item;
  }
  return result;
}

function normalizeStudy(input) {
  if (!isObject(input)) throw new Error("study must be an object");
  const id = text(input.id, "study.id", undefined, 100);
  if (!STUDY_ID_PATTERN.test(id)) {
    throw new Error("study.id may contain only letters, numbers, hyphens, and underscores");
  }

  const ratingInput = input.rating_scale ?? DEFAULT_SCALE;
  if (!Array.isArray(ratingInput) || ratingInput.length < 2) {
    throw new Error("study.rating_scale must contain at least two options");
  }
  const ratingValues = new Set();
  const ratingScale = ratingInput.map((option, index) => {
    if (!isObject(option) || !Number.isInteger(option.value)) {
      throw new Error(`study.rating_scale[${index}].value must be an integer`);
    }
    if (ratingValues.has(option.value)) throw new Error("study.rating_scale values must be unique");
    ratingValues.add(option.value);
    return {
      value: option.value,
      label: text(option.label, `study.rating_scale[${index}].label`, undefined, 200),
      export_label: text(
        option.export_label,
        `study.rating_scale[${index}].export_label`,
        option.label,
        200,
      ),
    };
  });
  if (![...ratingValues].some((value) => value < 0) || ![...ratingValues].some((value) => value > 0)) {
    throw new Error("study.rating_scale needs at least one negative and one positive value");
  }

  const reasonInput = input.reasons ?? [];
  if (!Array.isArray(reasonInput)) throw new Error("study.reasons must be an array");
  const reasonKeys = new Set();
  const reasons = reasonInput.map((reason, index) => {
    if (!isObject(reason)) throw new Error(`study.reasons[${index}] must be an object`);
    const key = text(reason.key, `study.reasons[${index}].key`, undefined, 100);
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`study.reasons[${index}].key must contain only letters, numbers, and underscores`);
    }
    if (reasonKeys.has(key)) throw new Error("study reason keys must be unique");
    reasonKeys.add(key);
    return { key, label: text(reason.label, `study.reasons[${index}].label`, undefined, 300) };
  });

  let otherReasonKey = input.other_reason_key ?? null;
  if (otherReasonKey !== null) {
    otherReasonKey = text(otherReasonKey, "study.other_reason_key", undefined, 100);
    if (!reasonKeys.has(otherReasonKey)) {
      throw new Error("study.other_reason_key must match a configured reason key");
    }
  }

  const itemTerm = text(input.item_term, "study.item_term", DEFAULT_COPY.item_term, 100);
  const accentColor = text(input.accent_color, "study.accent_color", DEFAULT_COPY.accent_color, 20);
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    throw new Error("study.accent_color must be a six-digit hex color");
  }

  return {
    id,
    title: text(input.title, "study.title", undefined, 200),
    description: text(input.description, "study.description", DEFAULT_COPY.description, 2000),
    participant_prompt: text(
      input.participant_prompt,
      "study.participant_prompt",
      DEFAULT_COPY.participant_prompt,
      500,
    ),
    participant_help: text(
      input.participant_help,
      "study.participant_help",
      DEFAULT_COPY.participant_help,
      1000,
    ),
    participant_placeholder: text(
      input.participant_placeholder,
      "study.participant_placeholder",
      DEFAULT_COPY.participant_placeholder,
      200,
    ),
    item_term: itemTerm,
    item_term_plural: text(input.item_term_plural, "study.item_term_plural", `${itemTerm}s`, 100),
    comparison_instructions: text(
      input.comparison_instructions,
      "study.comparison_instructions",
      DEFAULT_COPY.comparison_instructions,
      2000,
    ),
    left_heading: text(input.left_heading, "study.left_heading", DEFAULT_COPY.left_heading, 200),
    right_heading: text(input.right_heading, "study.right_heading", DEFAULT_COPY.right_heading, 200),
    rating_question: text(
      input.rating_question,
      "study.rating_question",
      DEFAULT_COPY.rating_question,
      500,
    ),
    reason_question: text(
      input.reason_question,
      "study.reason_question",
      DEFAULT_COPY.reason_question,
      500,
    ),
    reason_help: optionalText(input.reason_help, "study.reason_help", DEFAULT_COPY.reason_help, 500),
    require_reason_when_non_neutral:
      input.require_reason_when_non_neutral === undefined
        ? reasons.length > 0
        : Boolean(input.require_reason_when_non_neutral),
    other_reason_key: otherReasonKey,
    other_prompt: text(input.other_prompt, "study.other_prompt", DEFAULT_COPY.other_prompt, 500),
    completion_title: text(
      input.completion_title,
      "study.completion_title",
      DEFAULT_COPY.completion_title,
      500,
    ),
    completion_message: text(
      input.completion_message,
      "study.completion_message",
      DEFAULT_COPY.completion_message,
      1000,
    ),
    accent_color: accentColor,
    rating_scale: ratingScale,
    reasons,
  };
}

export function normalizeBundle(input) {
  if (!isObject(input)) throw new Error("study bundle must be a JSON object");
  if (input.schema_version !== 1) throw new Error("schema_version must be 1");
  const study = normalizeStudy(input.study);
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("items must be a non-empty array");
  }

  const itemIds = new Set();
  const items = input.items.map((item, itemIndex) => {
    if (!isObject(item)) throw new Error(`items[${itemIndex}] must be an object`);
    const id = text(item.id, `items[${itemIndex}].id`, undefined, 300);
    if (itemIds.has(id)) throw new Error(`duplicate item id: ${id}`);
    itemIds.add(id);
    if (!Array.isArray(item.versions) || item.versions.length !== 2) {
      throw new Error(`items[${itemIndex}].versions must contain exactly two responses`);
    }
    const versionIds = new Set();
    const versions = item.versions.map((version, versionIndex) => {
      if (!isObject(version)) {
        throw new Error(`items[${itemIndex}].versions[${versionIndex}] must be an object`);
      }
      const versionId = text(
        version.id,
        `items[${itemIndex}].versions[${versionIndex}].id`,
        undefined,
        100,
      );
      if (versionIds.has(versionId)) throw new Error(`item ${id} has duplicate version ids`);
      versionIds.add(versionId);
      return {
        id: versionId,
        label: text(
          version.label,
          `items[${itemIndex}].versions[${versionIndex}].label`,
          versionId,
          200,
        ),
        content: text(
          version.content,
          `items[${itemIndex}].versions[${versionIndex}].content`,
          undefined,
          200000,
        ),
      };
    });
    return {
      id,
      label: text(item.label, `items[${itemIndex}].label`, id, 500),
      metadata: normalizeMetadata(item.metadata, `items[${itemIndex}].metadata`),
      versions,
    };
  });

  return {
    schema_version: 1,
    compatibility_mode:
      input.compatibility_mode === "legacy-email-v1" ? "legacy-email-v1" : "generic",
    study,
    items,
  };
}

export function legacyPairsToBundle(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("legacy pairs data must be a non-empty array");
  }
  return normalizeBundle({
    schema_version: 1,
    compatibility_mode: "legacy-email-v1",
    study: {
      id: "school-email-preference",
      title: "School Email Preference Study",
      description:
        "For each school, two response emails are shown side by side in random order. Tell us which one you prefer and why. Your answers are saved after every item, so you can stop and resume later.",
      participant_prompt: "Before we start, what is your name?",
      participant_help:
        "Your answers are saved under this name. Use the exact same name to resume a previous session.",
      participant_placeholder: "e.g., Jane Smith",
      item_term: "school",
      item_term_plural: "schools",
      comparison_instructions:
        "Both emails are real responses from the same school to a parent asking how to apply. Read both, then answer below.",
      left_heading: "EMAIL ON THE LEFT",
      right_heading: "EMAIL ON THE RIGHT",
      rating_question: "Which email do you prefer?",
      reason_question: "Why is the email you preferred better?",
      reason_help: "Check all that apply.",
      require_reason_when_non_neutral: true,
      other_reason_key: "other",
      other_prompt: "Please explain:",
      completion_title: "All done — thank you!",
      completion_message: "Your ratings have been saved.",
      accent_color: "#2f5e9e",
      rating_scale: DEFAULT_SCALE,
      reasons: [
        { key: "friendliness", label: "Friendliness" },
        { key: "more_details", label: "Includes more details" },
        { key: "explained_process", label: "Explained the process" },
        { key: "other_more_negative", label: "The unpreferred email was more negative" },
        { key: "facilitated_application", label: "Facilitated the application process" },
        { key: "other", label: "Other" },
      ],
    },
    items: pairs.map((pair, index) => {
      if (!isObject(pair)) throw new Error(`legacy pair ${index} must be an object`);
      return {
        id: pair.id,
        label: pair.school,
        metadata: { school: pair.school, contact_email: pair.contact_email ?? "" },
        versions: [
          { id: "1", label: "Round 1", content: pair.email_round1 },
          { id: "2", label: "Round 2", content: pair.email_round2 },
        ],
      };
    }),
  });
}

export function preferredVersion(rating, leftVersion, rightVersion) {
  if (rating < 0) return leftVersion;
  if (rating > 0) return rightVersion;
  return "none";
}

export function buildStoredAnswer(payload, bundle, now = new Date()) {
  if (!isObject(payload)) throw new Error("response body must be a JSON object");
  const participantId = optionalText(
    payload.participant_id ?? payload.rater,
    "participant_id",
    "",
    200,
  );
  const itemId = optionalText(payload.item_id ?? payload.pair_id, "item_id", "", 300);
  if (!participantId || !itemId) throw new Error("participant_id and item_id are required");

  const item = bundle.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("unknown item_id");
  const rating = Number(payload.rating);
  if (!Number.isInteger(rating) || !bundle.study.rating_scale.some((option) => option.value === rating)) {
    throw new Error("rating is not in the configured scale");
  }

  const leftVersion = String(payload.left_version ?? payload.left_round ?? "").trim();
  const rightVersion = String(payload.right_version ?? payload.right_round ?? "").trim();
  const versionIds = new Set(item.versions.map((version) => version.id));
  if (!versionIds.has(leftVersion) || !versionIds.has(rightVersion) || leftVersion === rightVersion) {
    throw new Error("left_version and right_version must be the item's two configured versions");
  }

  if (!Array.isArray(payload.reasons)) throw new Error("reasons must be an array");
  const allowedReasons = new Set(bundle.study.reasons.map((reason) => reason.key));
  const reasons = [...new Set(payload.reasons.map((reason) => String(reason)))];
  const unknownReason = reasons.find((reason) => !allowedReasons.has(reason));
  if (unknownReason) throw new Error(`unknown reason: ${unknownReason}`);
  if (bundle.study.require_reason_when_non_neutral && rating !== 0 && reasons.length === 0) {
    throw new Error("at least one reason is required for a non-neutral rating");
  }

  const otherText = optionalText(payload.other_text, "other_text", "", 5000);
  const answer = {
    item_label: item.label,
    metadata: { ...item.metadata },
    left_version: leftVersion,
    right_version: rightVersion,
    rating,
    reasons,
    other_text: otherText,
    timestamp: now.toISOString(),
  };

  if (bundle.compatibility_mode === "legacy-email-v1") {
    answer.school = String(item.metadata.school ?? item.label);
    answer.contact_email = String(item.metadata.contact_email ?? "");
    answer.left_round = leftVersion;
    answer.right_round = rightVersion;
  }

  return { participantId, itemId, answer };
}

export function csvEscape(value) {
  const stringValue = String(value ?? "");
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

function serializeCsv(columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function sortedAnswers(responses) {
  const result = [];
  for (const participantId of Object.keys(responses).sort()) {
    const answers = responses[participantId] ?? {};
    for (const itemId of Object.keys(answers).sort()) {
      result.push({ participantId, itemId, answer: answers[itemId] });
    }
  }
  return result;
}

function ratingExportLabel(bundle, rating) {
  return bundle.study.rating_scale.find((option) => option.value === rating)?.export_label ?? "";
}

function legacyResponsesCsv(responses, bundle) {
  const rows = sortedAnswers(responses).map(({ participantId, itemId, answer }) => {
    const rating = Number(answer.rating);
    const reasons = new Set(answer.reasons ?? []);
    const leftRound = answer.left_round ?? answer.left_version ?? "";
    const rightRound = answer.right_round ?? answer.right_version ?? "";
    return {
      rater: participantId,
      pair_id: itemId,
      school: answer.school ?? answer.item_label ?? "",
      contact_email: answer.contact_email ?? answer.metadata?.contact_email ?? "",
      left_round: leftRound,
      right_round: rightRound,
      rating,
      rating_label: ratingExportLabel(bundle, rating),
      preferred_round: preferredVersion(rating, leftRound, rightRound),
      reason_friendliness: reasons.has("friendliness") ? 1 : 0,
      reason_more_details: reasons.has("more_details") ? 1 : 0,
      reason_explained_process: reasons.has("explained_process") ? 1 : 0,
      reason_other_more_negative: reasons.has("other_more_negative") ? 1 : 0,
      reason_facilitated_application: reasons.has("facilitated_application") ? 1 : 0,
      reason_other: reasons.has("other") ? 1 : 0,
      other_text: answer.other_text ?? "",
      timestamp: answer.timestamp ?? "",
    };
  });
  return serializeCsv(LEGACY_CSV_COLUMNS, rows);
}

function genericResponsesCsv(responses, bundle) {
  const answers = sortedAnswers(responses);
  const metadataKeys = new Set();
  const reasonKeys = new Set(bundle.study.reasons.map((reason) => reason.key));
  for (const item of bundle.items) Object.keys(item.metadata).forEach((key) => metadataKeys.add(key));
  for (const { answer } of answers) {
    Object.keys(answer.metadata ?? {}).forEach((key) => metadataKeys.add(key));
    for (const reason of answer.reasons ?? []) if (KEY_PATTERN.test(reason)) reasonKeys.add(reason);
  }
  const sortedMetadataKeys = [...metadataKeys].sort();
  const sortedReasonKeys = [...reasonKeys].sort();
  const columns = [
    "participant_id",
    "item_id",
    "item_label",
    "left_version",
    "right_version",
    "rating",
    "rating_label",
    "preferred_version",
    ...sortedMetadataKeys.map((key) => `meta_${key}`),
    ...sortedReasonKeys.map((key) => `reason_${key}`),
    "other_text",
    "timestamp",
  ];
  const rows = answers.map(({ participantId, itemId, answer }) => {
    const item = bundle.items.find((candidate) => candidate.id === itemId);
    const metadata = { ...(item?.metadata ?? {}), ...(answer.metadata ?? {}) };
    const rating = Number(answer.rating);
    const leftVersion = answer.left_version ?? answer.left_round ?? "";
    const rightVersion = answer.right_version ?? answer.right_round ?? "";
    const selectedReasons = new Set(answer.reasons ?? []);
    const row = {
      participant_id: participantId,
      item_id: itemId,
      item_label: answer.item_label ?? item?.label ?? "",
      left_version: leftVersion,
      right_version: rightVersion,
      rating,
      rating_label: ratingExportLabel(bundle, rating),
      preferred_version: preferredVersion(rating, leftVersion, rightVersion),
      other_text: answer.other_text ?? "",
      timestamp: answer.timestamp ?? "",
    };
    for (const key of sortedMetadataKeys) row[`meta_${key}`] = metadata[key] ?? "";
    for (const key of sortedReasonKeys) row[`reason_${key}`] = selectedReasons.has(key) ? 1 : 0;
    return row;
  });
  return serializeCsv(columns, rows);
}

export function responsesCsv(responses, bundle) {
  return bundle.compatibility_mode === "legacy-email-v1"
    ? legacyResponsesCsv(responses, bundle)
    : genericResponsesCsv(responses, bundle);
}

export function responsesJson(responses, bundle, now = new Date()) {
  return JSON.stringify(
    {
      schema_version: 1,
      exported_at: now.toISOString(),
      bundle,
      responses,
    },
    null,
    2,
  );
}

export function countResponses(responses) {
  return Object.values(responses).reduce(
    (total, answers) => total + Object.keys(answers ?? {}).length,
    0,
  );
}
