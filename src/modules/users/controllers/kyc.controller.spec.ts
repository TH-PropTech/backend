import { BadRequestException } from '@nestjs/common'

import { KycController } from './kyc.controller'
import type { EkycClient } from '../../ekyc/services/ekyc-client.service'
import type { KycService } from '../services/kyc.service'

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
  const ekycClient = {
    ocrFront: jest.fn(),
    ocrBack: jest.fn(),
    verifyFace: jest.fn(),
  }
  let controller: KycController

  beforeEach(() => {
    jest.clearAllMocks()
    controller = new KycController(
      kycService as unknown as KycService,
      ekycClient as unknown as EkycClient
    )
  })

  it('rejects missing front OCR media', async () => {
    await expect(controller.ocrFront(undefined)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(ekycClient.ocrFront).not.toHaveBeenCalled()
  })

  it('rejects spoofed image bytes before proxying', async () => {
    const invalid = createImage('frontID')
    invalid.buffer = Buffer.from('not an image')
    invalid.size = invalid.buffer.length

    await expect(controller.ocrFront(invalid)).rejects.toBeInstanceOf(
      BadRequestException
    )
    expect(ekycClient.ocrFront).not.toHaveBeenCalled()
  })

  it('returns the face result of a precheck without storing anything', async () => {
    const face = {
      liveness: true,
      spoofScore: 0.1,
      match: true,
      distance: 0.4,
      threshold: 0.85,
    }
    ekycClient.verifyFace.mockResolvedValue(face)
    const selfie = createImage('selfie')
    const frontID = createImage('frontID')

    await expect(
      controller.faceVerify({ selfie: [selfie], frontID: [frontID] })
    ).resolves.toEqual(face)
    expect(ekycClient.verifyFace).toHaveBeenCalledWith(selfie, frontID)
  })

  it('reports no-match and spoof results as data, not errors', async () => {
    ekycClient.verifyFace.mockResolvedValue({
      liveness: false,
      spoofScore: 0.9,
      match: false,
      distance: 1.2,
      threshold: 0.85,
    })

    await expect(
      controller.faceVerify({
        selfie: [createImage('selfie')],
        frontID: [createImage('frontID')],
      })
    ).resolves.toMatchObject({ liveness: false, match: false })
  })

  it('rejects face-verify with a missing selfie or card', async () => {
    await expect(
      controller.faceVerify({ frontID: [createImage('frontID')] })
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      controller.faceVerify({ selfie: [createImage('selfie')] })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(ekycClient.verifyFace).not.toHaveBeenCalled()
  })

  it('rejects spoofed selfie bytes before proxying', async () => {
    const invalid = createImage('selfie')
    invalid.buffer = Buffer.from('not an image')
    invalid.size = invalid.buffer.length

    await expect(
      controller.faceVerify({
        selfie: [invalid],
        frontID: [createImage('frontID')],
      })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(ekycClient.verifyFace).not.toHaveBeenCalled()
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
