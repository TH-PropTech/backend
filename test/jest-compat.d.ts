import type * as V from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any */
// Kiểu tương thích cho spec cũ viết theo `@types/jest` (đã gỡ): `jest.fn<Return, Args>`,
// `jest.Mock<Return, Args>`, `jest.Mocked<T>`... Runtime là `vi` (xem test/vitest.setup.ts).
declare global {
  const jest: Omit<typeof V.vi, 'fn'> & {
    fn(): V.Mock<(...args: any[]) => any>
    fn<T, Y extends any[] = any[]>(
      implementation?: (...args: Y) => T
    ): V.Mock<(...args: Y) => T>
    setTimeout(ms: number): void
  }
  namespace jest {
    type Mock<T = any, Y extends any[] = any[]> = V.Mock<(...args: Y) => T>
    type MockedFunction<T extends (...args: any[]) => any> = V.MockedFunction<T>
    type Mocked<T> = V.Mocked<T>
    type SpyInstance<T = any, Y extends any[] = any[]> = V.MockInstance<
      (...args: Y) => T
    >
  }
}
