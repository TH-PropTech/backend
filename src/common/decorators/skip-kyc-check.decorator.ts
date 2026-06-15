import { SetMetadata } from '@nestjs/common';

export const SKIP_KYC_CHECK_KEY = 'skipKycCheck';
export const SkipKycCheck = () => SetMetadata(SKIP_KYC_CHECK_KEY, true);