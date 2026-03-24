import { getValidToken } from './auth'

const INSTANCE_NAME = 'CDSE TS Browser'
const INSTANCE_ID_KEY = 'cdse-ts-browser-wms-instance-id'

const INSTANCES_URL = `${import.meta.env.VITE_API_BASE}/api/v2/configuration/instances`
const LAYERS_URL = (id: string) => `${import.meta.env.VITE_API_BASE}/api/v2/configuration/instances/${id}/layers`

interface WmsInstance { id: string; name: string; domainAccountId: string }

/** Extract domainAccountId from the JWT user_context claim ("default-<uuid>"). */
function domainAccountIdFromToken(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.user_context_id as string
  } catch {
    throw new Error('Could not decode domainAccountId from access token')
  }
}

async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidToken()
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${body}`)
  }
  return res
}

async function listInstances(domainAccountId: string): Promise<WmsInstance[]> {
  const res = await authed(`${INSTANCES_URL}?domainAccountId=${domainAccountId}`)
  return res.json()
}

async function createInstance(domainAccountId: string): Promise<string> {
  const res = await authed(INSTANCES_URL, {
    method: 'POST',
    body: JSON.stringify({
      name: INSTANCE_NAME,
      description: 'Created by CDSE TS Browser',
      domainAccountId,
      additionalData: { showWarnings: false, showLogo: false, imageQuality: 90 },
    }),
  })
  const data = await res.json() as { id: string }
  return data.id
}

const TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ['B04','B03','B02','dataMask'], output: { bands: 4 } };
}
const maxR=3.0, midR=0.13, sat=1.2, gamma=1.8;
function evaluatePixel(s) {
  const rgbLin = satEnh(sAdj(s.B04), sAdj(s.B03), sAdj(s.B02));
  return [sRGB(rgbLin[0]), sRGB(rgbLin[1]), sRGB(rgbLin[2]), s.dataMask];
}
function sAdj(a) { return adjGamma(adj(a,midR,1,maxR)); }
const gOff=0.01, gOffPow=Math.pow(gOff,gamma), gOffRange=Math.pow(1+gOff,gamma)-gOffPow;
function adjGamma(b) { return (Math.pow((b+gOff),gamma)-gOffPow)/gOffRange; }
function satEnh(r,g,b) { const a=(r+g+b)/3*(1-sat); return [clip(a+r*sat),clip(a+g*sat),clip(a+b*sat)]; }
function clip(s) { return s<0?0:s>1?1:s; }
function adj(a,tx,ty,maxC) { var ar=clip(a/maxC,0,1); return ar*(ar*(tx/maxC+ty-1)-ty)/(ar*(2*tx/maxC-1)-tx/maxC); }
const sRGB=(c)=>c<=0.0031308?(12.92*c):(1.055*Math.pow(c,0.41666666666)-0.055);`

const FALSE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ['B08','B04','B03','dataMask'], output: { bands: 4 } };
}
function evaluatePixel(s) {
  return [2.5*s.B08, 2.5*s.B04, 2.5*s.B03, s.dataMask];
}`

const NDVI_EVALSCRIPT = `//VERSION=3
function setup() {
   return {
      input: ["B04", "B08", "dataMask"],
      output: { bands: 4 }
   };
}

const ramp = [
   [-0.5, 0x0c0c0c],
   [-0.2, 0xbfbfbf],
   [-0.1, 0xdbdbdb],
   [0, 0xeaeaea],
   [0.025, 0xfff9cc],
   [0.05, 0xede8b5],
   [0.075, 0xddd89b],
   [0.1, 0xccc682],
   [0.125, 0xbcb76b],
   [0.15, 0xafc160],
   [0.175, 0xa3cc59],
   [0.2, 0x91bf51],
   [0.25, 0x7fb247],
   [0.3, 0x70a33f],
   [0.35, 0x609635],
   [0.4, 0x4f892d],
   [0.45, 0x3f7c23],
   [0.5, 0x306d1c],
   [0.55, 0x216011],
   [0.6, 0x0f540a],
   [1, 0x004400],
];

