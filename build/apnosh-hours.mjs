// Mr. Dim Sum's hours from the Apnosh portal, written into the pages at deploy time.
//
// The owner edits hours in the Apnosh portal (portal.apnosh.com). A save there fires this site's
// Vercel deploy hook, Vercel runs this script (vercel.json buildCommand), and every
// <!-- apnosh:kind --> ... <!-- /apnosh --> region in the root .html files is rewritten in place:
//
//   hours-list      footer lists        <li><a href="...">Mon–Sat: 10am–9pm</a></li>
//   hours-card      "Hours" card        Mon&ndash;Sat: 10am&ndash;9pm<br>Sunday: 10am&ndash;8pm
//   hours-quick     contact quick info  Mon&ndash;Sat: 10am&ndash;9pm<br>Sun: 10am&ndash;8pm
//   hours-sentence  contact FAQ         We're open Monday&ndash;Saturday 10:00 AM&ndash;9:00 PM and ...
//   hours-meta      contact <meta name="description">, its "Open ..." sentence
//   hours-jsonld    the JSON-LD <script>, its openingHoursSpecification
//   hours-dates     holiday and one-off hours for the next 90 days, after a card or quick info
//
// A gap in Apnosh never blanks or breaks the site: if the fetch fails, times out (8 s), returns an
// error, or has no hours, each region keeps the text already inside it, and the script always exits 0.
// The one exception is hours-dates, which is empty in the repo: without Apnosh it is left empty, so a
// holiday from an old build can never outlive its source.
//
// Run it locally with `node build/apnosh-hours.mjs` (Node 18+, no dependencies). Env vars:
//   APNOSH_PORTAL_BASE  default https://portal.apnosh.com
//   APNOSH_SLUG         default mr-dim-sum-muwyyhwx
//   APNOSH_API_KEY      only if the portal has a key configured

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTAL_BASE = (process.env.APNOSH_PORTAL_BASE || 'https://portal.apnosh.com').replace(/\/+$/, '')
const SLUG = process.env.APNOSH_SLUG || 'mr-dim-sum-muwyyhwx'
const API_KEY = process.env.APNOSH_API_KEY

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
const FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/

async function fetchApnosh() {
  const url = `${PORTAL_BASE}/api/public/sites/${SLUG}`
  const headers = { Accept: 'application/json', 'User-Agent': 'mr-dimsum-build', ...(API_KEY ? { 'X-Apnosh-Key': API_KEY } : {}) }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const data = await res.json()
    return data && typeof data === 'object' ? data : null
  } catch (e) {
    console.warn(`[apnosh] fetch failed, keeping the hours already in the pages: ${e.message}`)
    return null
  }
}

/* Apnosh hours -> { mon: [['10:00', '21:00']], ... }, or null when there are none. Google splits a late night
   at midnight (Friday 12pm-1am arrives as fri 12:00-24:00 plus sat 00:00-01:00), so a carry-over like that is
   folded back into the day it starts on and dropped from the next day. */
function weekOf(hours) {
  if (!hours || typeof hours !== 'object') return null
  const week = {}
  for (const d of DAYS) {
    const periods = []
    for (const p of hours[d] || []) {
      if (!p || !TIME.test(p.open) || !TIME.test(p.close)) throw new Error(`unreadable hours for ${d}: ${JSON.stringify(p)}`)
      periods.push([p.open, p.close])
    }
    week[d] = periods.sort((a, b) => a[0].localeCompare(b[0]))
  }
  if (!DAYS.some((d) => week[d].length)) return null
  const merged = Object.fromEntries(DAYS.map((d) => [d, week[d].map((p) => [...p])]))
  DAYS.forEach((d, i) => {
    const prev = DAYS[(i + 6) % 7] // Monday's previous day is Sunday
    const first = week[d][0]
    const last = week[prev][week[prev].length - 1]
    if (first && first[0] === '00:00' && first[1] !== '24:00' && last && last[1] === '24:00') {
      merged[prev][merged[prev].length - 1][1] = first[1]
      merged[d].shift()
    }
  })
  return merged
}

