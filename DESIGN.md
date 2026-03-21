# CDSE-TSBROWSER

A browser-based interface for viewing and labelling satellite time-series. The primary use-case is sharing a URL with a user so they can open the app, connect with their own CDSE credentials, and view a time-series at a pre-specified location and date range alongside any existing labels.

The app runs entirely in the browser (no backend). It uses **Vue 3** + **Vite** for the frontend framework and build tooling, **dockview** for the panel layout, and fetches satellite data from the **Copernicus Dataspace Ecosystem (CDSE)** using credentials provided by the user.

---

## URL Schema

The URL encodes the session state so it can be shared. All parameter names are lowercase. Scalar fields are plain query parameters. Structured fields are URL-encoded JSON (not base64) so they remain inspectable in browser DevTools. JSON keys within structured fields use camelCase.

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `lon` | float | Longitude of the current sample point |
| `lat` | float | Latitude of the current sample point |
| `start` | date | Time-series start date (YYYY-MM-DD) |
| `end` | date | Time-series end date (YYYY-MM-DD) |
| `selected` | date | Currently selected date |
| `sample` | JSON | Per-sample observation data (flags, field values) |
| `campaign` | JSON | Campaign schema (name, flag vocabulary, field definitions) |

`start` and `end` are always top-level params — both for single-sample and campaign URLs. The campaign's date range is expressed via the same params.

### Single-sample URL

Used for sharing a pre-configured single observation point.

```
https://example.com/?
  lon=11.146429&
  lat=48.920711&
  start=2017-01-01&
  end=2023-12-31&
  selected=2020-07-13&
  sample={"flags":{"2018-02-14":"1","2020-07-13":"1"},"flagLabels":{"1":"disturbance","2":"recovery"},"comment":"bark beetle 2020","interpreter":"jdoe"}
```

### Campaign URL

When a labelling campaign is active, `campaign` encodes the schema. Per-sample labelled data is stored in `localStorage` keyed by campaign name and is not in the URL.

```
https://example.com/?
  lon=11.146429&
  lat=48.920711&
  start=2017-01-01&
  end=2023-12-31&
  campaign={"name":"Forest Disturbance 2020","flagLabels":{"1":"disturbance","2":"recovery"},"fields":[...]}
```

### Combined URL

A `sample` and `campaign` param may appear together. In this case `sample` is the authoritative observation data and is displayed as-is; `campaign` contributes only the schema (flag vocabulary, field definitions for display). localStorage is not consulted. This is useful for sharing a specific observation within a campaign context.

```
https://example.com/?
  lon=11.146429&lat=48.920711&start=2017-01-01&end=2023-12-31&selected=2020-07-13&
  sample={"flags":{"2020-07-13":"1"},"comment":"bark beetle"}&
  campaign={"name":"Forest Disturbance 2020","flagLabels":{"1":"disturbance","2":"recovery"},"fields":[...]}
```

If only `campaign` is present (no `sample`), per-sample data is loaded from localStorage for the current coordinate.

On campaign file upload, `campaign`, `start`, and `end` in the URL are updated to reflect the loaded campaign schema, making the post-upload state bookmarkable and shareable.

If neither `sample` nor `campaign` is present, any existing observation data is displayed read-only.

---

## Architecture

The app is plugin-based. Each plugin instance occupies its own dockview panel. Plugins read from and write to a shared global state store (Pinia). The layout is managed by dockview and persisted in `localStorage` as a JSON snapshot. Layout presets are defined as JSON files in `src/layout/json/` and selectable from a toolbar dropdown.

### Global State

```
coordinate:    [lon: float, lat: float]
selectedDate:  date | null
startDate:     date
endDate:       date
flags:         { [date: string]: string }
flagLabels:    { [value: string]: string }
```

When a campaign is active, `flagLabels`, `startDate`, and `endDate` are driven by the campaign schema rather than the `sample` URL param.

### CDSE Authentication

