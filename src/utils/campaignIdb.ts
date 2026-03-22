import type { CampaignFeature, CampaignParams, SampleRecord } from '../types/campaign'

const DB_NAME = 'cdse-tsbrowser'
const DB_VERSION = 3  // bumped to add campaign-schemas store

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('campaign-features')) {
        db.createObjectStore('campaign-features')
      }
      if (!db.objectStoreNames.contains('campaign-records')) {
        db.createObjectStore('campaign-records')
      }
      if (!db.objectStoreNames.contains('campaign-schemas')) {
        db.createObjectStore('campaign-schemas')
      }
    }
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror  = (e) => reject((e.target as IDBOpenDBRequest).error)
  })
}

// ── Schemas ──────────────────────────────────────────────────────────────────

export async function saveCampaignSchema(name: string, params: CampaignParams): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-schemas', 'readwrite')
    tx.objectStore('campaign-schemas').put(params, name)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror   = () => { db.close(); reject(tx.error) }
  })
}

export async function loadCampaignSchema(name: string): Promise<CampaignParams | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-schemas', 'readonly')
    const req = tx.objectStore('campaign-schemas').get(name)
    req.onsuccess = () => { db.close(); resolve((req.result as CampaignParams) ?? null) }
    req.onerror  = () => { db.close(); reject(req.error) }
  })
}

export async function listCampaignNames(): Promise<string[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-schemas', 'readonly')
    const req = tx.objectStore('campaign-schemas').getAllKeys()
    req.onsuccess = () => { db.close(); resolve(req.result as string[]) }
    req.onerror  = () => { db.close(); reject(req.error) }
  })
}

// ── Features ────────────────────────────────────────────────────────────────

export async function saveCampaignFeatures(name: string, features: CampaignFeature[]): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-features', 'readwrite')
    tx.objectStore('campaign-features').put(features, name)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror   = () => { db.close(); reject(tx.error) }
  })
}

export async function loadCampaignFeatures(name: string): Promise<CampaignFeature[] | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-features', 'readonly')
    const req = tx.objectStore('campaign-features').get(name)
    req.onsuccess = () => { db.close(); resolve((req.result as CampaignFeature[]) ?? null) }
    req.onerror  = () => { db.close(); reject(req.error) }
  })
}

// ── Records (labelling results) ──────────────────────────────────────────────

export async function saveCampaignRecords(name: string, records: Record<string, SampleRecord>): Promise<void> {
  // JSON round-trip strips Vue reactive proxies so IDB structured clone doesn't throw
  const plain = JSON.parse(JSON.stringify(records)) as Record<string, SampleRecord>
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-records', 'readwrite')
    tx.objectStore('campaign-records').put(plain, name)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror   = () => { db.close(); console.error('[IDB] saveCampaignRecords error', tx.error); reject(tx.error) }
  })
}

export async function loadCampaignRecords(name: string): Promise<Record<string, SampleRecord> | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('campaign-records', 'readonly')
    const req = tx.objectStore('campaign-records').get(name)
    req.onsuccess = () => { db.close(); resolve((req.result as Record<string, SampleRecord>) ?? null) }
    req.onerror  = () => { db.close(); reject(req.error) }
  })
}