/* runs of consecutive days with the same hours: [{ days: ['mon', ..., 'sat'], periods }, ...] */
function groupsOf(week) {
  const groups = []
  for (const d of DAYS) {
    const last = groups[groups.length - 1]
    if (last && JSON.stringify(last.periods) === JSON.stringify(week[d])) last.days.push(d)
    else groups.push({ days: [d], periods: week[d] })
  }
  return groups
}

/* "21:00" -> "9pm", "20:30" -> "8:30pm", "24:00" -> "12am" (the footers and cards) */
function clock(t) {
  const [h, m] = t.split(':').map(Number)
  return `${((h % 24) + 11) % 12 + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h % 24 >= 12 ? 'pm' : 'am'}`
}
/* "21:00" -> "9:00 PM" (the FAQ) */
function clock12(t) {
  const [h, m] = t.split(':').map(Number)
  return `${((h % 24) + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h % 24 >= 12 ? 'PM' : 'AM'}`
}

/* the same day label rules the pages use: a run is short ("Mon–Sat"), a single day full ("Sunday") or short ("Sun") */
const label = (days, dash, single) => (days.length === 1 ? single[days[0]] : `${SHORT[days[0]]}${dash}${SHORT[days[days.length - 1]]}`)
const fullLabel = (days, dash) => (days.length === 7 ? 'every day' : days.length === 1 ? FULL[days[0]] : `${FULL[days[0]]}${dash}${FULL[days[days.length - 1]]}`)
const times = (periods, dash, fmt, join) => (periods.length ? periods.map(([o, c]) => `${fmt(o)}${dash}${fmt(c)}`).join(join) : 'Closed')
const list = (parts) => (parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)
const dashIn = (text) => (text.includes('&ndash;') ? '&ndash;' : '–')

/* holiday and one-off hours from today (Seattle) for the next 90 days: ["Thu, Nov 26: Closed", ...] */
function comingDates(special) {
  const seattle = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const today = seattle(Date.now())
  const until = seattle(Date.now() + 90 * 86400000)
  const byDate = new Map()
  for (const s of Array.isArray(special) ? special : []) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || s.date < today || s.date > until) continue
    if (s.closed) byDate.set(s.date, null) // closed wins over any hours given for the same day
    else if (TIME.test(s.open) && TIME.test(s.close) && byDate.get(s.date) !== null) {
      byDate.set(s.date, [...(byDate.get(s.date) || []), [s.open, s.close]])
    }
  }
  return [...byDate.keys()].sort().map((date) => {
    const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    const periods = byDate.get(date)
    return `${day}: ${periods ? times(periods.sort(), '&ndash;', clock, ', ') : 'Closed'}`
  })
}

/* the schema.org openingHoursSpecification array, written the way the pages already write it */
function specJson(groups, indent) {
  const i1 = `${indent}  `
  const i2 = `${indent}    `
  const specs = groups.flatMap(({ days, periods }) => periods.map(([o, c]) => {
    const dayOfWeek = days.length === 1 ? JSON.stringify(FULL[days[0]]) : JSON.stringify(days.map((d) => FULL[d]))
    return `${i1}{\n${i2}"@type": "OpeningHoursSpecification",\n${i2}"dayOfWeek": ${dayOfWeek},\n${i2}"opens": "${o}",\n${i2}"closes": "${c === '24:00' ? '00:00' : c}"\n${i1}}`
  }))
  return `"openingHoursSpecification": [\n${specs.join(',\n')}\n${indent}]`
}

/* swap the openingHoursSpecification array inside a JSON-LD <script>; null (keep it) if anything looks off */
function replaceSpec(block, groups) {
  const key = '"openingHoursSpecification": ['
  const start = block.indexOf(key)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let end = -1
  for (let i = start + key.length - 1; i < block.length && end < 0; i++) {
    const ch = block[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) end = i
  }
  if (end < 0) return null
  const indent = block.slice(block.lastIndexOf('\n', start) + 1, start)
  const out = block.slice(0, start) + specJson(groups, indent) + block.slice(end + 1)
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out)
  JSON.parse(json[1]) // throws (and the region is kept) if the result isn't valid JSON
  return out
}

