import type { SmartCaSigningSession } from '../schemas/smartca-signing-session.schema'

export const SMARTCA_EVENTS_PUBLISHER = Symbol('SMARTCA_EVENTS_PUBLISHER')

export type SmartCaSessionUpdatedEvent = Readonly<{
  contractId: string
  sessionId: string
  status: Extract<
    SmartCaSigningSession['status'],
    'signed' | 'rejected' | 'expired' | 'cancelled'
  >
}>

export interface SmartCaEventsPublisher {
  publish(event: SmartCaSessionUpdatedEvent): Promise<void>
}
