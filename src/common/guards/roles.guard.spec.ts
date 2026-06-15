import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { createMockExecutionContext, createMockReflector, createMockUserPayload } from '../../test-utils/mock-factory';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: ReturnType<typeof createMockReflector>;

  beforeEach(() => {
    reflector = createMockReflector();
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('should allow access when no @Roles() defined', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockExecutionContext();

    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('should allow access when @Roles() is empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = createMockExecutionContext();

    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('should allow access when user has required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const context = createMockExecutionContext({
      user: createMockUserPayload({ roles: ['admin', 'borrower'] }),
    });

    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('should be case-insensitive for role matching', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const context = createMockExecutionContext({
      user: createMockUserPayload({ roles: ['admin'] }),
    });

    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('should throw ForbiddenException when no user', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const context = createMockExecutionContext({ user: undefined });
    // Override request.user to be undefined
    context.switchToHttp().getRequest.mockReturnValue({ user: undefined });

    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user lacks required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const context = createMockExecutionContext({
      user: createMockUserPayload({ roles: ['borrower'] }),
    });

    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context as any)).toThrow('Chức năng này chỉ dành cho');
  });
});