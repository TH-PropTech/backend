import type { ContractFlowActionDto } from '../dto/contract-view.dto'
import {
  projectContractFlow,
  type ContractFlowFacts,
} from './contract-flow.projector'

const at = (iso: string): Date => new Date(iso)

const facts = (
  overrides: Partial<ContractFlowFacts> = {}
): ContractFlowFacts => ({
  strategy: 'DEPOSIT_FIRST',
  contractStatus: 'draft',
  executionMethod: 'POC_ECONSENT',
  isConfigOutdated: false,
  agreement: {
    status: 'draft',
    hasConsent: false,
    consentedAt: null,
    contentRevision: 1,
    contentHash: 'deposit-hash',
  },
  deposit: { required: true, confirmed: false, paidAt: null },
  contentLockedAt: null,
  hasArtifact: false,
  signatures: {
    tenant: { signed: false, signedAt: null },
    landlord: { signed: false, signedAt: null },
  },
  kycVerified: { tenant: true, landlord: true },
  activationFailureCode: null,
  ledger: { status: 'not-requested', recordedAt: null },
  viewer: { isTenant: true, isLandlord: false, isStaff: false },
  ...overrides,
})

const consented = {
  status: 'accepted' as const,
  hasConsent: true,
  consentedAt: at('2026-09-20T01:00:00Z'),
  contentRevision: 1,
  contentHash: 'deposit-hash',
}
const paid = {
  ...consented,
  status: 'paid' as const,
}
const bothSigned = {
  tenant: { signed: true, signedAt: at('2026-09-22T01:00:00Z') },
  landlord: { signed: true, signedAt: at('2026-09-22T02:00:00Z') },
}
const asLandlord = { isTenant: false, isLandlord: true, isStaff: false }
const asStaff = { isTenant: false, isLandlord: false, isStaff: true }

const stageStatus = (
  flow: ReturnType<typeof projectContractFlow>
): Record<string, string> =>
  Object.fromEntries(flow.stages.map(stage => [stage.key, stage.status]))
const action = (
  flow: ReturnType<typeof projectContractFlow>,
  key: string
): ContractFlowActionDto | undefined =>
  flow.nextActions.find(candidate => candidate.action === key)

