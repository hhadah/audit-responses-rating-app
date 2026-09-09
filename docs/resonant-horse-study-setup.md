# Set Up and Operate the `resonant-horse-fdc798` Rating Study

This runbook covers the new Netlify deployment at `resonant-horse-fdc798.netlify.app`: environment variables, study-data preparation, activation, participant distribution, response export, and routine administration.

## Site and project URLs

| Purpose | URL |
|---|---|
| Participant app | <https://resonant-horse-fdc798.netlify.app/> |
| Researcher administration | <https://resonant-horse-fdc798.netlify.app/admin.html> |
| Public readiness check | <https://resonant-horse-fdc798.netlify.app/api/config> |
| Netlify project dashboard | <https://app.netlify.com/projects/resonant-horse-fdc798> |
| Netlify environment variables | <https://app.netlify.com/projects/resonant-horse-fdc798/configuration/env> |
| Netlify deployments and build logs | <https://app.netlify.com/projects/resonant-horse-fdc798/deploys> |
| Netlify Function logs | <https://app.netlify.com/projects/resonant-horse-fdc798/logs/functions> |
| GitHub source repository | <https://github.com/hhadah/audit-responses-rating-app> |

The administration page calls these protected endpoints:

| Purpose | URL |
|---|---|
| Collection status | <https://resonant-horse-fdc798.netlify.app/admin/status> |
| CSV export | <https://resonant-horse-fdc798.netlify.app/admin/responses.csv> |
| Complete JSON backup | <https://resonant-horse-fdc798.netlify.app/admin/responses.json> |

Use the buttons on `/admin.html` rather than opening the protected endpoint URLs directly. The administration page supplies the required authentication header.

## Initial activation checklist

A site is ready for participants only when both conditions hold:

1. Netlify has a participant passcode; and
2. an administrator has uploaded a valid study bundle.

The public readiness endpoint should eventually report:

```json
{
  "auth_required": true,
  "ready": true,
  "study_title": "Your Study Title"
}
```

A response with `"ready": false` or `"study_title": null` means setup is incomplete.

## Configure environment variables

