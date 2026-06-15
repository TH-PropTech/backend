import { ExecutionContext } from '@nestjs/common';

export function createMockReflector() {
  return {
    getAllAndOverride: jest.fn(),
  };
}

export function createMockExecutionContext(options: { user?: any } = {}) {
  const request = {
    user: options.user,
    headers: {},
  };
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
  };
}

export function createMockUserPayload(data: Partial<any> = {}) {
  return {
    id: 'mock-user-id',
    email: 'mock@example.com',
    roles: [],
    ...data,
  };
}
