export interface PanelPlugin {
  /** Vue component name registered via app.component() */
  id: string
  /** Display name shown in the "Add Panel" menu */
  name: string
  /** If true, only one instance may be open at a time (uses id as panel id) */
  singleton: boolean
  defaultTitle: string
  defaultParams?: Record<string, unknown>
}

export const PANEL_PLUGINS: PanelPlugin[] = [
  {
    id: 'timeSeriesPanel',
    name: 'Time Series',
    singleton: false,
    defaultTitle: 'Time Series',
    defaultParams: { dataSourceId: 'S2_NDVI', maskClouds: true },
  },
  {
    id: 'flagEditorPanel',
    name: 'Flag Editor',
    singleton: true,
    defaultTitle: 'Flag Editor',
  },
  {
    id: 'mapPanel',
    name: 'Map',
    singleton: false,
    defaultTitle: 'Map',
  },
  {
    id: 'waybackPanel',
    name: 'Wayback Imagery',
    singleton: false,
    defaultTitle: 'Wayback',
  },
  {
    id: 'campaignMapPanel',
    name: 'Campaign Map',
    singleton: true,
    defaultTitle: 'Campaign Map',
  },
  {
    id: 'campaignAdminPanel',
    name: 'Campaign Admin',
    singleton: true,
    defaultTitle: 'Campaign Admin',
  },
  {
    id: 'campaignUploadPanel',
    name: 'Campaign Upload / Export',
    singleton: true,
    defaultTitle: 'Upload / Export',
  },
  {
    id: 'labellingFormPanel',
    name: 'Labelling Form',
    singleton: true,
    defaultTitle: 'Labelling Form',
  },
]
