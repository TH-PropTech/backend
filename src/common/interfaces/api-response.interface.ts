export type ApiErrorBody = {
  code: string
  message: string
  details?: unknown
}

export type ApiMeta = {
  requestId?: string
  timestamp: string
  page?: number
  limit?: number
  total?: number
  totalPages?: number
}

export type ApiResponse<TData = any> = {
  success: boolean
  data: TData | null
  error: ApiErrorBody | null
  meta: ApiMeta
}

export type PaginatedResponse<TData> = ApiResponse<TData[]>