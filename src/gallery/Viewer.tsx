import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PieceFrame, { archivedSrc, liveArtifactSrc, liveWrapperSrc } from '../components/PieceFrame'
import TzktLink from '../components/ChainLinks'
import { loadIterationContract, loadIterationIds, loadProjectIteration, loadSummary, type LocalIteration } from '../lib/data'
import { fetchOwner, type Owner } from '../lib/tzkt'
import type { Painting } from './types'
import { coverRect, type ScreenRect } from './approach'

interface Props {
  painting: Painting
  /** Where the painting is on screen; the frame is put exactly there. */
  rect: ScreenRect
  onBack: () => void
}

/** The hash inside a captured `?fxhash=…` query; '' if it carries none. */
const hashOf = (query: string) => new URLSearchParams(query.split('#')[0].slice(1)).get('fxhash') ?? ''

function pinnedSrc(painting: Painting, hasRunner: boolean | undefined): { src: string | null; source: 'archived' | 'ipfs'; waiting: boolean } {
  if (hasRunner === undefined) return { src: null, source: 'archived', waiting: true }
  const seed = painting.seed ?? (painting.preview ? hashOf(painting.preview) : '')
  const genId = painting.generativeId
  if (hasRunner && genId != null && seed) {
    return { src: archivedSrc(genId, seed, painting.preview, true), source: 'archived', waiting: false }
  }
  const live = liveWrapperSrc(liveArtifactSrc(painting.artifactUri ?? '', seed || null))
  return { src: live, source: 'ipfs', waiting: false }
}

/**
 * The piece, running on the wall.
 *
 * Once the camera is square to a painting its image is an axis-aligned rectangle,
 * so the same sandboxed PieceFrame the project page uses is simply positioned over
 * it. Underneath, the painting quad stays — a heavy piece shows its preview while
 * it boots.
 *
 * A collection hanging (`contract` + `tokenId`) is one held edition: it opens on
 * that seed and does not page. Archive hangings still run #0 as the captured
 * preview, then #1…#N through the minted editions.
 */
