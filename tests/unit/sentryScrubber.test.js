import { describe, expect, it } from 'vitest'
import { scrubSentryEvent } from '../../shared/sentryScrubber.js'

describe('scrubSentryEvent', () => {
  it('redacts request bodies, auth headers, cookies, and known PII fields', () => {
    const scrubbed = scrubSentryEvent({
      request: {
        data: { password: 'super-secret' },
        cookies: { panama_token: 'jwt' },
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
      },
    })

    expect(scrubbed.request.data).toBe('[REDACTED]')
    expect(scrubbed.request.cookies).toBe('[REDACTED]')
    expect(scrubbed.request.headers.Authorization).toBe('[REDACTED]')
    expect(scrubbed.request.headers.Cookie).toBe('[REDACTED]')
    expect(scrubbed.request.headers['x-trace-id']).toBe('trace-1')
    expect(scrubbed.user.username).toBe('[REDACTED]')
    expect(scrubbed.user.email).toBe('[REDACTED]')
    expect(scrubbed.extra.resident_name).toBe('[REDACTED]')
    expect(scrubbed.extra.nested.notes).toBe('[REDACTED]')
  })
})
