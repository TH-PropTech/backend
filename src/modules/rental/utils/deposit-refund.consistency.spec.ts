import { PLATFORM_FAQ_ENTRIES } from '../../legal/utils/platform-faq.seed-data'
import { buildSeedPlatformRegulations } from '../../legal/utils/legal-sources.seed-data'
import { buildReviewedLeaseTemplateSeed } from '../../contracts/legal/lease-template.seed'
import { DEFAULT_FLOW_PROFILE_STEPS } from './default-flow-profile'
import { DEPOSIT_REFUND_DUE_TEXT } from './deposit-refund.constants'

/** Mọi nơi nói về hạn hoàn cọc phải khớp mẫu hợp đồng: 07 ngày theo lịch. */
describe('deposit refund wording stays consistent with the contract template', () => {
  it('flow profile notice uses the shared due text and no working days', () => {
    const body = DEFAULT_FLOW_PROFILE_STEPS.step2.depositNoticeBody
    expect(body).toContain(DEPOSIT_REFUND_DUE_TEXT)
    expect(body).not.toContain('ngày làm việc')
    expect(body).not.toContain('15 ngày')
  })

  it('platform regulation REG-DEPOSIT-06 drops the escrow model and 03 working days', () => {
    const rule = buildSeedPlatformRegulations().find(
      reg => reg.code === 'REG-DEPOSIT-06'
    )
    expect(rule).toBeDefined()
    const text = JSON.stringify(rule)
    expect(text).toContain(DEPOSIT_REFUND_DUE_TEXT)
    expect(text).not.toContain('ngày làm việc')
    expect(text).not.toContain('03 ngày')
    expect(text).not.toMatch(/hợp đồng thông minh|bảo chứng|ký quỹ/i)
  })

  it('FAQ describes the new flow and no longer says refunds are not automated', () => {
    const faq = PLATFORM_FAQ_ENTRIES.map(entry => entry.content).join('\n')
    expect(faq).toContain(DEPOSIT_REFUND_DUE_TEXT)
    expect(faq).toContain('biên bản trả nhà')
    expect(faq).toContain('bảng khấu trừ cọc')
    expect(faq).not.toContain('chưa tự động hoàn cọc')
    expect(faq).not.toContain('07 ngày làm việc')
  })

  it('contract template and FAQ quote the same due text', () => {
    const article5 = buildReviewedLeaseTemplateSeed(
      'PRIVATE_CIVIL_APARTMENT_LEASE'
    ).clauses[4]!.content
    expect(article5).toContain(DEPOSIT_REFUND_DUE_TEXT)
  })
})