/* what goes between the markers of one region, or null to keep what is there */
function render(kind, inner, groups, dates) {
  const dash = dashIn(inner)
  if (kind === 'hours-dates') return dates.map((d) => `<br>${d}`).join('')
  if (!groups) return null
  const open = groups.filter((g) => g.periods.length)
  const closed = groups.filter((g) => !g.periods.length)
  switch (kind) {
    case 'hours-list': {
      const href = (/<a href="([^"]*)"/.exec(inner) || [])[1]
      const indent = (/\n([ \t]*)<li/.exec(inner) || [])[1]
      if (href == null || indent == null) return null
      return groups.map((g) => `\n${indent}<li><a href="${href}">${label(g.days, dash, FULL)}: ${times(g.periods, dash, clock, ', ')}</a></li>`).join('') + `\n${indent}`
    }
    case 'hours-card':
      return groups.map((g) => `${label(g.days, dash, FULL)}: ${times(g.periods, dash, clock, ', ')}`).join('<br>')
    case 'hours-quick':
      return groups.map((g) => `${label(g.days, dash, SHORT)}: ${times(g.periods, dash, clock, ', ')}`).join('<br>')
    case 'hours-sentence': {
      const said = open.length ? `We're open ${list(open.map((g) => `${fullLabel(g.days, dash)} ${times(g.periods, dash, clock12, ' &amp; ')}`))}.` : ''
      return [said, closed.length ? `We're closed ${list(closed.map((g) => fullLabel(g.days, dash)))}.` : ''].filter(Boolean).join(' ')
    }
    case 'hours-meta': {
      if (!/Open [^"]*(?=")/.test(inner) || !open.length) return null
      const said = `Open ${open.map((g) => `${fullLabel(g.days, dash)} ${times(g.periods, dash, clock, ' &amp; ')}`).join(', ')}.`
      return inner.replace(/Open [^"]*(?=")/, closed.length ? `${said} Closed ${list(closed.map((g) => fullLabel(g.days, dash)))}.` : said)
    }
    case 'hours-jsonld':
      return replaceSpec(inner, open)
    default:
      return null
  }
}

async function main() {
  const data = await fetchApnosh()
  let groups = null
  let dates = []
  if (data) {
    try {
      const week = weekOf(data.hours)
      groups = week ? groupsOf(week) : null
      dates = comingDates(data.specialHours)
      console.log(`[apnosh] ${groups ? 'hours from Apnosh' : 'no hours in Apnosh, kept the pages\' own'}, ${dates.length} upcoming holiday date(s)`)
    } catch (e) {
      console.warn(`[apnosh] couldn't read the hours, keeping the hours already in the pages: ${e.message}`)
      groups = null
      dates = []
    }
  }

  const marker = /<!-- apnosh:([\w-]+) -->([\s\S]*?)<!-- \/apnosh -->/g
  for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    const path = join(ROOT, file)
    const html = readFileSync(path, 'utf8')
    const out = html.replace(marker, (all, kind, inner) => {
      try {
        const text = render(kind, inner, groups, dates)
        return text == null ? all : `<!-- apnosh:${kind} -->${text}<!-- /apnosh -->`
      } catch (e) {
        console.warn(`[apnosh] ${file} ${kind}: ${e.message}; kept as it was`)
        return all
      }
    })
    if (out !== html) {
      writeFileSync(path, out)
      console.log(`[apnosh] updated ${file}`)
    }
  }
}

// Never fail the deploy because of Apnosh: the pages as committed are always a working site.
main().catch((e) => console.warn(`[apnosh] skipped: ${e.message}`)).finally(() => { process.exitCode = 0 })