const visualizer = new ColorRampVisualizer(ramp);

function evaluatePixel(samples) {
   let ndvi = index(samples.B08, samples.B04);
   let imgVals = visualizer.process(ndvi);
   return imgVals.concat(samples.dataMask)
}
`

const NDMI_EVALSCRIPT = `//VERSION=3
const moistureRamps = [
   [-0.8, 0x800000],
   [-0.24, 0xff0000],
   [-0.032, 0xffff00],
   [0.032, 0x00ffff],
   [0.24, 0x0000ff],
   [0.8, 0x000080]
];

const viz = new ColorRampVisualizer(moistureRamps);

function setup() {
   return {
      input: ["B8A", "B11", "dataMask"],
      output: { bands: 4 }
   };
}

function evaluatePixel(samples) {
   let val = index(samples.B8A, samples.B11);
   let imgVals = viz.process(val);
   return imgVals.concat(samples.dataMask);
}
`

const SWIR_FALSE_COLOR = `//VERSION=3
function setup() {
  return { input: [{bands: ['B08','B04','B11','dataMask'], units: 'DN'}], output: { bands: 4 } };
}
function evaluatePixel(s) {
  return [s.B11/5000, s.B08/6000, s.B04/2000, s.dataMask];
}
`

function layerBody(instanceId: string, id: string, title: string, evalScript: string) {
  return {
    id,
    title,
    description: '',
    instanceId,
    datasetSourceId: 2,
    collectionType: 'S2L2A',
    defaultStyleName: 'default',
    datasourceDefaults: { type: 'S2L2A', mosaickingOrder: 'mostRecent', maxCloudCoverage: 100 },
    styles: [{ name: 'default', description: 'Default layer style', evalScript }],
  }
}

async function addLayers(instanceId: string): Promise<void> {
  await authed(LAYERS_URL(instanceId), {
    method: 'POST',
    body: JSON.stringify(layerBody(instanceId, 'TRUE-COLOR', 'True Color', TRUE_COLOR_EVALSCRIPT)),
  })
  await authed(LAYERS_URL(instanceId), {
    method: 'POST',
    body: JSON.stringify(layerBody(instanceId, 'FALSE-COLOR', 'False Color (B08, B04, B03)', FALSE_COLOR_EVALSCRIPT)),
  })
  await authed(LAYERS_URL(instanceId), {
    method: 'POST',
    body: JSON.stringify(layerBody(instanceId, 'SWIR_FALSE_COLOR', 'False Color (B11, B08, B04)', FALSE_COLOR_EVALSCRIPT)),
  })
  await authed(LAYERS_URL(instanceId), {
    method: 'POST',
    body: JSON.stringify(layerBody(instanceId, 'NDVI_EVALSCRIPT', 'NDVI', FALSE_COLOR_EVALSCRIPT)),
  })
  await authed(LAYERS_URL(instanceId), {
    method: 'POST',
    body: JSON.stringify(layerBody(instanceId, 'NDMI_EVALSCRIPT', 'NDMI', FALSE_COLOR_EVALSCRIPT)),
  })
}

/**
 * Returns the WMS instance ID for this app, creating it if it does not exist.
 * The result is cached in localStorage so subsequent calls are free.
 */
export async function ensureWmsInstance(): Promise<string> {
  const cached = localStorage.getItem(INSTANCE_ID_KEY)
  if (cached) return cached

  const token = await getValidToken()
  const domainAccountId = domainAccountIdFromToken(token)

  const instances = await listInstances(domainAccountId)
  const existing = instances.find(i => i.name === INSTANCE_NAME)

  const instanceId = existing ? existing.id : await createInstance(domainAccountId)
  if (!existing) await addLayers(instanceId)

  localStorage.setItem(INSTANCE_ID_KEY, instanceId)
  return instanceId
}