export default function Viewer({ painting, rect, onBack }: Props) {
  const pinned = Boolean(painting.contract && painting.tokenId)
  const preview = painting.preview ?? null
  const first = preview ? 0 : 1
  const [ids, setIds] = useState<string[] | null | undefined>(pinned ? [] : undefined)
  const [hasRunner, setHasRunner] = useState<boolean | undefined>(undefined)
  const [pos, setPos] = useState(first)
  const [local, setLocal] = useState<LocalIteration | null | undefined>(undefined)
  const [owner, setOwner] = useState<Owner | null>(painting.owner ?? null)

  useEffect(() => {
    let cancelled = false
    const genId = painting.generativeId ?? painting.project
    setHasRunner(undefined)
    loadSummary().then(
      (s) => { if (!cancelled) setHasRunner(s.runners.includes(genId)) },
      () => { if (!cancelled) setHasRunner(false) },
    )
    if (pinned) {
      setIds([])
      setPos(0)
      return () => { cancelled = true }
    }
    setIds(undefined)
    setPos(first)
    loadIterationIds(painting.slug, painting.project).then(
      (r) => { if (!cancelled) setIds(r) },
      () => { if (!cancelled) setIds(null) },
    )
    return () => { cancelled = true }
  }, [painting.project, painting.slug, painting.generativeId, painting.contract, painting.tokenId, first, pinned])

  const current = pos >= 1 ? ids?.[pos - 1] : undefined
  const tokenId = pinned ? Number(painting.tokenId) : current ? Number(current.split('-')[1]) : NaN

  useEffect(() => {
    if (pinned || !Number.isFinite(tokenId)) return
    let cancelled = false
    setLocal(undefined)
    loadProjectIteration(painting.project, tokenId).then(
      (r) => { if (!cancelled) setLocal(r) },
      () => { if (!cancelled) setLocal(null) },
    )
    return () => { cancelled = true }
  }, [painting.project, tokenId, pinned])

  useEffect(() => {
    if (painting.owner) {
      setOwner(painting.owner)
      return
    }
    setOwner(null)
    if (pinned || !Number.isFinite(tokenId)) return
    let cancelled = false
    loadIterationContract(painting.project)
      .then((contract) => (contract ? fetchOwner(contract, String(tokenId)) : null))
      .then((found) => { if (!cancelled) setOwner(found) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [painting.project, painting.owner, tokenId, pinned])

  const count = ids?.length ?? 0
  const positions = pinned ? 1 : count - first + 1
  const step = (delta: number) => {
    if (!pinned && positions > 1) setPos((p) => first + ((((p - first + delta) % positions) + positions) % positions))
  }
  const random = () => { if (!pinned && count) setPos(1 + Math.floor(Math.random() * count)) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') step(-1)
      else if (e.code === 'ArrowRight') step(1)
      else if (e.code === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const label = pinned ? painting.name : `${painting.name} #${pos}`
  const useRunner = hasRunner === true
  const pin = pinned ? pinnedSrc(painting, hasRunner) : null
  const src = pin
    ? pin.src
    : hasRunner === undefined ? null
      : pos === 0 && preview ? archivedSrc(painting.project, hashOf(preview), preview, useRunner)
      : local?.seed ? archivedSrc(painting.project, local.seed, local.query, useRunner) : null
  const source = pin?.source ?? 'archived'
  const box = coverRect(rect)

  const frame = () => {
    if (pinned) {
      if (pin?.waiting) return <div className="gallery-frame-note">Loading seed…</div>
      if (!painting.seed && !preview) {
        return (
          <div className="gallery-frame-note">
            This mint was never signed by fxhash, so no seed was ever assigned and no artwork was generated for it.
          </div>
        )
      }
      if (src) return <PieceFrame src={src} label={label} source={source} />
      return <div className="gallery-frame-note">This edition has no generator URL, so there is nothing to run.</div>
    }
    if (pos === 0 && src) return <PieceFrame src={src} label={label} source="archived" />
    if (hasRunner === undefined || ids === undefined || (current && local === undefined)) {
      return <div className="gallery-frame-note">Loading seed…</div>
    }
    if (ids === null || count === 0) {
      return <div className="gallery-frame-note">No editions are recorded for this project, so there is nothing to run.</div>
    }
    if (src) return <PieceFrame src={src} label={label} source="archived" />
    return (
      <div className="gallery-frame-note">
        This mint was never signed by fxhash, so no seed was ever assigned and no artwork was generated for it.
      </div>
    )
  }

  return (
    <div className="gallery-viewer">
      <div className="gallery-frame" style={box}>
        {frame()}
      </div>

      <div className="gallery-bar" style={{ left: box.left, top: box.top + box.height + 4, width: box.width }}>
        <div className="gallery-bar-title">
          <strong>{label}</strong>
          {!pinned && pos === 0 && <span className="muted"> · the preview</span>}
          {!pinned && count > 0 && <span className="muted"> of {count}</span>}
          {' · '}{painting.artist} · {painting.year}
        </div>
        <div className="gallery-bar-actions">
          {!pinned && positions > 1 && <button className="load-more" onClick={() => step(-1)} aria-label="‹">‹</button>}
          {!pinned && positions > 1 && <button className="load-more" onClick={() => step(1)} aria-label="›">›</button>}
          {!pinned && count > 1 && <button className="load-more" onClick={random}>Random</button>}
          {!pinned && <Link to={`/token/${painting.slug}`} target="_blank" rel="noopener">Project page</Link>}
          {pinned && painting.slug && painting.generativeId != null && (
            <Link to={`/token/${painting.slug}`} target="_blank" rel="noopener">Project page</Link>
          )}
          {pinned && painting.contract && painting.tokenId && (
            <Link to={`/gentk/${painting.contract}/${painting.tokenId}`} target="_blank" rel="noopener">This edition</Link>
          )}
          {owner && <span className="muted">held by <TzktLink address={owner.address} alias={owner.alias} /></span>}
        </div>
      </div>
    </div>
  )
}