Satellite data is fetched from CDSE using **OAuth2 client credentials** (client ID + client secret). Credentials are entered via the **Connect** button in the toolbar and stored in browser memory for the session (never serialised into the URL). The access token is automatically refreshed before expiry. All CDSE and Esri Wayback APIs support CORS from any origin; the Vite dev-server proxy is only used during local development to avoid localhost-specific CORS restrictions.

---

## Toolbar

The toolbar is intentionally minimal. Coordinates and date range are configured via the URL rather than UI inputs.

**Contents (left to right):**
- App title
- Layout preset selector (dropdown)
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

### Campaign Map *(planned)*

Leaflet map showing all sample points of the active labelling campaign as markers. Clicking a marker sets `coordinate` to that point, triggering all other plugins to update. Markers are coloured by labelling status (unlabelled / partially labelled / complete).

---

### Campaign Admin *(planned)*

Panel for creating and configuring a labelling campaign. Contains:
- Campaign name, start date, end date
- Flag lookup table editor (shorthand code → description)
- User-defined field schema editor (see Campaign section below)

Updates `campaign`, `start`, and `end` in the URL on every change.

---

### Campaign Upload / Export *(planned)*

Utility panel for loading and saving campaign data:
- **Upload GeoJSON** — load a minimal point GeoJSON (coordinates + `sample_id`) to start a new campaign, or load an existing labelled campaign GeoJSON to resume work. Updates `campaignParams` in the URL.
- **Export GeoJSON** — download the current campaign as a GeoJSON file.

---

### Labelling Form *(planned)*

A dynamically generated form rendered from the campaign's field schema. Displays and edits per-sample properties for the currently selected coordinate. Fields with `session_persistent: true` (e.g. `interpreter`) are pre-filled from the previous value.

---

## Labelling Campaigns

### Overview

A labelling campaign organises work across many sample points. It extends the single-sample URL approach: the campaign schema (metadata + field definitions) lives in `campaignParams` in the URL; per-sample labelled data lives in `localStorage` keyed by campaign name.

### GeoJSON Format

The campaign is stored as a GeoJSON `FeatureCollection`. A custom top-level key `campaign` holds all metadata to avoid conflicting with the GeoJSON spec:

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

All other properties are initialised to `null` on load.

### `campaign` URL Encoding

The campaign schema (not the per-sample data) is URL-encoded JSON in the `campaign` query parameter. Date range is always expressed via the top-level `start` and `end` params.

```json
{
  "name": "Forest Disturbance 2020",
  "flagLabels": { "1": "disturbance", "2": "recovery" },
  "fields": [...]
}
```

Per-sample data is stored in `localStorage` under the key `cdse-ts-campaign-{name}`. On export, the schema and localStorage data are merged into the full GeoJSON. On upload, `campaign`, `start`, and `end` in the URL are updated to reflect the loaded campaign schema.

### Workflow

1. User opens app with a `campaign` URL, or uploads a GeoJSON via the Campaign Upload panel.
2. The Campaign Map shows all sample points, coloured by labelling status.
3. User clicks a point → `coordinate` is set → all other panels (time-series, S2 map, Wayback) update for that location. The campaign's `startDate`/`endDate` are used as the time-series range.
4. User assigns flags via the Flag Editor and fills in the Labelling Form.
5. Data is auto-saved to `localStorage` on every change.
6. When done, user exports the full GeoJSON from the Campaign Upload/Export panel.

---

## Layout Presets

Layout presets are JSON files in `src/layout/json/`. Each file is a raw dockview `toJSON()` snapshot with an optional top-level `"name"` field. The file `default.json` is used as the fallback layout. Additional presets appear in the toolbar dropdown. Users can save a layout by exporting from the browser console (`copy(JSON.stringify(window.__dockview.toJSON(), null, 2))`) and adding the file to the directory.

A separate **Campaign** layout preset will be defined once the campaign plugins are implemented, containing the Campaign Map, Campaign Admin, Campaign Upload/Export, Time Series Plot, and Labelling Form panels.
