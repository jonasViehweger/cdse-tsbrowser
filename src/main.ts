import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/themes.css'
import App from './App.vue'
import { useAuthStore } from './stores/auth'
import { fetchToken } from './services/auth'
import { useCampaignStore } from './stores/campaign'
import { useGithubStore } from './stores/github'
import { useAppStore } from './stores/app'
import { parseUrl } from './utils/url'
import TimeSeriesPanel from './plugins/timeSeries/TimeSeriesPanel.vue'
import FlagEditorPanel from './plugins/flagEditor/FlagEditorPanel.vue'
import MapPanel from './plugins/map/MapPanel.vue'
import WaybackPanel from './plugins/wayback/WaybackPanel.vue'
import CampaignMapPanel from './plugins/campaign/CampaignMapPanel.vue'
import CampaignAdminPanel from './plugins/campaign/CampaignAdminPanel.vue'
import CampaignUploadPanel from './plugins/campaign/CampaignUploadPanel.vue'
import CampaignGithubPanel from './plugins/campaignGithub/CampaignGithubPanel.vue'
import LabellingFormPanel from './plugins/campaign/LabellingFormPanel.vue'
import CoordinateInputPanel from './plugins/coordinateInput/CoordinateInputPanel.vue'
import PanelSettingsButton from './components/PanelSettingsButton.vue'

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
  app.component('campaignGithubPanel', CampaignGithubPanel)
  app.component('labellingFormPanel', LabellingFormPanel)
  app.component('coordinateInputPanel', CoordinateInputPanel)
  app.component('panelSettingsButton', PanelSettingsButton)

  const authStore = useAuthStore()

  // Load persisted credentials (localStorage), then allow dev env to override.
  authStore.loadPersisted()
  const devClientId = import.meta.env.VITE_CDSE_CLIENT_ID as string | undefined
  const devClientSecret = import.meta.env.VITE_CDSE_CLIENT_SECRET as string | undefined
  if (devClientId && devClientSecret) {
    authStore.setCredentials(devClientId, devClientSecret)
  }

  // Auto-fetch token if credentials are available (persisted or dev).
  if (authStore.clientId && authStore.clientSecret) {
    await fetchToken(authStore.clientId, authStore.clientSecret).catch(() => {})
  }

  // If a campaign is referenced in the URL, load all its data
  // *before* mounting so components see correct state immediately (no races).
  const parsed = parseUrl(window.location.search)
  const campaignStore = useCampaignStore()
  const githubStore = useGithubStore()

  githubStore.init()

  let loadedFromGithub = false
  if (parsed.github) {
    // Local labels win over the file's, so a session that never got pushed
    // isn't silently thrown away by opening the link again.
    loadedFromGithub = await githubStore.pull(parsed.github).then(() => true).catch(() => false)
    // A campaign opened straight from a link has no coordinate yet.
    if (loadedFromGithub && parsed.lon == null && parsed.lat == null && campaignStore.features.length > 0) {
      const [lon, lat] = campaignStore.features[0].geometry.coordinates
      useAppStore().setCoordinate(lon, lat)
    }
  }

  if (!loadedFromGithub && parsed.schema?.campaign) {
    const urlSchema = {
      name:       parsed.schema.campaign,
      flagLabels: parsed.schema.flagLabels,
      fields:     parsed.schema.fields,
    }
    const found = await campaignStore.loadFromIdb(parsed.schema.campaign, urlSchema).catch(() => false)
    if (found) {
      // Reconnect the campaign to its GitHub file, if it has one.
      await githubStore.restoreSource(parsed.schema.campaign)
    } else {
      // Campaign not in IDB — load ephemerally from URL schema
      campaignStore.loadEphemeral(urlSchema)
    }
  }

  app.mount('#app')
}

init()
