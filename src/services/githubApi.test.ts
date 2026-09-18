import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseSourceSpec,
  formatSourceSpec,
  sourceWebUrl,
  fetchCampaignFile,
  putCampaignFile,
  parseRepoInput,
  resolveRefAndPath,
  listBranches,
  listCampaignFiles,
  fetchDefaultBranch,
  GithubError,
} from './githubApi'

// ── Source specs ─────────────────────────────────────────────────────────────

describe('parseSourceSpec', () => {
  it('parses owner/repo@ref:path', () => {
    expect(parseSourceSpec('acme/campaigns@main:forest/2020.geojson')).toEqual({
      owner: 'acme', repo: 'campaigns', ref: 'main', path: 'forest/2020.geojson',
    })
  })

  it('leaves ref undefined when omitted', () => {
    expect(parseSourceSpec('acme/campaigns:c.geojson')).toEqual({
      owner: 'acme', repo: 'campaigns', path: 'c.geojson',
    })
  })

  it('keeps slashes in branch names', () => {
    expect(parseSourceSpec('acme/repo@feat/new-labels:c.geojson')?.ref).toBe('feat/new-labels')
  })

  it('allows an @ inside the path', () => {
    const src = parseSourceSpec('acme/repo@main:dir/v@2/c.geojson')
    expect(src?.ref).toBe('main')
    expect(src?.path).toBe('dir/v@2/c.geojson')
  })

  it('strips leading slashes from the path', () => {
    expect(parseSourceSpec('acme/repo:/c.geojson')?.path).toBe('c.geojson')
  })

  it('rejects malformed specs', () => {
    expect(parseSourceSpec('acme/repo')).toBeNull()          // no path
    expect(parseSourceSpec('acme:c.geojson')).toBeNull()     // no repo
    expect(parseSourceSpec('a/b/c:c.geojson')).toBeNull()    // too many segments
    expect(parseSourceSpec('acme/repo:')).toBeNull()         // empty path
    expect(parseSourceSpec('')).toBeNull()
  })

  it('round-trips through formatSourceSpec', () => {
    for (const spec of ['acme/repo@main:c.geojson', 'acme/repo:dir/c.geojson']) {
      expect(formatSourceSpec(parseSourceSpec(spec)!)).toBe(spec)
    }
  })

  it('omits the blob sha when formatting', () => {
    const spec = formatSourceSpec({ owner: 'a', repo: 'b', path: 'c.geojson', ref: 'main', sha: 'deadbeef' })
    expect(spec).toBe('a/b@main:c.geojson')
  })

  it('builds a web url, defaulting the ref to HEAD', () => {
    expect(sourceWebUrl({ owner: 'a', repo: 'b', path: 'c.geojson' }))
      .toBe('https://github.com/a/b/blob/HEAD/c.geojson')
  })
})

// ── Fetch / put ──────────────────────────────────────────────────────────────

const SRC = { owner: 'acme', repo: 'campaigns', path: 'dir/c.geojson', ref: 'main' }

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

afterEach(() => { vi.unstubAllGlobals() })

describe('fetchCampaignFile', () => {
  it('decodes base64 content and returns the sha', async () => {
    const text = '{"campaign":"Wälder"}'   // non-ASCII: exercises the UTF-8 path
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ type: 'file', encoding: 'base64', content, sha: 'abc123', size: text.length })
    )
    vi.stubGlobal('fetch', fetchMock)

    const file = await fetchCampaignFile(SRC)
    expect(file).toEqual({ text, sha: 'abc123' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://api.github.com/repos/acme/campaigns/contents/dir/c.geojson?ref=main')
  })

  it('sends the token as a bearer header when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ type: 'file', encoding: 'base64', content: btoa('{}'), sha: 's' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchCampaignFile(SRC, 'tok')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('falls back to the blob API for files too large to inline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ type: 'file', encoding: 'none', content: '', sha: 'big1' }))
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => '{"big":true}',
      } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const file = await fetchCampaignFile(SRC)
    expect(file).toEqual({ text: '{"big":true}', sha: 'big1' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/acme/campaigns/git/blobs/big1')
  })

  it('reports a missing file as notfound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404)))
    await expect(fetchCampaignFile(SRC)).rejects.toMatchObject({ kind: 'notfound', status: 404 })
  })

  it('distinguishes a rate limit from a permission failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ message: 'rate limit' }, 403, { 'x-ratelimit-remaining': '0' })
    ))
    await expect(fetchCampaignFile(SRC)).rejects.toMatchObject({ kind: 'ratelimit' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Forbidden' }, 403)))
    await expect(fetchCampaignFile(SRC)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('reports a bad token as auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, 401)))
    await expect(fetchCampaignFile(SRC)).rejects.toMatchObject({ kind: 'auth', status: 401 })
  })

  it('surfaces a network failure rather than throwing raw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))
    await expect(fetchCampaignFile(SRC)).rejects.toBeInstanceOf(GithubError)
    await expect(fetchCampaignFile(SRC)).rejects.toMatchObject({ kind: 'network' })
  })
})

// ── Browsing ─────────────────────────────────────────────────────────────────

