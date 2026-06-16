import { UserPayload } from '../modules/auth/interfaces/auth.interface'

export interface MockReflector {
  getAllAndOverride: jest.Mock
}

export function createMockReflector(): MockReflector {
  return {
    getAllAndOverride: jest.fn(),
  }
}

export interface MockExecutionContext {
  getHandler: jest.Mock
  getClass: jest.Mock
  switchToHttp: jest.Mock
}

export function createMockExecutionContext(
  options: { user?: UserPayload | undefined } = {}
): MockExecutionContext {
  const request = {
    user: options.user,
    headers: {},
  }
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
  }
}

export function createMockUserPayload(
  data: Partial<UserPayload> = {}
): UserPayload {
  return {
    _id: 'mock-user-id',
    email: 'mock@example.com',
    roles: [],
    ...data,
  }
}
