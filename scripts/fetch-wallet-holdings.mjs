// scripts/fetch-wallet-holdings.mjs
// Snapshot the gentk a Tezos wallet currently holds, join them to this archive's
// catalog, and save one thumbnail per iteration for the walkable gallery.
//
// The 3D gallery hangs one painting per *iteration*, not per project — so this
// file is the input `readHoldingsInputs` feeds `buildGallery`. Re-run whenever
// the wallet buys or sells.
//
// Usage:
//   node scripts/fetch-wallet-holdings.mjs
//   GALLERY_WALLET=tz1… node scripts/fetch-wallet-holdings.mjs

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { GATEWAYS } from './archive-lib.mjs'

const TZKT = 'https://api.tzkt.io/v1'
export const GENTK_CONTRACTS = [
  'KT1KEa8z6vWXDJrVqtMrAeDVzsvxat3kHaCE',
  'KT1U6EHmNxJTkvaWJ4ThczG4FSDaHC21ssvi',
  'KT1EfsNuqwLAWDd3o4pvfUx1CAh5GMdTrRvr',
]

const DEFAULT_WALLET = 'tz1cpZ7eLovJigqcUsfbjmquuezjToZLtGUZ'
const DATA = 'public/data'
const OUT = join(DATA, 'holdings.json')
const THUMBS = join(DATA, 'holdings-thumbs')
const PREVIEW = 512
const QUALITY = 82
const TIMEOUT_MS = 60000
const DELAY_MS = 80

const wallet = process.env.GALLERY_WALLET || DEFAULT_WALLET
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Stable unique id: contract slot × 10M + tokenId. The three gentk ranges do not overlap. */
export function holdingId(contract, tokenId) {
  const slot = GENTK_CONTRACTS.indexOf(contract)
  if (slot < 0) throw new Error(`not a gentk contract: ${contract}`)
  return (slot + 1) * 10_000_000 + Number(tokenId)
}

export function projectNameOf(name) {
  if (!name || name === '[WAITING TO BE SIGNED]') return null
  return name.replace(/\s+#\d+\s*$/, '').trim() || null
}

export function queryOf(artifactUri, seed) {
  if (typeof artifactUri === 'string') {
    const hashAt = artifactUri.indexOf('#')
    const rest = hashAt >= 0 ? artifactUri.slice(0, hashAt) : artifactUri
    const q = rest.indexOf('?')
    if (q >= 0) {
      const query = rest.slice(q) + (hashAt >= 0 ? artifactUri.slice(hashAt) : '')
      if (query.length > 1) return query
    }
  }
  return seed ? `?fxhash=${encodeURIComponent(seed)}` : null
}

function ipfsPath(uri) {
  return typeof uri === 'string' && uri.startsWith('ipfs://') ? uri.slice('ipfs://'.length) : null
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function fetchBalances(address) {
  const items = []
  const contracts = GENTK_CONTRACTS.join(',')
  let offset = 0
  const limit = 50
  for (;;) {
    const url =
      `${TZKT}/tokens/balances?account=${encodeURIComponent(address)}` +
      `&token.contract.in=${contracts}&balance.gt=0&offset=${offset}&limit=${limit}`
    const page = await fetchJson(url)
    items.push(...page)
    if (page.length < limit) break
    offset += limit
  }
  return items
}

async function loadCatalog(dataDir) {
  const byUri = new Map()
  const byName = new Map()
  const dir = join(dataDir, 'tokens')
  for (const f of (await readdir(dir)).filter((n) => /^index-\d+\.json$/.test(n))) {
    for (const t of JSON.parse(await readFile(join(dir, f), 'utf8'))) {
      if (t.generativeUri) byUri.set(t.generativeUri, t)
      if (t.name) {
        const key = String(t.name).toLowerCase()
        if (!byName.has(key)) byName.set(key, t)
      }
    }
  }
  return { byUri, byName }
}

function matchCatalog(meta, catalog) {
  const uri = meta?.generatorUri
  if (uri && catalog.byUri.has(uri)) return catalog.byUri.get(uri)
  const name = projectNameOf(meta?.name)
  if (name) {
    const hit = catalog.byName.get(name.toLowerCase())
    if (hit) return hit
  }
  return null
}

async function fetchBytes(path) {
  let lastErr
  for (let attempt = 0; attempt < GATEWAYS.length * 2; attempt++) {
    const gateway = GATEWAYS[attempt % GATEWAYS.length]
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(gateway + path, { signal: ac.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
      if (!type.startsWith('image/')) throw new Error(`unexpected content-type: ${type || '(none)'}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length === 0) throw new Error('empty body')
      return buffer
    } catch (err) {
      lastErr = err
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

async function saveThumb(id, uri) {
  const path = ipfsPath(uri)
  if (!path) return null
  const buf = await fetchBytes(path.split('?')[0])
  const image = sharp(buf)
  const { width, height } = await image.metadata()
  const file = join(THUMBS, `${id}.webp`)
  await image
    .resize(PREVIEW, PREVIEW, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(file)
  return { w: width, h: height, file: `holdings-thumbs/${id}.webp` }
}

async function main() {
  console.log(`wallet ${wallet}`)
  const account = await fetchJson(`${TZKT}/accounts/${encodeURIComponent(wallet)}`)
  const owner = { address: account.address, alias: account.alias ?? null }
  const rows = await fetchBalances(wallet)
  console.log(`${rows.length} gentk balances`)
  const catalog = await loadCatalog(DATA)

  const items = []
  const sizes = {}
  await mkdir(THUMBS, { recursive: true })

  for (const row of rows) {
    const contract = row.token?.contract?.address
    const tokenId = String(row.token?.tokenId ?? '')
    const meta = row.token?.metadata ?? {}
    if (!contract || !tokenId) continue
    const id = holdingId(contract, tokenId)
    const cat = matchCatalog(meta, catalog)
    const seed = typeof meta.iterationHash === 'string' && meta.iterationHash ? meta.iterationHash : null
    const displayUri = meta.displayUri ?? meta.thumbnailUri ?? null
    const item = {
      id,
      contract,
      tokenId,
      name: meta.name ?? `#${tokenId}`,
      iteration: Number((meta.name ?? '').match(/#(\d+)\s*$/)?.[1] ?? tokenId),
      seed,
      artifactUri: meta.artifactUri ?? null,
      displayUri,
      generatorUri: meta.generatorUri ?? null,
      query: queryOf(meta.artifactUri, seed),
      createdAt: cat?.createdAt ?? row.firstTime ?? null,
      slug: cat?.slug ?? (projectNameOf(meta.name) || `gentk-${tokenId}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      generativeId: cat?.id ?? null,
      author: cat?.author ?? { id: null, name: null },
      flag: cat?.flag ?? 'NONE',
    }
    items.push(item)

    try {
      const saved = await saveThumb(id, displayUri)
      if (saved) {
        sizes[id] = { w: saved.w, h: saved.h }
        console.log(`thumb ${item.name}`)
      } else {
        console.warn(`no display image for ${item.name}`)
      }
    } catch (err) {
      console.warn(`thumb failed for ${item.name}: ${err.message}`)
    }
    await sleep(DELAY_MS)
  }

  items.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id - b.id)
  const payload = {
    generatedAt: new Date().toISOString(),
    owner,
    counts: { items: items.length, matched: items.filter((i) => i.generativeId != null).length },
    sizes,
    items,
  }
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n')
  console.log(`wrote ${OUT}: ${items.length} pieces, ${payload.counts.matched} matched to the catalog`)
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('fetch-wallet-holdings.mjs')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
