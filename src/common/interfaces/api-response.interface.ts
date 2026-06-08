export type ApiErrorBody = {
  code: string
  message: string
  details?: unknown
}

export type ApiMeta = {
  requestId?: string
  timestamp: string
}

export type ApiResponse<TData> = {
  success: boolean
  data: TData | null
  error: ApiErrorBody | null
  meta: ApiMeta
}
