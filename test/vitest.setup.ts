import { vi } from 'vitest'

// Lớp tương thích: spec cũ viết theo API `jest.*`; vitest cung cấp cùng API qua `vi`.
const compat: unknown = Object.assign(Object.create(vi) as object, {
  setTimeout: (ms: number): void => {
    vi.setConfig({ testTimeout: ms })
  },
})
;(globalThis as { jest?: unknown }).jest = compat
