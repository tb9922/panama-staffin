const REDACTED = '[REDACTED]'
const MAX_DEPTH = 6

const SENSITIVE_KEY_RE = /(^|_|-)(password|passcode|secret|token|authorization|cookie|csrf|email|phone|mobile|dob|date_of_birth|ni_number|national_insurance|resident_name|staff_name|full_name|first_name|last_name|username|ip_address|ipaddress|address|postcode|post_code|notes?)$/i
const NI_NUMBER_RE = /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function scrubUrlQuery(value) {
  return value.replace(/([?&][^=&#]+)=([^&#]*)/g, '$1=[REDACTED]')
}

function scrubString(value, key = '') {
  if (!value) return value
  if (SENSITIVE_KEY_RE.test(key)) return REDACTED
  let next = value
  if (/[?&][^=]+=/.test(next)) next = scrubUrlQuery(next)
  next = next.replace(EMAIL_RE, REDACTED)
  next = next.replace(NI_NUMBER_RE, REDACTED)
  return next
}

function scrubHeaders(headers = {}) {
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    if (/^(authorization|cookie|set-cookie|x-csrf-token)$/i.test(key)) {
      next[key] = REDACTED
    } else {
      next[key] = scrubValue(value, key)
    }
  }
  return next
}

function scrubObject(value, depth) {
  const next = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      next[key] = REDACTED
    } else {
      next[key] = scrubValue(entry, key, depth + 1)
    }
  }
  return next
}

export function scrubValue(value, key = '', depth = 0) {
  if (depth > MAX_DEPTH) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, key, depth + 1))
  if (isPlainObject(value)) return scrubObject(value, depth)
  if (typeof value === 'string') return scrubString(value, key)
  return value
}

export function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event

  const next = { ...event }

  if (next.user) {
    next.user = scrubValue(next.user)
  }

  if (next.request) {
    next.request = { ...next.request }
    if ('data' in next.request) next.request.data = REDACTED
    if ('cookies' in next.request) next.request.cookies = REDACTED
    if (typeof next.request.url === 'string') next.request.url = scrubString(next.request.url, 'url')
    if (next.request.headers) next.request.headers = scrubHeaders(next.request.headers)
  }

  if (next.extra) next.extra = scrubValue(next.extra)
  if (next.contexts) next.contexts = scrubValue(next.contexts)

  if (Array.isArray(next.breadcrumbs?.values)) {
    next.breadcrumbs = {
      ...next.breadcrumbs,
      values: next.breadcrumbs.values.map((crumb) => ({
        ...crumb,
        data: scrubValue(crumb?.data),
      })),
    }
  }

  return next
}
