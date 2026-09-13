import { BadRequestException } from '@nestjs/common'

import { BiometricGrantService } from './biometric-grant.service'
import { KycController } from './kyc.controller'
import type { EkycProxyService } from './ekyc-proxy.service'
import type { KycService } from './kyc.service'

function createImage(fieldname: string): Express.Multer.File {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
  return {
    fieldname,
    originalname: `${fieldname}.jpg`,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  }
}

describe('KycController eKYC boundaries', () => {
  const kycService = {
    findMine: jest.fn(),
    readMedia: jest.fn(),
  }
  const proxy = {
    ocrFront: jest.fn(),
    ocrBack: jest.fn(),
    verifyFace: jest.fn(),
    verifyFaceMatch: jest.fn(),
    detectOrientation: jest.fn(),
  }
  let grants: BiometricGrantService
  let controller: KycController

  beforeEach(() => {
    jest.clearAllMocks()
    grants = new BiometricGrantService()
    controller = new KycController(
      kycService as unknown as KycService,
      proxy as unknown as EkycProxyService,
      grants
    )
  })

  it('rejects missing front OCR media', async () => {
    await expect(controller.ocrFront(undefined)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(proxy.ocrFront).not.toHaveBeenCalled()
  })

  it('rejects spoofed image bytes before proxying', async () => {
    const invalid = createImage('frontID')
    invalid.buffer = Buffer.from('not an image')
    invalid.size = invalid.buffer.length

    await expect(controller.ocrFront(invalid)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(proxy.ocrFront).not.toHaveBeenCalled()
  })

  it('creates a user-scoped grant after successful verification', async () => {
    const result = {
      verified: true,
      faceMatch: true,
      liveness: true,
      realConfidence: 0.91,
    }
    proxy.verifyFace.mockResolvedValue(result)

    await expect(
      controller.verifyFace('user-1', {
        portraitImages: [createImage('portraitImages')],
        frontID: [createImage('frontID')],
      })
    ).resolves.toEqual(result)
    expect(grants.consume('user-1')).toEqual(result)
  })

  it('proxies a valid face orientation request', async () => {
    const result = {
      success: true,
      orientation: 'center',
      expected: 'center',
    }
    proxy.detectOrientation.mockResolvedValue(result)

    await expect(
      controller.faceOrientation(createImage('frame'), 'center')
    ).resolves.toEqual(result)
    expect(proxy.detectOrientation).toHaveBeenCalledWith(
      expect.objectContaining({ fieldname: 'frame' }),
      'center'
    )
  })

  it('rejects unsupported orientation before proxying', async () => {
    await expect(
      controller.faceOrientation(createImage('frame'), 'up')
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(proxy.detectOrientation).not.toHaveBeenCalled()
  })

  it('proxies up to seven portrait images to face matching', async () => {
    const result = {
      verified: true,
      faceMatch: true,
      verificationMode: 'face-match-only' as const,
    }
    proxy.verifyFaceMatch.mockResolvedValue(result)
    const portraits = [
      createImage('portraitImages'),
      createImage('portraitImages'),
    ]

    await expect(
      controller.faceMatch({
        portraitImages: portraits,
        frontID: [createImage('frontID')],
      })
    ).resolves.toEqual(result)
    expect(proxy.verifyFaceMatch).toHaveBeenCalledWith(
      portraits,
      expect.objectContaining({ fieldname: 'frontID' })
    )
  })

  it('returns only the current user KYC status', async () => {
    const mine = { status: 'pending', fullName: 'Nguyen Van A' }
    kycService.findMine.mockResolvedValue(mine)

    await expect(controller.findMine('user-1')).resolves.toEqual(mine)
    expect(kycService.findMine).toHaveBeenCalledWith('user-1')
  })

  it('serves authorized media without public caching', async () => {
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    }
    const image = Buffer.from('image')
    kycService.readMedia.mockResolvedValue({
      buffer: image,
      mimetype: 'image/jpeg',
    })

    await controller.getMedia(
      'record-1',
      'front-card',
      'user-1',
      [],
      response as never
    )

    expect(kycService.readMedia).toHaveBeenCalledWith(
      'record-1',
      'front-card',
      'user-1',
      []
    )
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store'
    )
    expect(response.send).toHaveBeenCalledWith(image)
  })

  it('rejects unknown media fields before reading storage', async () => {
    await expect(
      controller.getMedia('record-1', 'document', 'user-1', [], {} as never)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(kycService.readMedia).not.toHaveBeenCalled()
  })
})
