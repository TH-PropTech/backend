import {
  fetchPageHtml,
  isPrivateAddress,
  SafeFetchError,
  type SafeFetchErrorCode,
} from './safe-fetch'

const PUBLIC_IP = '93.184.216.34'

async function codeOf(promise: Promise<unknown>): Promise<SafeFetchErrorCode> {
  try {
    await promise
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code
    throw err
  }
  throw new Error('expected the promise to reject')
}

function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response
): { impl: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  }
  return { impl, calls }
}

function lookupMap(
  map: Record<string, string[]>
): (host: string) => Promise<string[]> {
  return (host: string): Promise<string[]> => {
    const addresses = map[host]
    return addresses
      ? Promise.resolve(addresses)
      : Promise.reject(new Error(`ENOTFOUND ${host}`))
  }
}

function streamResponse(chunks: Uint8Array[], init: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream, init)
}

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

describe('isPrivateAddress', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.1.1.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('treats IPv4 %s as private', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '11.0.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '192.167.1.1',
    '198.17.0.1',
    '198.20.0.1',
    '223.255.255.255',
    PUBLIC_IP,
  ])('treats IPv4 %s as public', ip => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it.each([
    '::',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    '2001:db8::1',
    '100::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
  ])('treats IPv6 %s as private', ip => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
    'treats IPv6 %s as public',
    ip => {
      expect(isPrivateAddress(ip)).toBe(false)
    }
  )

  it('fails closed on unparseable input', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
    expect(isPrivateAddress('999.1.1.1')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
    expect(isPrivateAddress('gggg::1')).toBe(true)
  })
})

