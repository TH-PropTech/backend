import 'reflect-metadata'
import { PassThrough, Writable } from 'node:stream'
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ContractsController } from './contracts.controller'
import { EvidencePackageQueryDto } from './dto/evidence-package-query.dto'
import { RolesGuard } from '../../common/guards/roles.guard'
import type { PreparedEvidenceExport } from './contract-evidence-package.export.service'

type FakeResponse = Writable & {
  headers: Record<string, string>
  headersSent: boolean
  setHeader: (name: string, value: string) => void
  removeHeader: (name: string) => void
  chunks: Buffer[]
}

function fakeResponse(): FakeResponse {
  const chunks: Buffer[] = []
  const response = new Writable({
    write(chunk: Buffer, _e, cb): void {
      response.headersSent = true
      chunks.push(chunk)
      cb()
    },
  }) as FakeResponse
  response.headers = {}
  response.headersSent = false
  response.chunks = chunks
  response.setHeader = (name, value): void => {
    response.headers[name.toLowerCase()] = value
  }
  response.removeHeader = (name): void => {
    delete response.headers[name.toLowerCase()]
  }
  return response
}

describe('ContractsController GET :id/evidence-package (PROP-399 task 9.6)', () => {
  let exportService: { prepare: jest.Mock }
  let controller: ContractsController
  const user = { _id: 'tenant-1', roles: ['tenant'] }

  function prepared(
    run: (destination: Writable, signal?: AbortSignal) => Promise<void>
  ): PreparedEvidenceExport {
    return {
      filename: 'evidence-HD1-r2.zip',
      contentType: 'application/zip',
      packageHash: 'a'.repeat(64),
      revision: 2,
      run,
    }
  }

  beforeEach(() => {
    exportService = { prepare: jest.fn() }
    controller = new ContractsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      exportService as never
    )
  })

  it('streams the package with the download headers and the verified package hash', async () => {
    exportService.prepare.mockResolvedValue(
      prepared(async destination => {
        destination.write(Buffer.from('PK-zip-bytes'))
        destination.end()
        await new Promise(resolve => destination.once('finish', resolve))
      })
    )
    const response = fakeResponse()

    await controller.downloadEvidencePackage(
      'c-1',
      { revision: 2 },
      user,
      response as never
    )

    expect(exportService.prepare).toHaveBeenCalledWith(
      'c-1',
      { id: 'tenant-1', roles: ['tenant'] },
      { revision: 2 }
    )
    expect(response.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="evidence-HD1-r2.zip"',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-evidence-package-hash': 'a'.repeat(64),
      'x-evidence-package-revision': '2',
    })
    expect(Buffer.concat(response.chunks).toString()).toBe('PK-zip-bytes')
  })

  it('works without a revision (current artifact) and for staff/admin actors', async () => {
    exportService.prepare.mockResolvedValue(prepared(() => Promise.resolve()))
    await controller.downloadEvidencePackage(
      'c-1',
      {},
      { _id: 'staff-1', roles: ['staff'] },
      fakeResponse() as never
    )
    expect(exportService.prepare).toHaveBeenCalledWith(
      'c-1',
      { id: 'staff-1', roles: ['staff'] },
      { revision: undefined }
    )
  })

  it.each([
    [
      'forbidden unrelated user',
      new ForbiddenException('CONTRACT_ACCESS_DENIED'),
    ],
    ['unknown contract', new NotFoundException('CONTRACT_NOT_FOUND')],
    [
      'version not found',
      new NotFoundException({ code: 'EVIDENCE_VERSION_NOT_FOUND' }),
    ],
    [
      'incomplete evidence',
      new UnprocessableEntityException({ code: 'EVIDENCE_PACKAGE_INCOMPLETE' }),
    ],
    [
      'artifact mismatch',
      new ConflictException({ code: 'EVIDENCE_ARTIFACT_MISMATCH' }),
    ],
    [
      'too large',
      new PayloadTooLargeException({
        code: 'EVIDENCE_PACKAGE_TOO_LARGE',
        limit: 'maxBytes',
      }),
    ],
  ])(
    'propagates %s before writing any byte or header',
    async (_label, error) => {
      exportService.prepare.mockRejectedValue(error)
      const response = fakeResponse()
      await expect(
        controller.downloadEvidencePackage('c-1', {}, user, response as never)
      ).rejects.toBe(error)
      expect(response.headers).toEqual({})
      expect(response.chunks).toHaveLength(0)
    }
  )

  it('removes the zip headers and rethrows when streaming fails before the first byte', async () => {
    const failure = new UnprocessableEntityException({
      code: 'EVIDENCE_PACKAGE_INCOMPLETE',
    })
    exportService.prepare.mockResolvedValue(
      prepared(() => Promise.reject(failure))
    )
    const response = fakeResponse()
    await expect(
      controller.downloadEvidencePackage('c-1', {}, user, response as never)
    ).rejects.toBe(failure)
    expect(response.headers).toEqual({})
  })

  it('swallows a failure after the response started (the connection is already being torn down)', async () => {
    exportService.prepare.mockResolvedValue(
      prepared(destination => {
        destination.write(Buffer.from('partial'))
        return Promise.reject(new Error('stream broke'))
      })
    )
    const response = fakeResponse()
    await expect(
      controller.downloadEvidencePackage('c-1', {}, user, response as never)
    ).resolves.toBeUndefined()
  })

  it('aborts the export when the client disconnects before completion', async () => {
    let received: AbortSignal | undefined
    exportService.prepare.mockResolvedValue(
      prepared((destination, signal) => {
        received = signal
        return new Promise(resolve => {
          setImmediate(() => {
            destination.destroy() // client closes
            resolve()
          })
        })
      })
    )
    const response = new PassThrough() as unknown as FakeResponse
    response.headers = {}
    response.headersSent = false
    response.setHeader = (name, value): void => {
      response.headers[name.toLowerCase()] = value
    }
    response.removeHeader = (): void => undefined

    await controller.downloadEvidencePackage('c-1', {}, user, response as never)
    expect(received?.aborted).toBe(true)
  })

  it('does not abort a completed export when the response closes normally', async () => {
    let received: AbortSignal | undefined
    exportService.prepare.mockResolvedValue(
      prepared(async (destination, signal) => {
        received = signal
        destination.end('done')
        await new Promise(resolve => destination.once('finish', resolve))
      })
    )
    await controller.downloadEvidencePackage(
      'c-1',
      {},
      user,
      fakeResponse() as never
    )
    expect(received?.aborted).toBe(false)
  })

  it('reports the feature as unavailable when the export service is not wired', async () => {
    const bare = new ContractsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    )
    await expect(
      bare.downloadEvidencePackage('c-1', {}, user, fakeResponse() as never)
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  describe('contract (roles, Swagger, query validation)', () => {
    const guard = new RolesGuard(new Reflector())
    const handler = (
      ContractsController.prototype as unknown as Record<string, () => unknown>
    ).downloadEvidencePackage as () => unknown
    const allows = (roles: string[]): boolean => {
      try {
        return guard.canActivate({
          getHandler: (): unknown => handler,
          getClass: (): unknown => ContractsController,
          switchToHttp: (): unknown => ({
            getRequest: (): unknown => ({ user: { roles } }),
          }),
        } as unknown as ExecutionContext)
      } catch (error) {
        if (error instanceof ForbiddenException) return false
        throw error
      }
    }

    it('is open to participants and operators; relationship checks are enforced by the service', () => {
      for (const role of ['tenant', 'landlord', 'staff', 'admin']) {
        expect(allows([role])).toBe(true)
      }
      expect(allows(['guest'])).toBe(false)
      expect(allows([])).toBe(false)
    })

    it('documents a binary application/zip response with its error responses', () => {
      expect(Reflect.getMetadata('swagger/apiProduces', handler)).toEqual([
        'application/zip',
      ])
      const responses = Reflect.getMetadata(
        'swagger/apiResponse',
        handler
      ) as Record<
        string,
        {
          content?: Record<string, { schema: { type: string; format: string } }>
        }
      >
      expect(responses['200']?.content?.['application/zip']?.schema).toEqual({
        type: 'string',
        format: 'binary',
      })
      for (const status of ['403', '404', '409', '413', '422']) {
        expect(responses[status]).toBeDefined()
      }
    })

    it('validates the revision query', async () => {
      const ok = plainToInstance(EvidencePackageQueryDto, { revision: '3' })
      expect(ok.revision).toBe(3)
      expect(await validate(ok)).toHaveLength(0)
      expect(
        await validate(plainToInstance(EvidencePackageQueryDto, {}))
      ).toHaveLength(0)
      for (const bad of ['0', '-1', '1.5', 'x', '100001']) {
        const dto = plainToInstance(EvidencePackageQueryDto, { revision: bad })
        expect((await validate(dto)).map(e => e.property)).toEqual(['revision'])
      }
    })
  })
})