describe('parseRepoInput', () => {
  it('accepts a bare owner/repo', () => {
    expect(parseRepoInput('acme/campaigns')).toEqual({ owner: 'acme', repo: 'campaigns' })
  })

  it('accepts a repo URL, with or without scheme and .git', () => {
    expect(parseRepoInput('https://github.com/acme/campaigns')).toEqual({ owner: 'acme', repo: 'campaigns' })
    expect(parseRepoInput('github.com/acme/campaigns.git')).toEqual({ owner: 'acme', repo: 'campaigns' })
  })

  it('keeps the ref+path tail of a blob URL unsplit', () => {
    expect(parseRepoInput('https://github.com/acme/campaigns/blob/feat/gh/assets/c.geojson')).toEqual({
      owner: 'acme', repo: 'campaigns', rest: 'feat/gh/assets/c.geojson',
    })
  })

  it('handles tree URLs and raw.githubusercontent URLs', () => {
    expect(parseRepoInput('https://github.com/acme/campaigns/tree/main/assets')?.rest).toBe('main/assets')
    expect(parseRepoInput('https://raw.githubusercontent.com/acme/campaigns/main/c.geojson')?.rest)
      .toBe('main/c.geojson')
  })

  it('rejects input that names no repository', () => {
    expect(parseRepoInput('acme')).toBeNull()
    expect(parseRepoInput('https://github.com/acme')).toBeNull()
    expect(parseRepoInput('   ')).toBeNull()
  })
})

describe('resolveRefAndPath', () => {
  const refs = ['main', 'feat/gh', 'feat/gh/nested']

  it('prefers the longest matching ref', () => {
    expect(resolveRefAndPath('feat/gh/assets/c.geojson', refs))
      .toEqual({ ref: 'feat/gh', path: 'assets/c.geojson' })
    expect(resolveRefAndPath('feat/gh/nested/c.geojson', refs))
      .toEqual({ ref: 'feat/gh/nested', path: 'c.geojson' })
  })

  it('splits a simple branch', () => {
    expect(resolveRefAndPath('main/dir/c.geojson', refs)).toEqual({ ref: 'main', path: 'dir/c.geojson' })
  })

  it('recognises a commit sha without consulting the ref list', () => {
    const sha = 'a'.repeat(40)
    expect(resolveRefAndPath(`${sha}/c.geojson`, [])).toEqual({ ref: sha, path: 'c.geojson' })
  })

  it('returns an empty path for a bare ref', () => {
    expect(resolveRefAndPath('feat/gh', refs)).toEqual({ ref: 'feat/gh', path: '' })
  })

  it('returns null when no ref matches', () => {
    expect(resolveRefAndPath('nope/c.geojson', refs)).toBeNull()
  })
})

describe('repository listing', () => {
  it('returns branch names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ name: 'main' }, { name: 'feat/gh' }])))
    expect(await listBranches({ owner: 'a', repo: 'b' })).toEqual(['main', 'feat/gh'])
  })

  it('reads the default branch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ default_branch: 'trunk' })))
    expect(await fetchDefaultBranch({ owner: 'a', repo: 'b' })).toBe('trunk')
  })

  it('lists only geojson blobs when the repo has any, and flags truncation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      truncated: true,
      tree: [
        { path: 'README.md', type: 'blob' },
        { path: 'package.json', type: 'blob' },      // noise in a code repo
        { path: 'assets', type: 'tree' },            // directories aren't files
        { path: 'assets/b.geojson', type: 'blob' },
        { path: 'a.geojson', type: 'blob' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { paths, truncated } = await listCampaignFiles({ owner: 'a', repo: 'b' }, 'feat/gh')
    expect(paths).toEqual(['a.geojson', 'assets/b.geojson'])
    expect(truncated).toBe(true)
    // Slashes in the branch name belong to the ref and must not be escaped away
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/a/b/git/trees/feat/gh?recursive=1')
  })

  it('falls back to .json only when the repo has no .geojson', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      tree: [
        { path: 'campaigns/forest.json', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ],
    })))
    const { paths } = await listCampaignFiles({ owner: 'a', repo: 'b' }, 'main')
    expect(paths).toEqual(['campaigns/forest.json'])
  })

  it('surfaces a missing repository as notfound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404)))
    await expect(listBranches({ owner: 'a', repo: 'nope' })).rejects.toMatchObject({ kind: 'notfound' })
  })
})

describe('putCampaignFile', () => {
  it('sends the prior sha and branch, and returns the new sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: { sha: 'new1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const sha = await putCampaignFile({ ...SRC, sha: 'old1' }, '{"a":1}', 'msg', 'tok')
    expect(sha).toBe('new1')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    expect(init.method).toBe('PUT')
    expect(body.sha).toBe('old1')
    expect(body.branch).toBe('main')
    expect(body.message).toBe('msg')
    expect(atob(body.content)).toBe('{"a":1}')
  })

  it('omits the sha when creating a new file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: { sha: 'new1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await putCampaignFile(SRC, '{}', 'msg', 'tok')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).sha).toBeUndefined()
  })

  it('reports a stale sha as a conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ message: 'does not match' }, 409)
    ))
    await expect(putCampaignFile({ ...SRC, sha: 'old' }, '{}', 'm', 'tok'))
      .rejects.toMatchObject({ kind: 'conflict' })
  })
})
