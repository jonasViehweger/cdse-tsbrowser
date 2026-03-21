import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/themes.css'
import App from './App.vue'
import { useAuthStore } from './stores/auth'
import { useCampaignStore } from './stores/campaign'
import { saveCampaignSchema } from './utils/campaignIdb'
import { parseUrl } from './utils/url'
import TimeSeriesPanel from './plugins/timeSeries/TimeSeriesPanel.vue'
import FlagEditorPanel from './plugins/flagEditor/FlagEditorPanel.vue'
import MapPanel from './plugins/map/MapPanel.vue'
import WaybackPanel from './plugins/wayback/WaybackPanel.vue'
import CampaignMapPanel from './plugins/campaign/CampaignMapPanel.vue'
import CampaignAdminPanel from './plugins/campaign/CampaignAdminPanel.vue'
import CampaignUploadPanel from './plugins/campaign/CampaignUploadPanel.vue'
import LabellingFormPanel from './plugins/campaign/LabellingFormPanel.vue'

async function init() {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // dockview-vue resolves panel components by name via Vue's component registry
  app.component('timeSeriesPanel', TimeSeriesPanel)
  app.component('flagEditorPanel', FlagEditorPanel)
  app.component('mapPanel', MapPanel)
  app.component('waybackPanel', WaybackPanel)
  app.component('campaignMapPanel', CampaignMapPanel)
  app.component('campaignAdminPanel', CampaignAdminPanel)
  app.component('campaignUploadPanel', CampaignUploadPanel)
  app.component('labellingFormPanel', LabellingFormPanel)

  // Pre-populate credentials from .env.local during development
  const devClientId = import.meta.env.VITE_CDSE_CLIENT_ID as string | undefined
  const devClientSecret = import.meta.env.VITE_CDSE_CLIENT_SECRET as string | undefined
  if (devClientId && devClientSecret) {
    useAuthStore().setCredentials(devClientId, devClientSecret)
  }

  // If a campaign is referenced in the URL, load all its data from IDB
  // *before* mounting so components see correct state immediately (no races).
  const parsed = parseUrl(window.location.search)
  if (parsed.campaignName) {
    // Legacy URL: full schema embedded — seed IDB so loadFromIdb finds it
    if (parsed.legacyCampaignSchema) {
      await saveCampaignSchema(parsed.legacyCampaignSchema.name, parsed.legacyCampaignSchema)
        .catch(() => {})
    }
    await useCampaignStore().loadFromIdb(parsed.campaignName).catch(() => {})
  }

  app.mount('#app')
}

init()