describe('projectContractFlow — stages', () => {
  it('DEPOSIT_FIRST vừa provision: document active, còn lại upcoming', () => {
    const flow = projectContractFlow(facts())

    expect(flow.version).toBe(1)
    expect(flow.strategy).toBe('DEPOSIT_FIRST')
    expect(flow.stages.map(stage => stage.key)).toEqual([
      'document',
      'deposit',
      'signing',
      'ledger',
    ])
    expect(stageStatus(flow)).toEqual({
      document: 'active',
      deposit: 'upcoming',
      signing: 'upcoming',
      ledger: 'upcoming',
    })
    expect(flow.activeStage).toBe('document')
  })

  it('DEPOSIT_FIRST sau khi tenant đồng ý cọc: document done, deposit active', () => {
    const flow = projectContractFlow(facts({ agreement: consented }))

    expect(stageStatus(flow)).toMatchObject({
      document: 'done',
      deposit: 'active',
    })
    expect(flow.stages[0]?.completedAt).toBe('2026-09-20T01:00:00.000Z')
    expect(flow.activeStage).toBe('deposit')
  })

  it('DEPOSIT_FIRST đã xác nhận cọc nhưng chưa khóa: signing active với CONTENT_NOT_LOCKED', () => {
    const flow = projectContractFlow(
      facts({
        agreement: paid,
        deposit: {
          required: true,
          confirmed: true,
          paidAt: at('2026-09-21T01:00:00Z'),
        },
      })
    )

    const signing = flow.stages.find(stage => stage.key === 'signing')
    expect(flow.activeStage).toBe('signing')
    expect(signing?.status).toBe('active')
    expect(signing?.blockers).toContainEqual({
      code: 'CONTENT_NOT_LOCKED',
      partyRole: null,
    })
    expect(flow.stages[1]?.completedAt).toBe('2026-09-21T01:00:00.000Z')
  })

  it('SIGN_FIRST đã ký đủ hai bên nhưng chưa có cọc: signing done, deposit active', () => {
    const flow = projectContractFlow(
      facts({
        strategy: 'SIGN_FIRST',
        contractStatus: 'fully-signed-pending-deposit',
        agreement: consented,
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        signatures: bothSigned,
      })
    )

    expect(flow.stages.map(stage => stage.key)).toEqual([
      'document',
      'signing',
      'deposit',
      'ledger',
    ])
    expect(stageStatus(flow)).toMatchObject({
      document: 'done',
      signing: 'done',
      deposit: 'active',
    })
    expect(
      flow.stages.find(stage => stage.key === 'signing')?.completedAt
    ).toBe('2026-09-22T02:00:00.000Z')
  })

  it('SIGN_FIRST: tenant đồng ý cọc trước khi ký thì signing vẫn active', () => {
    const flow = projectContractFlow(
      facts({
        strategy: 'SIGN_FIRST',
        contractStatus: 'awaiting-signature',
        agreement: consented,
        contentLockedAt: at('2026-09-19T01:00:00Z'),
      })
    )

    expect(flow.activeStage).toBe('signing')
  })

  it('SIGN_FIRST với SmartCA: document chỉ xong khi artifact đã khóa', () => {
    const base = facts({
      strategy: 'SIGN_FIRST',
      executionMethod: 'SMARTCA',
      contractStatus: 'awaiting-signature',
      contentLockedAt: at('2026-09-19T01:00:00Z'),
    })

    expect(projectContractFlow(base).activeStage).toBe('document')
    expect(
      projectContractFlow({ ...base, hasArtifact: true }).activeStage
    ).toBe('signing')
  })

  it.each(['pending', 'processing'] as const)(
    'hợp đồng active, sổ cái %s: ledger active và chưa được báo xác nhận',
    status => {
      const flow = projectContractFlow(
        facts({
          contractStatus: 'active',
          agreement: paid,
          deposit: { required: true, confirmed: true, paidAt: null },
          contentLockedAt: at('2026-09-19T01:00:00Z'),
          signatures: bothSigned,
          ledger: { status, recordedAt: null },
        })
      )

      expect(flow.activeStage).toBe('ledger')
      expect(stageStatus(flow).ledger).toBe('active')
    }
  )

  it('sự kiện sổ cái thất bại vĩnh viễn: ledger blocked LEDGER_FAILED_TERMINAL', () => {
    const flow = projectContractFlow(
      facts({
        contractStatus: 'active',
        agreement: paid,
        deposit: { required: true, confirmed: true, paidAt: null },
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        signatures: bothSigned,
        ledger: { status: 'failed-terminal', recordedAt: null },
      })
    )

    const ledger = flow.stages.find(stage => stage.key === 'ledger')
    expect(ledger?.status).toBe('blocked')
    expect(ledger?.blockers).toEqual([
      { code: 'LEDGER_FAILED_TERMINAL', partyRole: null },
    ])
    expect(flow.activeStage).toBe('ledger')
  })

  it('kích hoạt lỗi sau khi nhận cọc: ledger blocked ACTIVATION_FAILED', () => {
    const flow = projectContractFlow(
      facts({
        strategy: 'SIGN_FIRST',
        contractStatus: 'fully-signed-pending-deposit',
        agreement: paid,
        deposit: { required: true, confirmed: true, paidAt: null },
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        signatures: bothSigned,
        activationFailureCode: 'SMARTCA_SIGNATURE_REQUIRED',
      })
    )

    const ledger = flow.stages.find(stage => stage.key === 'ledger')
    expect(ledger?.status).toBe('blocked')
    expect(ledger?.blockers).toEqual([
      { code: 'ACTIVATION_FAILED', partyRole: null },
    ])
  })

  it('sổ cái đã xác nhận: mọi stage done và activeStage=completed', () => {
    const flow = projectContractFlow(
      facts({
        contractStatus: 'active',
        agreement: paid,
        deposit: { required: true, confirmed: true, paidAt: null },
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        signatures: bothSigned,
        ledger: {
          status: 'confirmed-fabric',
          recordedAt: at('2026-09-23T01:00:00Z'),
        },
      })
    )

    expect(Object.values(stageStatus(flow))).toEqual([
      'done',
      'done',
      'done',
      'done',
    ])
    expect(flow.activeStage).toBe('completed')
    expect(flow.stages[3]?.completedAt).toBe('2026-09-23T01:00:00.000Z')
  })

  it('hợp đồng cancelled: activeStage=completed, stage chưa xong là skipped', () => {
    const flow = projectContractFlow(facts({ contractStatus: 'cancelled' }))

    expect(flow.activeStage).toBe('completed')
    expect(stageStatus(flow).document).toBe('skipped')
  })

  it('hợp đồng terminated khi sổ cái chưa xác nhận: ledger skipped, activeStage=completed', () => {
    const flow = projectContractFlow(
      facts({
        contractStatus: 'terminated',
        ledger: { status: 'pending', recordedAt: null },
      })
    )

    expect(flow.activeStage).toBe('completed')
    expect(stageStatus(flow)).toMatchObject({
      document: 'done',
      ledger: 'skipped',
    })
  })

  it('thỏa thuận cọc bị hủy: deposit blocked DEPOSIT_AGREEMENT_CLOSED', () => {
    const flow = projectContractFlow(
      facts({
        agreement: { ...consented, status: 'cancelled' },
      })
    )

    const deposit = flow.stages.find(stage => stage.key === 'deposit')
    expect(deposit?.status).toBe('blocked')
    expect(deposit?.blockers).toEqual([
      { code: 'DEPOSIT_AGREEMENT_CLOSED', partyRole: null },
    ])
  })

  it('cọc bắt buộc nhưng thiếu thỏa thuận: deposit báo DEPOSIT_AGREEMENT_MISSING', () => {
    const flow = projectContractFlow(
      facts({
        agreement: null,
        contentLockedAt: at('2026-09-19T01:00:00Z'),
      })
    )

    const deposit = flow.stages.find(stage => stage.key === 'deposit')
    expect(flow.activeStage).toBe('deposit')
    expect(deposit?.status).toBe('blocked')
    expect(deposit?.blockers).toEqual([
      { code: 'DEPOSIT_AGREEMENT_MISSING', partyRole: null },
    ])
  })

  it('cọc bằng 0 và không có thỏa thuận: document chỉ cần khóa nội dung, deposit done', () => {
    const flow = projectContractFlow(
      facts({
        agreement: null,
        deposit: { required: false, confirmed: true, paidAt: null },
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        contractStatus: 'awaiting-signature',
      })
    )

    expect(stageStatus(flow)).toMatchObject({
      document: 'done',
      deposit: 'done',
      signing: 'active',
    })
  })

  it('báo sớm KYC_NOT_VERIFIED của landlord ngay từ stage document', () => {
    const flow = projectContractFlow(
      facts({ kycVerified: { tenant: true, landlord: false } })
    )

    const signing = flow.stages.find(stage => stage.key === 'signing')
    expect(flow.activeStage).toBe('document')
    expect(signing?.status).toBe('upcoming')
    expect(signing?.blockers).toEqual([
      { code: 'KYC_NOT_VERIFIED', partyRole: 'landlord' },
    ])
  })

  it('không báo KYC cho bên đã ký', () => {
    const flow = projectContractFlow(
      facts({
        strategy: 'SIGN_FIRST',
        contractStatus: 'awaiting-signature',
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        kycVerified: { tenant: false, landlord: true },
        signatures: {
          tenant: { signed: true, signedAt: null },
          landlord: { signed: false, signedAt: null },
        },
      })
    )

    expect(
      flow.stages.find(stage => stage.key === 'signing')?.blockers
    ).toEqual([])
  })
})

