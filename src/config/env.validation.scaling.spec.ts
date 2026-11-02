import { configuration } from './configuration'
import { envValidationSchema } from './env.validation'

describe('read-scaling configuration', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/th_proptech_test',
    EKYC_SERVICE_URL: 'https://ekyc.example.com',
  }

  it('applies defaults for proxy hops, cache TTL and listing limit', () => {
    const result = envValidationSchema.validate(baseEnvironment)

    expect(result.error).toBeUndefined()
    expect(result.value).toMatchObject({
      TRUST_PROXY_HOPS: 1,
      CACHE_TTL_SECONDS: 30,
      LISTING_MAX_LIMIT: 200,
    })
  })

  it('rejects out-of-range values', () => {
    const result = envValidationSchema.validate(
      {
        ...baseEnvironment,
        TRUST_PROXY_HOPS: 9,
        CACHE_TTL_SECONDS: 0,
        LISTING_MAX_LIMIT: 5000,
      },
      { abortEarly: false }
    )

    expect(result.error?.message).toContain('TRUST_PROXY_HOPS')
    expect(result.error?.message).toContain('CACHE_TTL_SECONDS')
    expect(result.error?.message).toContain('LISTING_MAX_LIMIT')
  })

  it('exposes the values through configuration()', () => {
    const config = configuration()

    expect(config.security.trustProxyHops).toBe(1)
    expect(config.cache.ttlSeconds).toBe(30)
    expect(config.listing.maxLimit).toBe(200)
  })
})
