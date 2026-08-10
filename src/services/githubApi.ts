/**
 * GitHub Contents API access for campaign files.
 *
 * A campaign lives as a single GeoJSON file in a repository, and that one file
 * is both the schema and the labelling results. Reads go through the Contents
 * API so the same request yields the blob sha, which is what the write path
 * needs for optimistic concurrency — the sha is the only thing standing between
 * two labellers and a silently overwritten commit.
 *
 * Both endpoints send permissive CORS headers, so no proxy is involved.
 */

import type { GithubSource } from '../types/campaign'

const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'

/** Contents API refuses to inline a file above this size; the blob API handles it. */
const CONTENTS_INLINE_LIMIT = 1024 * 1024

export type GithubErrorKind = 'auth' | 'notfound' | 'conflict' | 'ratelimit' | 'network' | 'other'

export class GithubError extends Error {
  constructor(
    message: string,
    readonly kind: GithubErrorKind,
    readonly status = 0,
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

// ── Source specs ─────────────────────────────────────────────────────────────
//
// Wire format: owner/repo[@ref]:path
//
// The path is split off at the *first* colon, which works because git refs
// cannot contain a colon while paths (rarely) can contain an '@'.

/** Parse `owner/repo[@ref]:path`. Returns null when the spec is malformed. */
export function parseSourceSpec(spec: string): GithubSource | null {
  const trimmed = spec.trim()
  const colon = trimmed.indexOf(':')
  if (colon < 0) return null

  const repoPart = trimmed.slice(0, colon)
  const path = trimmed.slice(colon + 1).replace(/^\/+/, '')
  if (!path) return null

  const at = repoPart.indexOf('@')
  const ownerRepo = at < 0 ? repoPart : repoPart.slice(0, at)
  const ref = at < 0 ? undefined : repoPart.slice(at + 1) || undefined

  const [owner, repo, ...rest] = ownerRepo.split('/')
  if (!owner || !repo || rest.length > 0) return null

  return { owner, repo, path, ...(ref ? { ref } : {}) }
}

/** Inverse of {@link parseSourceSpec}. The blob sha is local state and is never included. */
export function formatSourceSpec(src: GithubSource): string {
  const ref = src.ref ? `@${src.ref}` : ''
  return `${src.owner}/${src.repo}${ref}:${src.path}`
}

/** Browser URL for a source, for "view on GitHub" links. */
export function sourceWebUrl(src: GithubSource): string {
  return `https://github.com/${src.owner}/${src.repo}/blob/${src.ref ?? 'HEAD'}/${src.path}`
}

// ── Base64 (UTF-8 safe) ──────────────────────────────────────────────────────

function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  // Chunked so a large campaign doesn't blow the argument limit of fromCharCode
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// ── Requests ─────────────────────────────────────────────────────────────────

function headers(token?: string, accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': API_VERSION,
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new GithubError('Could not reach GitHub — check your connection.', 'network')
  }
}

/** Turn a failed response into a GithubError with a message worth showing a user. */
async function toError(res: Response, src: GithubSource, authed: boolean): Promise<GithubError> {
  let detail = ''
  try {
    const body = await res.json() as { message?: string }
    detail = body.message ?? ''
  } catch { /* non-JSON error body */ }

  const where = `${src.owner}/${src.repo}/${src.path}`

  if (res.status === 401) {
    return new GithubError('GitHub rejected the token — it may be expired or mistyped.', 'auth', 401)
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null
    return new GithubError(
      authed
        ? `GitHub rate limit reached${mins ? `; retry in ~${mins} min` : ''}.`
        : `GitHub rate limit reached for unauthenticated requests${mins ? `; retry in ~${mins} min` : ''}. Adding a token raises the limit substantially.`,
      'ratelimit',
      403,
    )
  }
  if (res.status === 403) {
    return new GithubError(
      detail || 'GitHub denied the request — the token may lack Contents write access to this repository.',
      'auth',
      403,
    )
  }
  if (res.status === 404) {
    return new GithubError(
      authed
        ? `Not found: ${where}. Check the path and ref, and that the token can see this repository.`
        : `Not found: ${where}. If the repository is private, connect a token first.`,
      'notfound',
      404,
    )
  }
  if (res.status === 409 || res.status === 422) {
    return new GithubError(
      detail || 'The file changed on GitHub since it was last pulled.',
      'conflict',
      res.status,
    )
  }
  return new GithubError(detail || `GitHub request failed (HTTP ${res.status}).`, 'other', res.status)
}

export interface FetchedFile {
  text: string
  /** Blob sha — pass back on write to detect a concurrent change. */
  sha: string
}

/**
 * Fetch a campaign file's contents.
 *
 * Files over 1 MB come back from the Contents API with an empty body and
 * `encoding: 'none'`, so those fall through to the blob API, which serves up to
 * 100 MB. A campaign with a few thousand points lands in that second case.
 */
export async function fetchCampaignFile(src: GithubSource, token?: string): Promise<FetchedFile> {
  const query = src.ref ? `?ref=${encodeURIComponent(src.ref)}` : ''
  const url = `${API_BASE}/repos/${src.owner}/${src.repo}/contents/${encodePath(src.path)}${query}`

  const res = await request(url, { headers: headers(token) })
  if (!res.ok) throw await toError(res, src, !!token)

  const body = await res.json() as {
    type?: string
    content?: string
    encoding?: string
    sha: string
    size?: number
  }

  if (body.type && body.type !== 'file') {
    throw new GithubError(`${src.path} is a ${body.type}, not a file.`, 'other', res.status)
  }

  if (body.encoding === 'base64' && body.content) {
    return { text: decodeBase64(body.content), sha: body.sha }
  }

  // Too large to inline (or served without content) — fetch the raw blob.
  if (body.encoding === 'none' || !body.content || (body.size ?? 0) > CONTENTS_INLINE_LIMIT) {
    const blobUrl = `${API_BASE}/repos/${src.owner}/${src.repo}/git/blobs/${body.sha}`
    const blobRes = await request(blobUrl, { headers: headers(token, 'application/vnd.github.raw') })
    if (!blobRes.ok) throw await toError(blobRes, src, !!token)
    return { text: await blobRes.text(), sha: body.sha }
  }

  throw new GithubError(`Unexpected encoding "${body.encoding}" for ${src.path}.`, 'other', res.status)
}

/**
 * Write a campaign file back.
 *
 * `src.sha` must be the sha from the last fetch: GitHub rejects the write when
 * the file has moved on since, which surfaces as a `conflict` error rather than
 * a lost commit. Omit it only when creating the file for the first time.
 *
 * Returns the new blob sha.
 */
export async function putCampaignFile(
  src: GithubSource,
  text: string,
  message: string,
  token: string,
): Promise<string> {
  const url = `${API_BASE}/repos/${src.owner}/${src.repo}/contents/${encodePath(src.path)}`

  const res = await request(url, {
    method: 'PUT',
    headers: { ...headers(token) as Record<string, string>, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      ...(src.sha ? { sha: src.sha } : {}),
      ...(src.ref ? { branch: src.ref } : {}),
    }),
  })

  if (!res.ok) throw await toError(res, src, true)

  const body = await res.json() as { content?: { sha?: string } }
  const sha = body.content?.sha
  if (!sha) throw new GithubError('GitHub accepted the commit but returned no sha.', 'other', res.status)
  return sha
}

/** Validate a token and return the account login it belongs to. */
export async function fetchLogin(token: string): Promise<string> {
  const res = await request(`${API_BASE}/user`, { headers: headers(token) })
  if (!res.ok) {
    if (res.status === 401) throw new GithubError('GitHub rejected the token — it may be expired or mistyped.', 'auth', 401)
    throw new GithubError(`Could not verify the token (HTTP ${res.status}).`, 'other', res.status)
  }
  const body = await res.json() as { login?: string }
  if (!body.login) throw new GithubError('GitHub returned no account for this token.', 'other', res.status)
  return body.login
}

/** Percent-encode each path segment, leaving the separators intact. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
