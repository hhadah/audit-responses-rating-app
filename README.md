# Audit Responses Rating App

A reusable web application for collecting blinded, pairwise ratings of responses from correspondence and audit studies. Each rater sees two responses for the same audit item in a deterministic random order, records a preference on a configurable scale, and selects configurable reasons for that preference.

The application is designed for Netlify. The front end is static, the API runs as a Netlify Function, and private study inputs and submitted ratings are stored in Netlify Blobs rather than Git.

## Study setup guides

- [`resonant-horse-fdc798` setup and operations runbook](docs/resonant-horse-study-setup.md): environment variables, study preparation, activation, participant distribution, response exports, and troubleshooting for the new Netlify site.

## Current production deployment

This repository is the standalone source for the existing school-email rating study.

- Participant app: <https://ornate-naiad-f53450.netlify.app>
- Administration: <https://ornate-naiad-f53450.netlify.app/admin.html>
- Netlify project: `ornate-naiad-f53450`
- Netlify site ID: `7e601302-9783-409a-8ab5-2008a8674d0b`
- Netlify account/team: `hhadah`

The production site contains the original study pairs and responses in its existing Netlify Blob stores. Deploying code from this repository to that same site does not replace those blobs. The backend detects the original `pairs` blob and preserves the original CSV export columns.

## Features

- Exactly two responses or treatments per audit item.
- Stable random item order and stable left/right placement for each rater ID.
- Save after every item, resume by entering the same rater ID, skip, back, and review.
- Configurable study text, rating scale, reason checkboxes, and display color.
- Arbitrary item metadata carried into the response export.
- Separate participant and administrator passcodes.
- Analysis-ready CSV export and complete JSON backup.
- Generic converter for long-form audit data.
- Compatibility with the original school-email study and its stored responses.
- No database account or paid service required beyond a Netlify site.

## Security and data boundary

This is a public code repository. Do not commit any of the following:

- participant or administrator passcodes;
- real audit-study response text when it is confidential;
- contact information or direct identifiers;
- submitted rater names, IDs, or ratings;
- generated production `study-bundle.json` files.

The `.gitignore` excludes `.env`, `passcode.txt`, `data/`, `responses/`, `study-bundle.json`, and local Netlify state. Synthetic files under `examples/` are safe to publish.

Use different values for `PARTICIPANT_PASSCODE` and `ADMIN_PASSCODE`. If both roles use the legacy `PASSCODE`, every participant who knows that shared value can authenticate to the export endpoints. A rater ID identifies a response record; it is not an individual authentication credential. Choose IDs and data-handling procedures consistent with the study's IRB protocol and data-management plan.

## Requirements

- Node.js 20 or newer
- npm
- Python 3.9 or newer for the data-preparation scripts
- A Netlify account for deployment

## Repository layout

```text
.
├── examples/
│   ├── items.csv                 # synthetic standardized items
│   ├── study-config.json         # synthetic study configuration
│   └── study-bundle.json         # generated upload example
├── netlify/functions/
│   ├── api.mjs                   # authenticated API and Netlify Blob access
│   └── lib.mjs                   # validation, response normalization, exports
├── schema/
│   └── study-bundle.schema.json  # JSON Schema for upload bundles
├── scripts/
│   ├── build-study.py            # config + standardized items -> bundle
│   └── prepare-items.py          # long-form audit data -> standardized items
├── static/
│   ├── index.html                # participant page
│   ├── app.js
│   ├── admin.html                # researcher administration page
│   ├── admin.js
│   └── styles.css
├── .env.example
├── netlify.toml
└── package.json
```

## Run locally

Install the JavaScript dependencies:

```bash
npm install
```

Create a local secrets file and replace both example values:

```bash
cp .env.example .env
```

Generate the synthetic example bundle:

```bash
npm run build:example
```

Start Netlify's local runtime:

```bash
npm run dev
```

Netlify normally opens <http://localhost:8888>. Then:

1. Open <http://localhost:8888/admin.html>.
2. Enter the local `ADMIN_PASSCODE` from `.env`.
3. Choose `examples/study-bundle.json`.
4. Click **Upload study bundle**.
5. Open <http://localhost:8888> and enter the local `PARTICIPANT_PASSCODE`.

Local Netlify Blob state is written under `.netlify/` and is excluded from Git. Delete that directory only when you intentionally want to reset local study data and local responses.

## Create a study from standardized items

### 1. Copy and edit the study configuration

Copy `examples/study-config.json` to a private working location, such as `data/study-config.json`. The only required fields are `id` and `title`; the example explicitly shows every supported field.

Important fields:

| Field | Purpose |
|---|---|
| `id` | Stable study identifier containing letters, numbers, hyphens, or underscores. |
| `title`, `description` | Browser title and participant instructions. |
| `participant_*` | Label, help text, and placeholder for the rater identifier. |
| `item_term`, `item_term_plural` | Words used in progress and completion text, such as `school` and `schools`. |
| `comparison_instructions` | Context displayed above each pair. |
| `left_heading`, `right_heading` | Blinded labels above the two responses. |
| `rating_scale` | Integer values and their display/export labels. Negative values prefer left, positive values prefer right, and zero is neutral. |
| `reasons` | Checkbox keys and participant-facing labels. Keys become CSV column names. |
| `require_reason_when_non_neutral` | Requires at least one reason whenever the selected rating is not zero. |
| `other_reason_key`, `other_prompt` | Enables a free-text box for one configured reason key. |
| `accent_color` | Six-digit hexadecimal interface color. |

The complete machine-readable contract is `schema/study-bundle.schema.json`.

### 2. Prepare the items CSV

The standardized wide CSV requires these columns:

| Column | Meaning |
|---|---|
| `item_id` | Unique, stable audit-item identifier. |
| `item_label` | Researcher-readable item label; it is stored for export but not shown as the pair identity to raters. |
| `version_a_id`, `version_b_id` | Treatment, round, or condition identifiers. |
| `version_a_label`, `version_b_label` | Researcher-readable treatment labels. |
| `version_a_content`, `version_b_content` | Full response text shown to raters. CSV quoting supports commas and line breaks. |

Add any number of metadata columns with a `meta_` prefix, for example `meta_state`, `meta_treatment_cell`, or `meta_contact_email`. Metadata is not shown to raters and is exported with each submitted rating.

See `examples/items.csv` for a complete synthetic file.

### 3. Build the private upload bundle

```bash
python3 scripts/build-study.py \
  --config data/study-config.json \
  --items data/items.csv \
  --output study-bundle.json
```

Add `--repair-mojibake` if source response text contains common UTF-8/Windows-1252 corruption such as `â€™`. The output path `study-bundle.json` is ignored by Git.

### 4. Upload and inspect

Open `/admin.html` on the target deployment, enter `ADMIN_PASSCODE`, and upload `study-bundle.json`. Load the status panel to confirm the title and item count before sharing the participant URL.

The server rejects replacement when responses already exist unless the administrator checks the explicit backup-and-replacement confirmation. Replacing the active study bundle does not delete old responses; mixing responses from different studies on one site is therefore unsafe. Use a separate Netlify site for each new study.

## Convert a long-form audit dataset

Most audit datasets contain one row per item-treatment response rather than one row per pair. `scripts/prepare-items.py` groups exactly two versions per item and creates the standardized wide CSV.

Example:

```bash
python3 scripts/prepare-items.py \
  --input data/audit-responses.csv \
  --output data/items.csv \
  --item-id-column institution_id \
  --item-id-column contact_email \
  --item-label-column institution_name \
  --version-column audit_round \
  --content-column response_text \
  --metadata state=state \
  --metadata contact_email=contact_email
```

Repeat `--item-id-column` to form a composite identifier. Repeat `--metadata SOURCE=OUTPUT` to retain analysis fields. The converter stops with an error when an item has missing text, inconsistent metadata, duplicate versions, or anything other than exactly two unique versions. This prevents silent mispairing.

After conversion, run `scripts/build-study.py` as shown above.

## Deploy a new study to Netlify

1. Create a new GitHub repository from this repository or fork it.
2. In Netlify, select **Add new project → Import an existing project → GitHub**.
3. Select the new repository.
4. Leave the base directory empty. `netlify.toml` supplies `static` as the publish directory and `netlify/functions` as the functions directory.
5. Under **Project configuration → Environment variables**, create:
   - `PARTICIPANT_PASSCODE`: value distributed to raters;
   - `ADMIN_PASSCODE`: a different value retained by the research team.
6. Trigger the first production deploy.
7. Open `/admin.html`, upload the private `study-bundle.json`, and confirm the status.
8. Submit one test rating, download both exports, and inspect them before inviting raters.

Uploaded study content and submitted responses live in the site's Netlify Blob stores and survive Git pushes and code redeploys.

## Deploy this repository to the existing production site

The existing site must retain its site ID and Blob stores. Link and deploy from the repository root:

```bash
npx netlify login
npx netlify link --id 7e601302-9783-409a-8ab5-2008a8674d0b
npx netlify deploy --prod
```

A manual CLI deploy updates the existing URL without changing its stored data or environment variables. For automatic deploys, update the Netlify project's connected repository to `hhadah/audit-responses-rating-app` and leave the base directory empty.

Do not create a replacement Netlify site for the current study. A new site would have empty Blob stores and would not contain the collected responses.

## Download and back up responses

1. Open the deployment's `/admin.html` page.
2. Enter `ADMIN_PASSCODE`.
3. Click **Download responses.csv**.
4. Click **Download JSON backup**.
5. Store both files in the study's restricted research-data location.