Open the [environment-variable settings](https://app.netlify.com/projects/resonant-horse-fdc798/configuration/env). Confirm that the following variables exist and have different values:

```text
ADMIN_PASSCODE
PARTICIPANT_PASSCODE
```

- `ADMIN_PASSCODE` is private to the research team. It protects the status, upload, and export endpoints.
- `PARTICIPANT_PASSCODE` is the value distributed to raters. It only authorizes the participant workflow.

Select **All deploy contexts** if Netlify requests a scope. After adding or changing either variable, open [Deploys](https://app.netlify.com/projects/resonant-horse-fdc798/deploys) and select **Trigger deploy → Deploy site**.

Generate strong passcodes locally if needed:

```bash
openssl rand -hex 24
```

Store both values in a password manager. Never commit them to Git, add them to a study bundle, or include the administrator value in participant instructions.

For a new deployment, do not define the legacy `PASSCODE` variable. It exists only to keep older deployments compatible with the reusable code.

## Prepare a study configuration

Work from the standalone repository:

```bash
cd /Users/hhadah/Projects/GiT/audit-responses-rating-app
cp examples/study-config.json data/study-config.json
cp examples/items.csv data/items.csv
```

Both files under `data/` are excluded from Git.

Edit `data/study-config.json` to define:

- the study ID, title, and participant instructions;
- the words used for an audit item, such as `school`, `employer`, `provider`, or `landlord`;
- the comparison instructions;
- the rating question and signed scale;
- the reason checkboxes and optional free-text reason;
- the completion message and display color.

Negative rating values indicate a preference for the response displayed on the left. Positive values indicate a preference for the response displayed on the right. Zero is treated as neutral. The configured scale must contain at least one negative and one positive value.

Example rating and reason configuration:

```json
{
  "id": "employment-response-rating",
  "title": "Employer Response Rating Study",
  "item_term": "employer",
  "item_term_plural": "employers",
  "rating_question": "Which employer response is more encouraging?",
  "rating_scale": [
    {
      "value": -2,
      "label": "Strongly prefer left",
      "export_label": "strongly prefer left"
    },
    {
      "value": 0,
      "label": "No preference",
      "export_label": "no preference"
    },
    {
      "value": 2,
      "label": "Strongly prefer right",
      "export_label": "strongly prefer right"
    }
  ],
  "reasons": [
    {
      "key": "friendliness",
      "label": "Friendlier tone"
    },
    {
      "key": "more_details",
      "label": "Provides more useful information"
    },
    {
      "key": "facilitated_action",
      "label": "Makes the next step easier"
    },
    {
      "key": "other",
      "label": "Other"
    }
  ],
  "other_reason_key": "other"
}
```

The full example is `examples/study-config.json`. The machine-readable specification is `schema/study-bundle.schema.json`.

## Prepare paired audit responses

`data/items.csv` contains one row per audit item and requires these columns:

| Column | Meaning |
|---|---|
| `item_id` | Unique and stable item identifier. |
| `item_label` | Researcher-readable label retained in the export. |
| `version_a_id` | First treatment, condition, or audit-round identifier. |
| `version_a_label` | Researcher-readable first-version label. |
| `version_a_content` | Full first response shown to raters. |
| `version_b_id` | Second treatment, condition, or audit-round identifier. |
| `version_b_label` | Researcher-readable second-version label. |
| `version_b_content` | Full second response shown to raters. |

Each item must contain exactly two response versions. The application randomizes which version appears on the left for each rater.

Add any number of analysis fields using a `meta_` prefix, for example:

```text
meta_state
meta_treatment_cell
meta_contact_email
meta_industry
```

Metadata fields are not shown to raters. They are reproduced in the response CSV.

## Convert long-form audit data

When the source data contain one row per item-treatment response, convert them to the standard paired format:

```bash
python3 scripts/prepare-items.py \
  --input data/raw-audit-responses.csv \
  --output data/items.csv \
  --item-id-column institution_id \
  --item-label-column institution_name \
  --version-column treatment \
  --content-column response_text \
  --metadata state=state \
  --metadata treatment_cell=treatment_cell
```

Repeat `--item-id-column` to create a composite ID. For example, add `--item-id-column contact_email` when an institution has multiple independently rated contacts. Repeat `--metadata SOURCE=OUTPUT` for all fields needed in analysis.

The converter stops rather than silently mispairing data when it finds missing text, duplicate versions, inconsistent item metadata, or anything other than exactly two unique versions.

## Build the private upload bundle

Generate the file that will be uploaded to Netlify Blob storage:

```bash
python3 scripts/build-study.py \
  --config data/study-config.json \
  --items data/items.csv \
  --output study-bundle.json
```

Add `--repair-mojibake` when source response text contains common UTF-8/Windows-1252 corruption such as `â€™`:

```bash
python3 scripts/build-study.py \
  --config data/study-config.json \
  --items data/items.csv \
  --output study-bundle.json \
  --repair-mojibake
```

`study-bundle.json` is private and excluded from Git. It contains the full response text and metadata for the study.

For interface-only inspection, a synthetic bundle is available at:

```text
/Users/hhadah/Projects/GiT/audit-responses-rating-app/examples/study-bundle.json
```

Do not use the synthetic bundle for production data collection.

## Upload and activate the study

Open the [administration page](https://resonant-horse-fdc798.netlify.app/admin.html), then:

1. Enter `ADMIN_PASSCODE`.
2. Click **Load status**.
3. Choose the generated `study-bundle.json` file.
4. Click **Upload study bundle**.
5. Click **Load status** again.
6. Confirm the expected study title and item count.
7. Open the [readiness endpoint](https://resonant-horse-fdc798.netlify.app/api/config) and confirm `"ready": true`.

If responses already exist, the app refuses to replace the active study until the administrator checks the explicit backup-and-replacement confirmation. Replacing a bundle does not delete old responses. Do not use one Netlify site for unrelated studies because their response records would be mixed.

## Inspect the participant workflow

Open the [participant app](https://resonant-horse-fdc798.netlify.app/) and enter:

- a temporary rater ID; and
- `PARTICIPANT_PASSCODE`.

Confirm the study title, instructions, paired response content, rating scale, reason choices, progress counter, and responsive layout.

Do not click **Save & Next** on a production site merely to test the screen. Saving creates a permanent response record. The application intentionally has no casual deletion control. If an authorized pre-launch test response is necessary, use an explicit test ID and document that it must be excluded from analysis.

## Participant distribution text

Send participants only the participant URL and participant passcode:

```text
Rating website:
https://resonant-horse-fdc798.netlify.app/

Participant passcode:
[PARTICIPANT_PASSCODE]
```

Tell raters to enter the exact same name or rater ID on every visit. IDs are case-sensitive and control session resumption.

Never distribute:

- `ADMIN_PASSCODE`;
- the `/admin.html` URL;
- Netlify dashboard links;
- the private study bundle;
- downloaded response files.

## Monitor and download responses

Open the [administration page](https://resonant-horse-fdc798.netlify.app/admin.html), enter `ADMIN_PASSCODE`, and click **Load status**. The status panel reports:

- active study title and ID;
- number of paired items;
- number of rater IDs;
- number of saved item ratings.

Download both artifacts regularly:

1. **Download responses.csv** produces the analysis-ready file.
2. **Download JSON backup** preserves the normalized study bundle and raw response records.

Store both files in the study's restricted research-data location. Do not commit either file to the public GitHub repository.

The generic CSV contains:

- `participant_id`, `item_id`, and `item_label`;
- `left_version`, `right_version`, and signed `rating`;
- `rating_label` and `preferred_version`;
- one `meta_*` field for each item metadata variable;
- one `reason_*` indicator for each configured reason;
- `other_text` and the server timestamp.

## Routine operational checklist

Before inviting raters:

- confirm `ADMIN_PASSCODE` and `PARTICIPANT_PASSCODE` are different;
- confirm the readiness endpoint reports the correct study title;
- confirm the administration page reports the expected item count and zero unexplained responses;
- inspect several response pairs without saving;
- preserve the final private configuration, standardized items CSV, and uploaded bundle in restricted project storage;
- document the exact rater-ID convention provided to participants.

During data collection:

- avoid changing study text, reason keys, rating values, or item IDs;
- monitor participant and response counts;
- download dated CSV and JSON backups regularly;
- review Netlify Function logs if raters report failed saves.

After data collection:

- download final CSV and JSON backups;
- record the final item, participant, and response counts;
- store the exports with the analysis data;
- retain the Netlify site until the backups have been verified;
- rotate or remove participant access when continued submission is no longer appropriate.

## Troubleshooting

### `ready` is false

Confirm that `PARTICIPANT_PASSCODE` exists, redeploy after any environment-variable change, upload a valid study bundle, and check `/admin.html` for the active title and item count.

### The administration page rejects the password

Confirm that the value entered is `ADMIN_PASSCODE`, not `PARTICIPANT_PASSCODE`. Verify the exact variable name and trigger a new production deploy.

### The participant page rejects the passcode

Confirm that the value entered is `PARTICIPANT_PASSCODE`, then verify that the latest production deploy occurred after the variable was added.

### Upload returns a response-backup warning

The site already contains saved responses. Download both exports before proceeding. If the file is for a different study, stop and create a separate Netlify site instead of replacing the active bundle.

### Prior progress does not appear

The rater must use the exact prior identifier, including capitalization and spacing. Progress is keyed by rater ID and item ID.

### A save fails

Check the browser's network connection and the [Netlify Function logs](https://app.netlify.com/projects/resonant-horse-fdc798/logs/functions). Do not tell the rater to change IDs; that would create a separate response record.

## Current design boundary

The configurable application collects one signed pairwise preference rating per item, multiple reason checkboxes, and optional free text. It does not currently collect several independent Likert outcomes for the same pair. Separate ratings for dimensions such as warmth, helpfulness, detail, and negativity would require an extension to the bundle schema, participant interface, response validation, and export format.
