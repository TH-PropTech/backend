import { SetMetadata, CustomDecorator } from '@nestjs/common'

export const SKIP_KYC_CHECK_KEY = 'skipKycCheck'
export const SkipKycCheck = (): CustomDecorator<string> =>
  SetMetadata(SKIP_KYC_CHECK_KEY, true)