The CSV is intended for analysis. A generic-study export contains:

- `participant_id`, `item_id`, and `item_label`;
- `left_version`, `right_version`, and signed `rating`;
- `rating_label` and `preferred_version`;
- one `meta_*` column for every item metadata field;
- one `reason_*` indicator for every configured or previously stored reason;
- `other_text` and the server timestamp.

The current school-email deployment remains in compatibility mode and retains its established fields: `rater`, `pair_id`, `school`, `contact_email`, `left_round`, `right_round`, `rating`, `rating_label`, `preferred_round`, reason indicators, `other_text`, and `timestamp`.

The JSON backup contains the normalized active study bundle and the raw response records. It is the better disaster-recovery artifact because it preserves more structure than the CSV.

## Update an active app

Code-only update:

```bash
git add .
git commit -m "Describe the change"
git push
```

A connected Netlify site deploys the pushed commit automatically. Code deployments do not alter Netlify Blobs.

Study-content update:

1. Download fresh CSV and JSON backups.
2. rebuild `study-bundle.json`;
3. inspect item IDs and counts;
4. upload through `/admin.html` using the replacement confirmation;
5. submit and export a test response.

Do not change item IDs after collection begins. Progress and saved answers are keyed by rater ID and item ID. Changing an ID creates a new item from the application's perspective.

## Environment variables

| Variable | Required | Meaning |
|---|---:|---|
| `PARTICIPANT_PASSCODE` | Recommended | Authenticates participant API requests. |
| `ADMIN_PASSCODE` | Recommended | Authenticates status, upload, and export endpoints. |
| `PASSCODE` | Legacy only | Fallback for either role when its role-specific variable is absent. |

The existing production site currently relies on the legacy fallback. Add a distinct `ADMIN_PASSCODE` to prevent participants from reaching administration endpoints while keeping the original participant passcode unchanged.

## API endpoints

| Endpoint | Authorization | Purpose |
|---|---|---|
| `GET /api/config` | None | Reports whether the app is ready and exposes only the study title. |
| `POST /api/login` | Participant | Verifies the participant passcode. |
| `GET /api/study` | Participant | Returns the active normalized bundle. |
| `GET /api/progress?rater=...` | Participant | Restores answers for one exact rater ID. |
| `POST /api/response` | Participant | Validates and saves one item response. |
| `GET /admin/status` | Administrator | Reports item, participant, and response counts. |
| `POST /admin/upload-study` | Administrator | Validates and stores a study bundle. |
| `GET /admin/responses.csv` | Administrator | Generates the analysis-ready CSV. |
| `GET /admin/responses.json` | Administrator | Generates a complete JSON backup. |

Participant requests use the `X-Passcode` header. Administrator requests use `X-Admin-Passcode`. The browser interfaces set these headers; researchers normally do not need to call the API directly.

## Storage and compatibility

Netlify Blobs uses two stores:

- `config`: active bundle under `bundle`; the original deployment's `pairs` key remains readable as a legacy fallback;
- `responses`: one blob per URL-encoded rater ID, containing answers keyed by item ID.

When only the original `pairs` key exists, the API converts it in memory to schema version 1 and uses `legacy-email-v1` export mode. It does not rewrite or delete the original pairs or responses. New saves include generic fields and the legacy school-email aliases needed by the established CSV.

## Verification

Run the deterministic backend and export tests:

```bash
npm test
```

Regenerate the committed synthetic bundle and confirm that it remains unchanged:

```bash
npm run build:example
git diff --exit-code -- examples/study-bundle.json
```

For a release, also run the local app, upload the example, complete a rating in the browser, resume with the same ID, and download both exports. Automated tests do not replace this end-to-end check because Netlify Functions and Blob storage are part of the observable behavior.

## Troubleshooting

### The start page says the study is not ready

Confirm that a participant passcode is configured and that an administrator uploaded a valid bundle. On the current production site, the original `pairs` blob also satisfies the data requirement.

### An administration request returns 401

Use `ADMIN_PASSCODE`, not `PARTICIPANT_PASSCODE`. Existing deployments with only `PASSCODE` use that legacy value for both roles.

### Upload returns 409 because responses already exist

Download both backups first, check the replacement confirmation, and upload again. Prefer a separate Netlify site if the bundle represents a different study.

### A rater's prior progress does not appear

Rater IDs are exact and case-sensitive. The rater must enter the same spacing and capitalization used previously. Progress is keyed by both that value and each stable item ID.

### A deployment succeeds but the live site does not update

Verify that the CLI is linked to the intended site ID or that Netlify's connected repository and production branch are correct. For the current deployment, the site name must remain `ornate-naiad-f53450`.

## License

MIT. See `LICENSE`.
