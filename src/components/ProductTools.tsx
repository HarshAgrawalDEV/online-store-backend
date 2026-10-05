'use client'

import { useDocumentInfo, useField } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { normalizeCode } from '../lib/catalog'
import { textToLexical } from '../lib/description-guard'
import { allowedSizeCodes } from '../lib/set-details'

type Option = { code: string; id: number; label: string }

const api = async (path: string, body?: unknown) => {
  const response = await fetch(`/api${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: body === undefined && !path.startsWith('/admin') ? 'GET' : 'POST',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? payload?.message ?? 'The request failed.')
  }
  return payload
}

const loadOptions = async (collection: 'colours' | 'sizes'): Promise<Option[]> => {
  const result = await api(`/${collection}?limit=200&sort=sortOrder&where[isActive][equals]=true`)
  return (result.docs ?? []).map(
    (doc: { code: string; id: number; label?: string; name?: string }) => ({
      code: doc.code,
      id: doc.id,
      label: doc.label ?? doc.name ?? doc.code,
    }),
  )
}

const box = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 4,
  marginBottom: 16,
  padding: 16,
}
const cell = { padding: '4px 8px', textAlign: 'left' } as const
const choices = { display: 'flex', flexWrap: 'wrap', gap: 12, margin: '8px 0 12px' } as const
const choice = { alignItems: 'center', display: 'flex', gap: 6, minHeight: 32 } as const

const useBusy = () => {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, message, run, setMessage }
}

const SaveFirst = ({ what }: { what: string }) => (
  <p style={box}>Save the product first. Then you can {what} here.</p>
)

/** Pick sizes and colours once, set prices and opening stock, and create every combination. */
export const VariantTools = () => {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const { busy, message, run, setMessage } = useBusy()
  const productType = useField<string>({ path: 'setDetails.productType' }).value
  // Jewellery usually has no sizes: one variant per colour.
  const isJewellery = useField<string>({ path: 'department' }).value === 'jewellery'
  const [sizes, setSizes] = useState<Option[]>([])
  const [colours, setColours] = useState<Option[]>([])
  const [pickedSizes, setPickedSizes] = useState<string[]>([])
  const [pickedColours, setPickedColours] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [saveCustom, setSaveCustom] = useState(true)
  const [rupees, setRupees] = useState('')
  const [sizeRupees, setSizeRupees] = useState<Record<string, string>>({})
  const [defaultStock, setDefaultStock] = useState('')
  const [cellStock, setCellStock] = useState<Record<string, string>>({})

  useEffect(() => {
    void Promise.all([loadOptions('sizes'), loadOptions('colours')])
      .then(([sizeList, colourList]) => {
        setSizes(sizeList)
        setColours(colourList)
      })
      .catch(() => setMessage('Could not load sizes and colours.'))
  }, [setMessage])

  if (!id) return <SaveFirst what="create sizes and colours" />

  // Chuda is only sold in a few sizes, so only those are offered for it.
  const allowed = allowedSizeCodes(productType)
  const offeredSizes = allowed ? sizes.filter((size) => allowed.includes(size.code)) : sizes
  const chosenSizes = isJewellery
    ? []
    : pickedSizes.filter((code) => offeredSizes.some((size) => size.code === code))
  const customName = custom.trim()
  const colourColumns = [
    ...pickedColours.map((code) => ({
      code,
      label: colours.find((colour) => colour.code === code)?.label ?? code,
    })),
    ...(customName ? [{ code: normalizeCode(customName), label: customName }] : []),
  ]

  const toggle = (list: string[], set: (next: string[]) => void, code: string) =>
    set(list.includes(code) ? list.filter((item) => item !== code) : [...list, code])

  const toPaise = (value: string) => Math.round(Number(value) * 100)
  const canCreate =
    !busy &&
    colourColumns.length > 0 &&
    (isJewellery
      ? Number(rupees) > 0
      : chosenSizes.length > 0 &&
        chosenSizes.every((code) => Number(sizeRupees[code]) > 0 || Number(rupees) > 0))

  const generate = () =>
    run(async () => {
      const priceBySize: Record<string, number> = {}
      for (const code of chosenSizes) {
        if (Number(sizeRupees[code]) > 0) priceBySize[code] = toPaise(sizeRupees[code])
      }
      const stock: Record<string, number> = {}
      for (const [key, value] of Object.entries(cellStock)) {
        if (value !== '' && Number(value) >= 0) stock[key] = Math.floor(Number(value))
      }
      const result = await api(`/admin/products/${id}/generate-variants`, {
        colours: pickedColours,
        customColours: customName ? [customName] : [],
        defaultStock: defaultStock !== '' ? Math.floor(Number(defaultStock)) : undefined,
        price: Number(rupees) > 0 ? toPaise(rupees) : undefined,
        priceBySize: Object.keys(priceBySize).length ? priceBySize : undefined,
        saveToLibrary: saveCustom,
        sizes: chosenSizes,
        stock: Object.keys(stock).length ? stock : undefined,
      })
      setMessage(result.message)
      setPickedSizes([])
      setPickedColours([])
      setCustom('')
      setSizeRupees({})
      setCellStock({})
      // Refresh the list of variants below.
      router.refresh()
    })

  return (
    <div style={box}>
      <h4 style={{ marginTop: 0 }}>Add sizes and colours</h4>
      <p>
        Tick the sizes and colours this design comes in, then fill in the price and opening stock.
        One variant is created for every combination. Doing it again skips what already exists, so
        you can add more later.
      </p>
      {isJewellery ? null : (
        <>
          <strong>1. Sizes</strong>
          {allowed ? (
            <p style={{ margin: '4px 0' }}>Chuda is only sold in sizes {allowed.join(', ')}.</p>
          ) : null}
          <div style={choices}>
            {offeredSizes.map((size) => (
              <label key={size.id} style={choice}>
                <input
                  checked={pickedSizes.includes(size.code)}
                  onChange={() => toggle(pickedSizes, setPickedSizes, size.code)}
                  type="checkbox"
                />
                {size.label}
              </label>
            ))}
          </div>
        </>
      )}
      <strong>{isJewellery ? '1' : '2'}. Colours</strong>
      <div style={choices}>
        {colours.map((colour) => (
          <label key={colour.id} style={choice}>
            <input
              checked={pickedColours.includes(colour.code)}
              onChange={() => toggle(pickedColours, setPickedColours, colour.code)}
              type="checkbox"
            />
            {colour.label}
          </label>
        ))}
      </div>
      <div style={{ ...choices, alignItems: 'center' }}>
        <input
          aria-label="Another colour"
          onChange={(event) => setCustom(event.target.value)}
          placeholder="A colour not listed (optional)"
          value={custom}
        />
        <label style={choice}>
          <input
            checked={saveCustom}
            onChange={(event) => setSaveCustom(event.target.checked)}
            type="checkbox"
          />
          Add it to the colour list
        </label>
      </div>
      <strong>{isJewellery ? '2' : '3'}. Price and opening stock</strong>
      <div style={{ ...choices, alignItems: 'center' }}>
        <input
          aria-label="Price for every size in rupees"
          min="1"
          onChange={(event) => setRupees(event.target.value)}
          placeholder="Price for all sizes (₹)"
          type="number"
          value={rupees}
        />
        <input
          aria-label="Opening stock for every variant"
          min="0"
          onChange={(event) => setDefaultStock(event.target.value)}
          placeholder="Stock for each (optional)"
          type="number"
          value={defaultStock}
        />
      </div>
      {(isJewellery || chosenSizes.length > 0) && colourColumns.length > 0 ? (
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <p style={{ margin: '4px 0' }}>
            {isJewellery
              ? 'Optional: set the stock of each colour.'
              : 'Optional: change the price of one size, or the stock of one variant.'}
          </p>
          <table style={{ borderCollapse: 'collapse', minWidth: 360 }}>
            <thead>
              <tr>
                {isJewellery ? null : <th style={cell}>Size</th>}
                {isJewellery ? null : <th style={cell}>Price ₹</th>}
                {colourColumns.map((column) => (
                  <th key={column.code} style={cell}>
                    {column.label} stock
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(isJewellery ? [''] : chosenSizes).map((code) => (
                <tr key={code}>
                  {isJewellery ? null : (
                    <td style={cell}>{offeredSizes.find((size) => size.code === code)?.label}</td>
                  )}
                  {isJewellery ? null : (
                    <td style={cell}>
                      <input
                        aria-label={`Price for size ${code}`}
                        min="1"
                        onChange={(event) =>
                          setSizeRupees((current) => ({ ...current, [code]: event.target.value }))
                        }
                        placeholder={rupees || '—'}
                        style={{ width: 90 }}
                        type="number"
                        value={sizeRupees[code] ?? ''}
                      />
                    </td>
                  )}
                  {colourColumns.map((column) => (
                    <td key={column.code} style={cell}>
                      <input
                        aria-label={`Stock for size ${code}, ${column.label}`}
                        min="0"
                        onChange={(event) =>
                          setCellStock((current) => ({
                            ...current,
                            [`${code}|${column.code}`]: event.target.value,
                          }))
                        }
                        placeholder={defaultStock || '0'}
                        style={{ width: 90 }}
                        type="number"
                        value={cellStock[`${code}|${column.code}`] ?? ''}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <button disabled={!canCreate} onClick={generate} type="button">
        {busy ? 'Creating…' : 'Create variants'}
      </button>
      {message ? (
        <p role="status" style={{ marginBottom: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  )
}

/** Write, refine and apply a description draft without leaving the page. */
export const DescriptionTools = () => {
  const { id } = useDocumentInfo()
  const { busy, message, run, setMessage } = useBusy()
  const [drafts, setDrafts] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [usedDraft, setUsedDraft] = useState<null | string>(null)
  // Setting these fields updates the form on screen straight away, no reload needed.
  const description = useField<unknown>({ path: 'description' })
  const draftText = useField<string>({ path: 'aiDraft.text' })

  if (!id) return <SaveFirst what="write a description draft" />

  const writeDraft = (withNote: boolean) =>
    run(async () => {
      const result = await api(`/admin/products/${id}/generate-description`, {
        instructions: withNote && note.trim() ? note.trim() : undefined,
        previousDraft: drafts[0],
      })
      const text = String(result.data.text)
      setDrafts((current) => [text, ...current].slice(0, 5))
      draftText.setValue(text)
      setUsedDraft(null)
      if (withNote) setNote('')
    })

  const applyDraft = (text: string) => {
    description.setValue(textToLexical(text))
    setUsedDraft(text)
    setMessage('Added to the description below. Save the product to keep it.')
  }

  return (
    <div style={box}>
      <h4 style={{ marginTop: 0 }}>Write a description for me</h4>
      <p>
        Makes a draft from this product&apos;s details and main photo. Nothing changes on the
        product until you choose &quot;Use this one&quot; and save.
      </p>
      <div style={{ ...choices, alignItems: 'center' }}>
        <input
          aria-label="Your thoughts on the draft"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Your thoughts, e.g. make it shorter, mention Teej, more festive"
          style={{ flex: 1, minWidth: 260 }}
          value={note}
        />
        {drafts.length === 0 ? (
          <button disabled={busy} onClick={() => writeDraft(Boolean(note.trim()))} type="button">
            {busy ? 'Writing…' : 'Write a draft'}
          </button>
        ) : (
          <>
            <button disabled={busy || !note.trim()} onClick={() => writeDraft(true)} type="button">
              {busy ? 'Writing…' : 'Rewrite with my note'}
            </button>
            <button disabled={busy} onClick={() => writeDraft(false)} type="button">
              {busy ? 'Writing…' : 'Try another version'}
            </button>
          </>
        )}
      </div>
      {drafts.map((text, index) => (
        <div
          key={`${index}-${text.slice(0, 24)}`}
          style={{
            ...box,
            background: usedDraft === text ? 'var(--theme-success-100)' : undefined,
            marginBottom: 12,
          }}
        >
          <strong>{index === 0 ? 'Latest version' : `Earlier version ${index}`}</strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
          <button disabled={busy} onClick={() => applyDraft(text)} type="button">
            {usedDraft === text ? 'Added to the description' : 'Use this one'}
          </button>
        </div>
      ))}
      {message ? (
        <p role="status" style={{ marginBottom: 0 }}>
          {message}
        </p>
      ) : null}
    </div>
  )
}

/** Warns, without blocking, when another product already has this name. */
export const DuplicateNameWarning = () => {
  const { id } = useDocumentInfo()
  const name = useField<string>({ path: 'name' }).value
  const [matches, setMatches] = useState<Array<{ id: number; name: string; status: string }>>([])

  useEffect(() => {
    const text = (name ?? '').trim()
    const timer = setTimeout(() => {
      if (text.length < 3) {
        setMatches([])
        return
      }
      void api(
        `/products?limit=5&depth=0&select[name]=true&select[status]=true&where[name][equals]=${encodeURIComponent(text)}`,
      )
        .then((result) =>
          setMatches(
            (result.docs ?? []).filter((doc: { id: number }) => String(doc.id) !== String(id)),
          ),
        )
        .catch(() => setMatches([]))
    }, 500)
    return () => clearTimeout(timer)
  }, [id, name])

  if (matches.length === 0) return null
  return (
    <p role="alert" style={{ ...box, borderColor: 'var(--theme-warning-500)' }}>
      Another product is already called &quot;{matches[0].name}&quot;:{' '}
      {matches.map((match, index) => (
        <span key={match.id}>
          {index > 0 ? ', ' : ''}
          <a href={`/admin/collections/products/${match.id}`} rel="noreferrer" target="_blank">
            open it ({match.status})
          </a>
        </span>
      ))}
      . You can still save this one, but check you are not adding the same design twice.
    </p>
  )
}
