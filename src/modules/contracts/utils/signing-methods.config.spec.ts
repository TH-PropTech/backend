import {
  isSigningMethodEnabled,
  resolveEnabledSigningMethods,
} from './signing-methods.config'

describe('resolveEnabledSigningMethods', () => {
  const original = process.env['ENABLE_TEST_SIGN_BYPASS']
  const originalNodeEnv = process.env['NODE_ENV']
  afterEach(() => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = original
    process.env['NODE_ENV'] = originalNodeEnv
  })

  it('defaults to smartca_v1 only', () => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'false'
    expect(resolveEnabledSigningMethods({})).toEqual(['smartca_v1'])
  })

  it('enables smartca_v2 only through its dedicated flag', () => {
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'false'
    expect(
      resolveEnabledSigningMethods({ SIGNING_METHODS: 'smartca_v2' })
    ).not.toContain('smartca_v2')
    expect(
      resolveEnabledSigningMethods({ SMARTCA_V2_ENABLED: 'true' })
    ).toContain('smartca_v2')
  })

  it('enables dev_sign only when the bypass is on outside production', () => {
    process.env['NODE_ENV'] = 'development'
    process.env['ENABLE_TEST_SIGN_BYPASS'] = 'true'
    expect(isSigningMethodEnabled('dev_sign', {})).toBe(true)
    process.env['NODE_ENV'] = 'production'
    expect(isSigningMethodEnabled('dev_sign', {})).toBe(false)
  })
})
