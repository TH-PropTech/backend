import { ConsultationEmailService } from './consultation-email.service'

describe('ConsultationEmailService', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalAppUrl = process.env.APP_URL
  const originalFetch = global.fetch

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalKey
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
    global.fetch = originalFetch
  })

  it('sends a branded invitation with a session-specific CTA', async () => {
    process.env.RESEND_API_KEY = 'resend-key'
    process.env.APP_URL = 'https://app.example.com'
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    fetchMock.mockResolvedValue(new Response('{}'))
    global.fetch = fetchMock

    await new ConsultationEmailService().sendInvitation(
      'tenant@example.com',
      'call-1',
      'Nguyen Van A'
    )

    const request = fetchMock.mock.calls[0]?.[1]
    const requestBody = request?.body
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a JSON email request body')
    }
    const body = JSON.parse(requestBody) as { html: string }
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer resend-key',
    })
    expect(body.html).toContain('#c65a3a')
    expect(body.html).toContain('logId=call-1')
  })

  it('skips external email delivery when the key is absent', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >()
    global.fetch = fetchMock

    await new ConsultationEmailService().sendSummary(
      'tenant@example.com',
      90,
      'Căn hộ 2PN',
      'Nhu cầu phù hợp'
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
