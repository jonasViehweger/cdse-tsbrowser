# CDSE-TSBROWSER

A browser-based interface for viewing and labelling satellite time-series. The primary use-case is sharing a URL with a user so they can open the app, connect with their own CDSE credentials, and view a time-series at a pre-specified location and date range alongside any existing labels.

The app runs entirely in the browser (no backend). It uses **Vue 3** + **Vite** for the frontend framework and build tooling, **dockview** for the panel layout, and fetches satellite data from the **Copernicus Dataspace Ecosystem (CDSE)** using credentials provided by the user.

---

## URL Schema

The URL is the **complete, self-contained state** of what you are looking at. It contains enough information to reconstruct the full view from scratch — including the labelling schema — without any local state. This enables frictionless sharing: paste a URL to a colleague and they see exactly what you see.

All parameter names are lowercase. Scalar fields are plain query parameters. Structured fields are URL-encoded JSON (not base64) so they remain inspectable in browser DevTools. JSON keys within structured fields use camelCase.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `lon` | float | Longitude of the current sample point |
| `lat` | float | Latitude of the current sample point |
| `start` | date | Time-series start date (YYYY-MM-DD) |
| `end` | date | Time-series end date (YYYY-MM-DD) |
| `selected` | date | Currently selected date |
| `sample` | JSON | Per-sample observation data (sample_id, flags, field values) |
| `schema` | JSON | Labelling schema — always fully embedded, never just a name reference |

`start` and `end` are always top-level params — both for single-sample and campaign URLs. The campaign's date range is expressed via the same params.

### `schema` object

| Field | Type | Description |
|-------|------|-------------|
| `campaign` | string | OPTIONAL: Name of the labelling campaign |
| `flagLabels` | dict | Key: Flag code, Value: Human-readable label |
| `fields` | array | OPTIONAL: Ordered field definitions for the labelling form |

`schema` is present whenever there are flag labels or a campaign active. When a campaign is active, the full schema (including `fields`) is always embedded so the URL is self-contained.

### `sample` object

| Field | Type | Description |
|-------|------|-------------|
| `sample_id` | string | OPTIONAL: ID of this sample point |
| `flags` | dict | Key: Date (YYYY-MM-DD), Value: Flag code |
| *(other field keys)* | value | Values for fields defined in `schema.fields` |

`sample` mirrors GeoJSON feature properties: `flags` plus any named field values. It is omitted when there is no observation data.

### Sharing workflow

1. **User A** is labelling a campaign sample and is uncertain. They copy the URL.
   - URL contains: `lon`/`lat`, `start`/`end`, `schema` (full schema including campaign name and field definitions), `sample` (current form values and flags, including `sample_id`).
2. **User B** opens the URL. They may or may not have the campaign in their local IDB.
   - If the campaign is in their IDB with a **matching schema** → loads from IDB, URL sample data shown as draft.
   - If the campaign is in their IDB with a **mismatched schema** → URL data displayed but Save & Next is blocked with a schema mismatch error.
   - If the campaign is **not in their IDB** → schema loaded ephemerally from the URL (not persisted), Save & Next is blocked.
3. User B edits the form, copies the new URL, sends it back.
4. **User A** opens the returned URL. Their campaign loads from IDB (schemas match), URL sample data overrides the draft state for that sample. They hit Save & Next to commit.

**Key rules:**
- URL state takes precedence over IDB state for the current sample's draft (flags + field values).
- IDB is the authoritative store for committed records (post Save & Next).
- Schema mismatch (deep equality check on `flagLabels` + `fields`) blocks saving but not viewing.
- A URL-embedded schema is never automatically persisted to IDB — the user must explicitly upload/import a campaign.

---

## Architecture

The app is plugin-based. Each plugin instance occupies its own dockview panel. Plugins read from and write to a shared global state store (Pinia). The layout is managed by dockview and persisted in `localStorage` as a JSON snapshot. Layout presets are defined as JSON files in `src/layout/json/` and selectable from a toolbar dropdown.

### Global State

```
coordinate:    [lon: float, lat: float]
selectedDate:  date | null
startDate:     date
endDate:       date
flags:         { [date: string]: string }     ← current draft flags for this sample
flagLabels:    { [value: string]: string }    ← driven from active schema
sampleMeta:    { [key: string]: unknown }     ← current draft form values for this sample
```

`flagLabels` is always driven from `campaignStore.schema.flagLabels` when a campaign is active. It is watched reactively in `App.vue` so all components stay in sync without manual propagation.

`flags` and `sampleMeta` are **draft state**: they reflect the in-progress edit for the current sample. They are written to IDB only when the user hits Save & Next.

