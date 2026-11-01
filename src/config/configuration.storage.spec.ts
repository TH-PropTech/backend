import { afterEach, vi } from 'vitest'

import { configuration } from './configuration'
import { envValidationSchema } from './env.validation'

const STORAGE_ENV_KEYS = [
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_PUBLIC_BASE_URL',
] as const

describe('storage configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the S3 settings from the environment', () => {
    vi.stubEnv('AWS_REGION', 'ap-southeast-1')
    vi.stubEnv('AWS_S3_BUCKET', 'thproptech-bucket')
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA-TEST')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-test')
    vi.stubEnv('S3_PUBLIC_BASE_URL', 'https://cdn.example.com')

    expect(configuration().storage).toEqual({
      region: 'ap-southeast-1',
      bucket: 'thproptech-bucket',
      accessKeyId: 'AKIA-TEST',
      secretAccessKey: 'secret-test',
      publicBaseUrl: 'https://cdn.example.com',
    })
  })

  it('defaults every S3 setting to an empty string', () => {
    for (const key of STORAGE_ENV_KEYS) vi.stubEnv(key, undefined)

    expect(configuration().storage).toEqual({
      region: '',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      publicBaseUrl: '',
    })
  })
})

describe('storage environment validation', () => {
  const baseEnvironment = {
    DATABASE_URL: 'mongodb://localhost:27017/th_proptech_test',
    EKYC_SERVICE_URL: 'https://ekyc.example.com',
  }

  it('accepts a configuration without any S3 variable', () => {
    const result = envValidationSchema.validate(baseEnvironment)

    expect(result.error).toBeUndefined()
  })

  it('accepts empty S3 variables', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      AWS_REGION: '',
      AWS_S3_BUCKET: '',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      S3_PUBLIC_BASE_URL: '',
    })

    expect(result.error).toBeUndefined()
  })

  it('accepts a full S3 configuration', () => {
    const result = envValidationSchema.validate({
      ...baseEnvironment,
      AWS_REGION: 'ap-southeast-1',
      AWS_S3_BUCKET: 'thproptech-bucket',
      AWS_ACCESS_KEY_ID: 'AKIA-TEST',
      AWS_SECRET_ACCESS_KEY: 'secret-test',
      S3_PUBLIC_BASE_URL: 'https://cdn.example.com',
    })

    expect(result.error).toBeUndefined()
  })
})
