export interface PropertyCardMetadata {
  id: string
  title: string
  price: number
  image: string
  location: string
  landlordName?: string
  landlordPhone?: string
}

export interface BookingRequestMetadata {
  apartmentId: string
  apartmentTitle: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: Date
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  metadata?: {
    propertyCard?: PropertyCardMetadata
    propertyCards?: PropertyCardMetadata[]
    bookingRequest?: BookingRequestMetadata
  }
}

export class AiChat {
  userId?: string
  deviceId?: string
  messages!: ChatMessage[]
  createdAt!: Date
  updatedAt!: Date
}