### Campaign Store

```
schema:          CampaignParams | null    ← active schema (from IDB or ephemerally from URL)
features:        CampaignFeature[]        ← all sample points (from IDB)
sampleRecords:   Record<string, SampleRecord>  ← committed records (from IDB)
schemaMismatch:  boolean                  ← URL schema ≠ IDB schema for same campaign name
isEphemeral:     boolean                  ← schema loaded from URL without IDB backing
```

`schemaMismatch` and `isEphemeral` are checked by CampaignMapPanel to gate Save & Next.

### Initialisation Order (main.ts)

```
1. Install Pinia
2. Load persisted auth credentials → fetch token
3. Parse URL
4. If schema.campaign present:
   a. Try loadFromIdb(name, urlSchema)
      → if found: compare schemas → set schemaMismatch
      → URL schema takes precedence for display
   b. If not found: loadEphemeral(urlSchema) → isEphemeral = true
5. app.mount()
6. App.vue setup: restore coordinate, dates, flags, meta from URL
7. App.vue watchEffect: sync all state → URL on every change
```

### CDSE Authentication

Satellite data is fetched from CDSE using **OAuth2 client credentials** (client ID + client secret). Credentials are entered via the **Connect** button in the toolbar. Two storage modes are offered:
- **Session only** (default): stored in memory, lost on tab close.
- **Remember me**: stored in `localStorage` under a fixed key. Retrieved on next load and used to auto-fetch a token.

Credentials are never serialised into the URL. The access token is automatically refreshed before expiry. All CDSE and Esri Wayback APIs support CORS from any origin.

---

## Toolbar

The toolbar is intentionally minimal. Coordinates and date range are configured via the URL rather than UI inputs.

**Contents (left to right):**
- App title
- Layout preset selector (dropdown)
- Campaign selector (dropdown — lists campaigns stored in IDB)
- **`+ Add Panel`** dropdown — lists all registered plugins; clicking an entry adds a new panel
- Connection status indicator (coloured dot)
- **`Connect`** button — opens the credentials dialog

---

## Plugin System

Plugins are registered in `src/plugins/registry.ts`. Each entry describes a panel type:

```ts
interface PanelPlugin {
  id: string          // Vue component name, e.g. 'timeSeriesPanel'
  name: string        // display name shown in the "Add Panel" menu
  singleton: boolean  // if true, only one instance may be open at a time
  defaultTitle: string
  defaultParams?: Record<string, unknown>
}
```

Plugins are registered globally as Vue components so that dockview can resolve them by name. Per-plugin configuration is serialised into the dockview layout snapshot and restored on page reload.

---

## Data Architecture

### Raw Band Cache

The Sentinel Hub Statistical API is queried for raw Sentinel-2 band means (B02, B03, B04, B05, B06, B07, B08, B8A, B11, B12, SCL) rather than pre-computed indices. Results are cached in `localStorage` keyed by (lon, lat, date range, collection). The date range is split into 6-month chunks fetched concurrently.

Spectral indices (NDVI, NDMI, etc.) are computed client-side from the cached raw bands. Toggling cloud masking or switching index does not require a network round-trip.

Cloud masking is applied client-side: dates where `SCL ∉ {2, 4, 5, 6}` are excluded.

Multiple plugin instances requesting the same location share a single in-flight fetch promise, preventing duplicate concurrent requests.

### Data Sources

A data source defines a named combination of a CDSE collection and a client-side compute function applied to the raw band cache.

| Name | Collection | Index |
|------|------------|-------|
| S2 NDVI | sentinel-2-l2a | (B08−B04)/(B08+B04) |
| S2 NDMI | sentinel-2-l2a | (B08−B11)/(B08+B11) |

Data sources are defined in `src/config/datasources.ts`.

---

## Plugins

### Time Series Plot *(implemented)*

Fetches and displays a spectral index time-series at the selected coordinate.

**Per-instance configuration:** data source, cloud masking on/off, Y-axis limits.

**Reads:** `coordinate`, `startDate`, `endDate`, `selectedDate`, `flags`, `flagLabels`.

**Writes:** `selectedDate` (on point click).

**Interactions:** clicking a data point sets `selectedDate`. Flags rendered as vertical dashed lines coloured by value using a stable palette from `flagLabels`.

---

### Flag Editor *(implemented)*

Singleton panel. Two sections: the selected date (assign/remove a flag from the `flagLabels` vocabulary) and a scrollable list of all flagged dates.

**Reads/Writes:** `selectedDate`, `flags`, `flagLabels`.

---

### Sentinel Hub Map *(implemented)*

