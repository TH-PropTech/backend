import { UnprocessableEntityException } from '@nestjs/common'
import type { FlowProfileSteps } from './schemas/rental-flow-profile.schema'

const SCRIPT_REGEX =
  /<script\b[^>]*>([\s\S]*?)<\/script>|javascript:|onerror\s*=|onload\s*=/i

const FORBIDDEN_COMMERCIAL_KEYS = [
  'monthlyRent',
  'deposit',
  'resolvedDepositAmount',
  'durationMonths',
  'pricingRevision',
  'packageVersion',
]

function checkUnsafeString(str: string, path: string): void {
  if (SCRIPT_REGEX.test(str)) {
    throw new UnprocessableEntityException(
      `Phát hiện ký tự hoặc thẻ script không an toàn tại ${path}`
    )
  }
}

function checkNestedUnsafeStrings(obj: unknown, prefix = ''): void {
  if (!obj || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      checkUnsafeString(obj, prefix)
    }
    return
  }

  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_COMMERCIAL_KEYS.includes(key)) {
      if (key === 'durationMonths' && prefix.includes('badgeRules')) {
        // Permitted: badge duration mapping
      } else {
        throw new UnprocessableEntityException(
          `Không được phép cấu hình trường thương mại [${key}] trong flow profile tại ${prefix ? `${prefix}.${key}` : key}`
        )
      }
    }
    const currentPath = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      checkUnsafeString(value, currentPath)
    } else if (typeof value === 'object' && value !== null) {
      checkNestedUnsafeStrings(value, currentPath)
    }
  }
}

export function validateFlowProfileSteps(steps: FlowProfileSteps): void {
  if (!steps || !steps.step1 || !steps.step2 || !steps.step3 || !steps.step4) {
    throw new UnprocessableEntityException(
      'Flow profile phải chứa đầy đủ cấu hình cho cả 4 bước (step1, step2, step3, step4).'
    )
  }

  // 1. Kiểm tra không chứa script độc hại và không chứa trường thương mại
  checkNestedUnsafeStrings(steps)

  // 2. Validate Step 1
  const s1 = steps.step1
  if (!s1.moveInDateLabel?.trim()) {
    throw new UnprocessableEntityException(
      'step1.moveInDateLabel không được để trống.'
    )
  }
  if (s1.minMoveInLeadDays < 0 || s1.minMoveInLeadDays > 90) {
    throw new UnprocessableEntityException(
      'step1.minMoveInLeadDays phải nằm trong khoảng từ 0 đến 90 ngày.'
    )
  }
  if (s1.maxMoveInLeadDays < 1 || s1.maxMoveInLeadDays > 365) {
    throw new UnprocessableEntityException(
      'step1.maxMoveInLeadDays phải nằm trong khoảng từ 1 đến 365 ngày.'
    )
  }
  if (s1.minOccupants < 1 || s1.minOccupants > 10) {
    throw new UnprocessableEntityException(
      'step1.minOccupants phải nằm trong khoảng từ 1 đến 10 người.'
    )
  }
  if (s1.maxOccupants < s1.minOccupants || s1.maxOccupants > 20) {
    throw new UnprocessableEntityException(
      'step1.maxOccupants phải lớn hơn minOccupants và tối đa 20 người.'
    )
  }
  if (s1.notesMaxLength < 100 || s1.notesMaxLength > 1000) {
    throw new UnprocessableEntityException(
      'step1.notesMaxLength phải nằm trong khoảng từ 100 đến 1000 ký tự.'
    )
  }

  // 3. Validate Step 2
  const s2 = steps.step2
  if (!s2.headerTitle?.trim()) {
    throw new UnprocessableEntityException(
      'step2.headerTitle không được để trống.'
    )
  }
  if (!s2.depositNoticeBody?.trim()) {
    throw new UnprocessableEntityException(
      'step2.depositNoticeBody không được để trống.'
    )
  }

  // 4. Validate Step 3
  const s3 = steps.step3
  if (!s3.consentCheckboxLabel?.trim()) {
    throw new UnprocessableEntityException(
      'step3.consentCheckboxLabel không được để trống.'
    )
  }
  if (!s3.consentStatement?.trim()) {
    throw new UnprocessableEntityException(
      'step3.consentStatement không được để trống.'
    )
  }
  if (!Array.isArray(s3.disclosures) || s3.disclosures.length === 0) {
    throw new UnprocessableEntityException(
      'step3.disclosures phải có ít nhất 1 điều khoản.'
    )
  }
  // Kiểm tra cờ immutablePolicy
  for (const disc of s3.disclosures) {
    if (disc.immutablePolicy && !disc.required) {
      throw new UnprocessableEntityException(
        `Điều khoản pháp lý bắt buộc [${disc.id}] không thể bị tắt yêu cầu xác nhận (required = false).`
      )
    }
  }

  // 5. Validate Step 4
  const s4 = steps.step4
  if (!s4.heroSuccessTitle?.trim()) {
    throw new UnprocessableEntityException(
      'step4.heroSuccessTitle không được để trống.'
    )
  }
  if (!Array.isArray(s4.timelineSteps) || s4.timelineSteps.length < 2) {
    throw new UnprocessableEntityException(
      'step4.timelineSteps phải có ít nhất 2 giai đoạn.'
    )
  }
}
