import { describe, expect, it } from 'vitest'
import { scrubSentryEvent } from '../../shared/sentryScrubber.js'

describe('scrubSentryEvent', () => {
  it('redacts request bodies, auth headers, cookies, and known PII fields', () => {
    const scrubbed = scrubSentryEvent({
      request: {
        data: { password: 'super-secret' },
        cookies: { panama_token: 'jwt' },
        url: 'https://panama.local/dashboard?home=amberwood&date=2026-04-16',
        headers: {
          Authorization: 'Bearer abc',
          Cookie: 'panama_token=jwt',
          'x-trace-id': 'trace-1',
        },
      },
      user: {
        username: 'alice',
        email: 'alice@example.com',
      },
      extra: {
        resident_name: 'Jane Smith',
        nested: { notes: 'confidential' },
        ni: 'AB123456C',
        emailText: 'alice@example.com',
      },
    })

    expect(scrubbed.request.data).toBe('[REDACTED]')
    expect(scrubbed.request.cookies).toBe('[REDACTED]')
    expect(scrubbed.request.headers.Authorization).toBe('[REDACTED]')
    expect(scrubbed.request.headers.Cookie).toBe('[REDACTED]')
    expect(scrubbed.request.headers['x-trace-id']).toBe('trace-1')
    expect(scrubbed.request.url).toBe('https://panama.local/dashboard?home=[REDACTED]&date=[REDACTED]')
    expect(scrubbed.user.username).toBe('[REDACTED]')
    expect(scrubbed.user.email).toBe('[REDACTED]')
    expect(scrubbed.extra.resident_name).toBe('[REDACTED]')
    expect(scrubbed.extra.nested.notes).toBe('[REDACTED]')
    expect(scrubbed.extra.ni).toBe('[REDACTED]')
    expect(scrubbed.extra.emailText).toBe('[REDACTED]')
  })
})
