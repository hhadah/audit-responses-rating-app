import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_CSV_COLUMNS,
  buildStoredAnswer,
  legacyPairsToBundle,
  normalizeBundle,
  responsesCsv,
  responsesJson,
} from "../netlify/functions/lib.mjs";

function genericBundle() {
  return normalizeBundle({
    schema_version: 1,
    study: {
      id: "test-study",
      title: "Test Study",
      rating_scale: [
        { value: -1, label: "Left", export_label: "left" },
        { value: 0, label: "Tie", export_label: "tie" },
        { value: 1, label: "Right", export_label: "right" },
      ],
      reasons: [
        { key: "clear", label: "Clearer" },
        { key: "other", label: "Other" },
      ],
      other_reason_key: "other",
      require_reason_when_non_neutral: true,
    },
    items: [
      {
        id: "item-1",
        label: "Item One",
        metadata: { state: "LA", cell: 2 },
        versions: [
          { id: "A", label: "Treatment A", content: "First response" },
          { id: "B", label: "Treatment B", content: "Second response" },
        ],
      },
    ],
  });
}

test("normalizes a reusable study bundle", () => {
  const bundle = genericBundle();
  assert.equal(bundle.schema_version, 1);
  assert.equal(bundle.compatibility_mode, "generic");
  assert.equal(bundle.study.item_term, "item");
  assert.equal(bundle.items[0].metadata.state, "LA");
  assert.deepEqual(
    bundle.study.rating_scale.map((option) => option.value),
    [-1, 0, 1],
  );
});

test("rejects duplicate item IDs and malformed pair definitions", () => {
  const source = genericBundle();
  assert.throws(
    () => normalizeBundle({ ...source, items: [source.items[0], source.items[0]] }),
    /duplicate item id/,
  );
  assert.throws(
    () =>
      normalizeBundle({
        ...source,
        items: [{ ...source.items[0], versions: [source.items[0].versions[0]] }],
      }),
    /exactly two responses/,
  );
});

test("validates and normalizes a submitted rating", () => {
  const bundle = genericBundle();
  const now = new Date("2026-09-09T12:00:00.000Z");
  const result = buildStoredAnswer(
    {
      participant_id: "rater-01",
      item_id: "item-1",
      left_version: "B",
      right_version: "A",
      rating: -1,
      reasons: ["clear", "clear"],
      other_text: "",
    },
    bundle,
    now,
  );
  assert.equal(result.participantId, "rater-01");
  assert.equal(result.itemId, "item-1");
  assert.deepEqual(result.answer.reasons, ["clear"]);
  assert.equal(result.answer.left_version, "B");
  assert.equal(result.answer.timestamp, now.toISOString());

  assert.throws(
    () =>
      buildStoredAnswer(
        {
          participant_id: "rater-01",
          item_id: "item-1",
          left_version: "A",
          right_version: "B",
          rating: 1,
          reasons: [],
        },
        bundle,
      ),
    /at least one reason/,
  );
  assert.throws(
    () =>
      buildStoredAnswer(
        {
          participant_id: "rater-01",
          item_id: "item-1",
          left_version: "A",
          right_version: "B",
          rating: 4,
          reasons: ["clear"],
        },
        bundle,
      ),
    /configured scale/,
  );
});

test("exports generic metadata and reason indicators", () => {
  const bundle = genericBundle();
  const responses = {
    "rater-01": {
      "item-1": {
        item_label: "Item One",
        metadata: { state: "LA", cell: 2 },
        left_version: "B",
        right_version: "A",
        rating: -1,
        reasons: ["clear"],
        other_text: "",
        timestamp: "2026-09-09T12:00:00.000Z",
      },
    },
  };
  const csv = responsesCsv(responses, bundle);
  const [header, row] = csv.trim().split("\r\n");
  assert.equal(
    header,
    "participant_id,item_id,item_label,left_version,right_version,rating,rating_label,preferred_version,meta_cell,meta_state,reason_clear,reason_other,other_text,timestamp",
  );
  assert.equal(
    row,
    "rater-01,item-1,Item One,B,A,-1,left,B,2,LA,1,0,,2026-09-09T12:00:00.000Z",
  );
});

test("preserves the original school-email CSV contract", () => {
  const bundle = legacyPairsToBundle([
    {
      id: "Example School|contact@example.test",
      school: "Example School",
      contact_email: "contact@example.test",
      email_round1: "Round one response",
      email_round2: "Round two response",
    },
  ]);
  const responses = {
    "Rater One": {
      "Example School|contact@example.test": {
        school: "Example School",
        contact_email: "contact@example.test",
        left_round: "2",
        right_round: "1",
        rating: -2,
        reasons: ["friendliness", "other"],
        other_text: "Clear, direct",
        timestamp: "2026-07-18T10:00:00",
      },
    },
  };
  const csv = responsesCsv(responses, bundle);
  const [header, row] = csv.trim().split("\r\n");
  assert.equal(header, LEGACY_CSV_COLUMNS.join(","));
  assert.equal(
    row,
    'Rater One,Example School|contact@example.test,Example School,contact@example.test,2,1,-2,strongly prefer left,2,1,0,0,0,0,1,"Clear, direct",2026-07-18T10:00:00',
  );
});

test("JSON backup includes the bundle and raw response store", () => {
  const bundle = genericBundle();
  const responses = { rater: {} };
  const value = JSON.parse(
    responsesJson(responses, bundle, new Date("2026-09-09T12:00:00.000Z")),
  );
  assert.equal(value.schema_version, 1);
  assert.equal(value.exported_at, "2026-09-09T12:00:00.000Z");
  assert.equal(value.bundle.study.id, "test-study");
  assert.deepEqual(value.responses, responses);
});
