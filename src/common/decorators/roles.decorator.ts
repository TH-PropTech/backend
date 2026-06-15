import { SetMetadata } from '@nestjs/common';

/**
 * @Roles('lender', 'admin') — decorator chỉ định roles được phép truy cập.
 * Dùng kèm RolesGuard.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);