describe('projectContractFlow — nextActions', () => {
  it('tenant chưa đồng ý cọc: CONSENT_DEPOSIT bật, PAY_DEPOSIT tắt DEPOSIT_NOT_READY', () => {
    const flow = projectContractFlow(facts())

    expect(action(flow, 'CONSENT_DEPOSIT')).toEqual({
      action: 'CONSENT_DEPOSIT',
      actorRole: 'tenant',
      enabled: true,
      reasonCode: null,
      stage: 'deposit',
    })
    expect(action(flow, 'PAY_DEPOSIT')).toMatchObject({
      enabled: false,
      reasonCode: 'DEPOSIT_NOT_READY',
    })
  })

  it('tenant đã đồng ý: PAY_DEPOSIT bật, không còn CONSENT_DEPOSIT', () => {
    const flow = projectContractFlow(facts({ agreement: consented }))

    expect(action(flow, 'CONSENT_DEPOSIT')).toBeUndefined()
    expect(action(flow, 'PAY_DEPOSIT')).toMatchObject({ enabled: true })
  })

  it('landlord không có CONSENT_DEPOSIT hay PAY_DEPOSIT', () => {
    const flow = projectContractFlow(facts({ viewer: asLandlord }))

    expect(action(flow, 'CONSENT_DEPOSIT')).toBeUndefined()
    expect(action(flow, 'PAY_DEPOSIT')).toBeUndefined()
    expect(action(flow, 'LOCK_CONTENT')).toMatchObject({
      actorRole: 'landlord',
      enabled: true,
      stage: 'document',
    })
  })

  it('staff xem hợp đồng draft: LOCK_CONTENT bật, không có hành động ký', () => {
    const flow = projectContractFlow(facts({ viewer: asStaff }))

    expect(action(flow, 'LOCK_CONTENT')).toMatchObject({
      actorRole: 'staff',
      enabled: true,
    })
    expect(action(flow, 'SIGN_ECONSENT')).toBeUndefined()
    expect(action(flow, 'CONSENT_DEPOSIT')).toBeUndefined()
  })

  it('tenant không được khóa nội dung', () => {
    expect(action(projectContractFlow(facts()), 'LOCK_CONTENT')).toBeUndefined()
  })

  it('SmartCA đã khóa nội dung: landlord có LOCK_ARTIFACT, tenant có SIGN_SMARTCA tắt ARTIFACT_NOT_LOCKED', () => {
    const base = facts({
      executionMethod: 'SMARTCA',
      contractStatus: 'awaiting-signature',
      agreement: paid,
      deposit: { required: true, confirmed: true, paidAt: null },
      contentLockedAt: at('2026-09-19T01:00:00Z'),
    })

    expect(
      action(
        projectContractFlow({ ...base, viewer: asLandlord }),
        'LOCK_ARTIFACT'
      )
    ).toMatchObject({ enabled: true, stage: 'document' })
    expect(action(projectContractFlow(base), 'SIGN_SMARTCA')).toMatchObject({
      enabled: false,
      reasonCode: 'ARTIFACT_NOT_LOCKED',
      stage: 'signing',
    })
    expect(action(projectContractFlow(base), 'SIGN_ECONSENT')).toBeUndefined()
  })

  it('SmartCA đủ điều kiện: SIGN_SMARTCA bật', () => {
    const flow = projectContractFlow(
      facts({
        executionMethod: 'SMARTCA',
        contractStatus: 'awaiting-signature',
        agreement: paid,
        deposit: { required: true, confirmed: true, paidAt: null },
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        hasArtifact: true,
      })
    )

    expect(action(flow, 'SIGN_SMARTCA')).toMatchObject({ enabled: true })
  })

  it('e-consent DEPOSIT_FIRST chưa có cọc: SIGN_ECONSENT tắt DEPOSIT_REQUIRED', () => {
    const flow = projectContractFlow(
      facts({
        contractStatus: 'awaiting-signature',
        agreement: consented,
        contentLockedAt: at('2026-09-19T01:00:00Z'),
      })
    )

    expect(action(flow, 'SIGN_ECONSENT')).toMatchObject({
      enabled: false,
      reasonCode: 'DEPOSIT_REQUIRED',
    })
  })

  it('landlord chưa eKYC: COMPLETE_KYC bật cho landlord, tenant không có', () => {
    const kycFacts = { kycVerified: { tenant: true, landlord: false } }

    expect(
      action(
        projectContractFlow(facts({ ...kycFacts, viewer: asLandlord })),
        'COMPLETE_KYC'
      )
    ).toMatchObject({ actorRole: 'landlord', enabled: true, stage: 'signing' })
    expect(
      action(projectContractFlow(facts(kycFacts)), 'COMPLETE_KYC')
    ).toBeUndefined()
  })

  it('bên đã ký không còn hành động ký', () => {
    const flow = projectContractFlow(
      facts({
        strategy: 'SIGN_FIRST',
        contractStatus: 'awaiting-signature',
        contentLockedAt: at('2026-09-19T01:00:00Z'),
        signatures: {
          tenant: { signed: true, signedAt: null },
          landlord: { signed: false, signedAt: null },
        },
      })
    )

    expect(action(flow, 'SIGN_ECONSENT')).toBeUndefined()
  })

  it('hợp đồng active: participant và staff chỉ còn VERIFY_LEDGER', () => {
    const activeFacts = facts({
      contractStatus: 'active',
      agreement: paid,
      deposit: { required: true, confirmed: true, paidAt: null },
      contentLockedAt: at('2026-09-19T01:00:00Z'),
      signatures: bothSigned,
      ledger: { status: 'pending', recordedAt: null },
    })

    for (const viewer of [activeFacts.viewer, asLandlord, asStaff]) {
      const flow = projectContractFlow({ ...activeFacts, viewer })
      expect(flow.nextActions.map(item => item.action)).toEqual([
        'VERIFY_LEDGER',
      ])
      expect(flow.nextActions[0]).toMatchObject({
        enabled: true,
        stage: 'ledger',
      })
    }
  })

  it('hợp đồng đã hủy: không có hành động nào', () => {
    expect(
      projectContractFlow(facts({ contractStatus: 'cancelled' })).nextActions
    ).toEqual([])
  })

  it('người ngoài hợp đồng không có hành động', () => {
    expect(
      projectContractFlow(
        facts({
          viewer: { isTenant: false, isLandlord: false, isStaff: false },
        })
      ).nextActions
    ).toEqual([])
  })
})