describe('fetchPageHtml', () => {
  it('fetches a public page and returns html, status and final url', async () => {
    const { impl, calls } = fakeFetch(
      () =>
        new Response('<html>ok</html>', { status: 200, headers: HTML_HEADERS })
    )

    const result = await fetchPageHtml('https://example.gov.vn/luat', {
      lookup: lookupMap({ 'example.gov.vn': [PUBLIC_IP] }),
      fetchImpl: impl,
    })

    expect(result).toEqual({
      finalUrl: 'https://example.gov.vn/luat',
      html: '<html>ok</html>',
      status: 200,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.redirect).toBe('manual')
    expect(calls[0]?.init.signal).toBeDefined()
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(
      'Mozilla/5.0 (compatible; TH-PropTechBot/1.0)'
    )
    expect(headers.Accept).toBe('text/html,application/xhtml+xml')
  })

  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.5/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://2130706433/', // WHATWG normalises this to 127.0.0.1
  ])('blocks private literal host %s without any request', async url => {
    const { impl, calls } = fakeFetch(
      () => new Response('x', { status: 200, headers: HTML_HEADERS })
    )
    const code = await codeOf(
      fetchPageHtml(url, { lookup: lookupMap({}), fetchImpl: impl })
    )
    expect(code).toBe('BLOCKED')
    expect(calls).toHaveLength(0)
  })

  it('blocks localhost names without DNS', async () => {
    const lookup = jest.fn(lookupMap({}))
    const { impl, calls } = fakeFetch(() => new Response('x'))
    expect(
      await codeOf(
        fetchPageHtml('http://localhost/', { lookup, fetchImpl: impl })
      )
    ).toBe('BLOCKED')
    expect(
      await codeOf(
        fetchPageHtml('http://api.localhost/', { lookup, fetchImpl: impl })
      )
    ).toBe('BLOCKED')
    expect(lookup).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('blocks when the host resolves to a private address', async () => {
    const { impl, calls } = fakeFetch(() => new Response('x'))
    const code = await codeOf(
      fetchPageHtml('https://evil.example.com/', {
        lookup: lookupMap({ 'evil.example.com': ['10.1.2.3'] }),
        fetchImpl: impl,
      })
    )
    expect(code).toBe('BLOCKED')
    expect(calls).toHaveLength(0)
  })

  it('blocks when ANY resolved address is private (mixed answer)', async () => {
    const { impl, calls } = fakeFetch(() => new Response('x'))
    const code = await codeOf(
      fetchPageHtml('https://mixed.example.com/', {
        lookup: lookupMap({ 'mixed.example.com': [PUBLIC_IP, '127.0.0.1'] }),
        fetchImpl: impl,
      })
    )
    expect(code).toBe('BLOCKED')
    expect(calls).toHaveLength(0)
  })

  it('reports NETWORK when DNS fails or returns nothing', async () => {
    const { impl } = fakeFetch(() => new Response('x'))
    expect(
      await codeOf(
        fetchPageHtml('https://nowhere.example.com/', {
          lookup: lookupMap({}),
          fetchImpl: impl,
        })
      )
    ).toBe('NETWORK')
    expect(
      await codeOf(
        fetchPageHtml('https://empty.example.com/', {
          lookup: () => Promise.resolve([]),
          fetchImpl: impl,
        })
      )
    ).toBe('NETWORK')
  })

  it('rejects non-http(s) schemes, credentials and unusual ports', async () => {
    const { impl, calls } = fakeFetch(() => new Response('x'))
    const lookup = lookupMap({ 'example.com': [PUBLIC_IP] })
    const cases: Array<[string, SafeFetchErrorCode]> = [
      ['file:///etc/passwd', 'BLOCKED'],
      ['ftp://example.com/file', 'BLOCKED'],
      ['javascript:alert(1)', 'BLOCKED'],
      ['not a url', 'BLOCKED'],
      ['https://user:secret@example.com/', 'BLOCKED'],
      ['https://user@example.com/', 'BLOCKED'],
      ['http://example.com:8080/', 'BLOCKED'],
      ['https://example.com:8443/', 'BLOCKED'],
    ]
    for (const [url, expected] of cases) {
      expect(
        await codeOf(fetchPageHtml(url, { lookup, fetchImpl: impl }))
      ).toBe(expected)
    }
    expect(calls).toHaveLength(0)
  })

  it('allows the explicit default ports 80 and 443', async () => {
    const { impl } = fakeFetch(
      () => new Response('ok', { status: 200, headers: HTML_HEADERS })
    )
    const lookup = lookupMap({ 'example.com': [PUBLIC_IP] })
    await expect(
      fetchPageHtml('https://example.com:443/a', { lookup, fetchImpl: impl })
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      fetchPageHtml('http://example.com:80/a', { lookup, fetchImpl: impl })
    ).resolves.toMatchObject({ status: 200 })
  })

  it('blocks a redirect to a private host and does not request it', async () => {
    const { impl, calls } = fakeFetch(url => {
      if (url === 'https://public.example.com/')
        return new Response(null, {
          status: 302,
          headers: { location: 'http://internal.example.com/secret' },
        })
      return new Response('secret', { status: 200, headers: HTML_HEADERS })
    })

    const code = await codeOf(
      fetchPageHtml('https://public.example.com/', {
        lookup: lookupMap({
          'public.example.com': [PUBLIC_IP],
          'internal.example.com': ['10.0.0.9'],
        }),
        fetchImpl: impl,
      })
    )
    expect(code).toBe('BLOCKED')
    expect(calls.map(c => c.url)).toEqual(['https://public.example.com/'])
  })

  it('blocks a redirect to a private IP literal', async () => {
    const { impl, calls } = fakeFetch(
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'http://192.168.0.1/router' },
        })
    )
    const code = await codeOf(
      fetchPageHtml('https://public.example.com/', {
        lookup: lookupMap({ 'public.example.com': [PUBLIC_IP] }),
        fetchImpl: impl,
      })
    )
    expect(code).toBe('BLOCKED')
    expect(calls).toHaveLength(1)
  })

  it('blocks a redirect to a non-http scheme', async () => {
    const { impl } = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'file:///etc/passwd' },
        })
    )
    expect(
      await codeOf(
        fetchPageHtml('https://public.example.com/', {
          lookup: lookupMap({ 'public.example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
        })
      )
    ).toBe('BLOCKED')
  })

  it('follows a redirect chain between public hosts and re-validates each hop', async () => {
    const { impl, calls } = fakeFetch(url => {
      if (url === 'https://a.example.com/')
        return new Response(null, {
          status: 301,
          headers: { location: 'https://b.example.com/final' },
        })
      return new Response('<p>final</p>', {
        status: 200,
        headers: HTML_HEADERS,
      })
    })
    const lookup = jest.fn(
      lookupMap({ 'a.example.com': [PUBLIC_IP], 'b.example.com': ['1.1.1.1'] })
    )

    const result = await fetchPageHtml('https://a.example.com/', {
      lookup,
      fetchImpl: impl,
    })
    expect(result.finalUrl).toBe('https://b.example.com/final')
    expect(result.html).toBe('<p>final</p>')
    expect(lookup).toHaveBeenCalledWith('a.example.com')
    expect(lookup).toHaveBeenCalledWith('b.example.com')
    expect(calls).toHaveLength(2)
  })

  it('resolves relative redirect locations against the current URL', async () => {
    const { impl } = fakeFetch(url =>
      url.endsWith('/old')
        ? new Response(null, { status: 302, headers: { location: '/new' } })
        : new Response('ok', { status: 200, headers: HTML_HEADERS })
    )
    const result = await fetchPageHtml('https://example.com/old', {
      lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
      fetchImpl: impl,
    })
    expect(result.finalUrl).toBe('https://example.com/new')
  })

  it('stops after maxRedirects with NETWORK', async () => {
    const { impl } = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/again' },
        })
    )
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
          maxRedirects: 1,
        })
      )
    ).toBe('NETWORK')
  })

  it('reports HTTP when a redirect has no location', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 302 }))
    const err = await fetchPageHtml('https://example.com/', {
      lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
      fetchImpl: impl,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SafeFetchError)
    expect((err as SafeFetchError).code).toBe('HTTP')
    expect((err as SafeFetchError).status).toBe(302)
  })

  it('rejects non-2xx responses with HTTP and the status', async () => {
    const { impl } = fakeFetch(
      () => new Response('nope', { status: 404, headers: HTML_HEADERS })
    )
    const err = await fetchPageHtml('https://example.com/', {
      lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
      fetchImpl: impl,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SafeFetchError)
    expect((err as SafeFetchError).code).toBe('HTTP')
    expect((err as SafeFetchError).status).toBe(404)
  })

  it('rejects unsupported content types with BAD_TYPE', async () => {
    for (const type of [
      'application/pdf',
      'image/png',
      'application/json',
      '',
    ]) {
      const { impl } = fakeFetch(
        () =>
          new Response('%PDF', {
            status: 200,
            headers: { 'content-type': type },
          })
      )
      expect(
        await codeOf(
          fetchPageHtml('https://example.com/doc', {
            lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
            fetchImpl: impl,
          })
        )
      ).toBe('BAD_TYPE')
    }
  })

  it('accepts text/plain and application/xhtml+xml', async () => {
    for (const type of ['text/plain; charset=utf-8', 'application/xhtml+xml']) {
      const { impl } = fakeFetch(
        () =>
          new Response('ok', { status: 200, headers: { 'content-type': type } })
      )
      await expect(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
        })
      ).resolves.toMatchObject({ html: 'ok' })
    }
  })

  it('rejects a body larger than maxBytes with TOO_LARGE (streamed)', async () => {
    const { impl } = fakeFetch(() =>
      streamResponse(
        [
          new TextEncoder().encode('a'.repeat(60)),
          new TextEncoder().encode('b'.repeat(60)),
        ],
        { status: 200, headers: HTML_HEADERS }
      )
    )
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
          maxBytes: 100,
        })
      )
    ).toBe('TOO_LARGE')
  })

  it('rejects a declared content-length above maxBytes without reading the body', async () => {
    const { impl } = fakeFetch(
      () =>
        new Response('x'.repeat(10), {
          status: 200,
          headers: { ...HTML_HEADERS, 'content-length': '999999' },
        })
    )
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
          maxBytes: 1000,
        })
      )
    ).toBe('TOO_LARGE')
  })

  it('reports TIMEOUT when the request is aborted by the deadline', async () => {
    const { impl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
          timeoutMs: 20,
        })
      )
    ).toBe('TIMEOUT')
  })

  it('reports TIMEOUT for a TimeoutError thrown by fetch', async () => {
    const { impl } = fakeFetch(() => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
        })
      )
    ).toBe('TIMEOUT')
  })

  it('reports NETWORK for a generic fetch failure', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    expect(
      await codeOf(
        fetchPageHtml('https://example.com/', {
          lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
          fetchImpl: impl,
        })
      )
    ).toBe('NETWORK')
  })

  it('decodes iso-8859-1 / windows-1252 bodies when the charset says so', async () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]) // "café" in Latin-1
    const { impl } = fakeFetch(() =>
      streamResponse([bytes], {
        status: 200,
        headers: { 'content-type': 'text/html; charset=ISO-8859-1' },
      })
    )
    const result = await fetchPageHtml('https://example.com/', {
      lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
      fetchImpl: impl,
    })
    expect(result.html).toBe('café')
  })

  it('decodes UTF-8 by default', async () => {
    const { impl } = fakeFetch(
      () =>
        new Response('Điều 472', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    )
    const result = await fetchPageHtml('https://example.com/', {
      lookup: lookupMap({ 'example.com': [PUBLIC_IP] }),
      fetchImpl: impl,
    })
    expect(result.html).toBe('Điều 472')
  })
})