Leaflet map showing a Sentinel Hub WMS tile layer for the selected date. A WMS instance is created automatically via the Sentinel Hub Configuration API on first use and cached in `localStorage`.

**Per-instance configuration:** layer (True Color / False Color).

**Reads:** `coordinate`, `selectedDate`.

---

### Esri Wayback Imagery *(implemented)*

Leaflet map showing historical very-high-resolution Esri World Imagery tiles. Detects all Wayback releases with local changes at the current coordinate via the Wayback tilemap API. Acquisition dates are fetched from the Esri metadata service and cached in `localStorage`. Duplicate acquisition dates are removed; the list is sorted newest-first.

**Reads:** `coordinate`.

---

### Campaign Map *(implemented)*

Leaflet map showing all sample points of the active labelling campaign as markers. Clicking a marker sets `coordinate` to that point. Markers are coloured by labelling status (unlabelled / complete).

The **Save & Next** button saves the current draft (`flags` + `sampleMeta`) to IDB and navigates to the next unlabelled sample. Save & Next is blocked when:
- `isEphemeral` is true (no IDB campaign to save into)
- `schemaMismatch` is true (URL schema differs from IDB schema)
- Required fields are missing

---

### Campaign Admin *(implemented)*

Panel for creating and configuring a labelling campaign schema: name, flag vocabulary, and field definitions. Applying the schema saves it to IDB and sets it as the active campaign.

---

### Campaign Upload / Export *(implemented)*

Utility panel for loading and saving campaign data:
- **Upload GeoJSON** — load a full campaign GeoJSON (with embedded schema) or a minimal point GeoJSON (coordinates + `sample_id`).
- **Export GeoJSON** — download the current campaign with all committed records.

---

### Labelling Form *(implemented)*

Dynamically generated form rendered from the active schema's `fields`. Displays and edits per-sample draft values (`sampleMeta` + `flags`) for the currently selected coordinate. Fields with `session_persistent: true` are pre-filled from the previous sample's saved value.

---

## Labelling Campaigns

### GeoJSON Format

The campaign is stored as a GeoJSON `FeatureCollection`. A custom top-level key `campaign` holds all metadata:

```json
{
  "type": "FeatureCollection",
  "campaign": {
    "name": "Forest Disturbance 2020",
    "startDate": "2017-01-01",
    "endDate": "2023-12-31",
    "flagLabels": {
      "1": "disturbance",
      "2": "recovery"
    },
    "fields": [
      { "key": "sample_id",   "label": "Sample ID",   "type": "display",  "required": true,  "session_persistent": false },
      { "key": "confidence",  "label": "Confidence",  "type": "select",   "options": ["High", "Medium", "Low"], "required": true,  "session_persistent": false },
      { "key": "comment",     "label": "Comment",     "type": "text",     "required": false, "session_persistent": false },
      { "key": "interpreter", "label": "Interpreter", "type": "text",     "required": false, "session_persistent": true }
    ]
  },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [11.146429, 48.920711] },
      "properties": {
        "sample_id": "plot_001",
        "flags": { "2020-07-13": "1" },
        "confidence": "High",
        "comment": "clear disturbance signal",
        "interpreter": "jdoe"
      }
    }
  ]
}
```

### Field Types

| Type | UI element | Notes |
|------|-----------|-------|
| `display` | read-only text | shows the property value for context; not editable |
| `text` | `<input type="text">` | free-form string |
| `select` | `<select>` | value must be one of `options` |

`session_persistent: true` fields are pre-filled from the previous sample's value so the user doesn't have to re-enter them for every point.

### Minimal Input GeoJSON

A new campaign can be started from a plain GeoJSON containing only point geometries and a `sample_id` property:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [11.146429, 48.920711] },
      "properties": { "sample_id": "plot_001" }
    }
  ]
}
```

### IDB Storage

Campaign data is stored in IndexedDB across three object stores:

| Store | Key | Value |
|-------|-----|-------|
| `campaign-schemas` | campaign name | `CampaignParams` |
| `campaign-features` | campaign name | `CampaignFeature[]` |
| `campaign-records` | campaign name | `Record<sample_id, SampleRecord>` |

Schema and features are written once on upload. Records are written on every Save & Next. Records are never stored in the URL — only the current draft for the selected sample is URL-encoded.

---

## Layout Presets

Layout presets are JSON files in `src/layout/json/`. Each file is a raw dockview `toJSON()` snapshot with an optional top-level `"name"` field. The file `default.json` is used as the fallback layout. Additional presets appear in the toolbar dropdown. Users can save a layout by exporting from the browser console (`copy(JSON.stringify(window.__dockview.toJSON(), null, 2))`) and adding the file to the directory.
