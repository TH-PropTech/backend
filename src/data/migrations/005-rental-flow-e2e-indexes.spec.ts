import {
  ensureRentalFlowE2EIndexes,
  type RentalFlowMongoDatabase,
} from './005-rental-flow-e2e-indexes'

describe('rental flow e2e indexes migration', () => {
  it('is idempotent because each index has a stable name', async (): Promise<void> => {
    const calls: Array<{ collection: string; name?: string }> = []
    const database: RentalFlowMongoDatabase = {
      collection: (collection: string) => ({
        createIndex: jest.fn(
          (
            _keys: Record<string, 1 | -1>,
            options?: { name?: string; unique?: boolean; sparse?: boolean }
          ): Promise<string> => {
            calls.push({
              collection,
              ...(options?.name ? { name: options.name } : {}),
            })
            return Promise.resolve(options?.name ?? `${collection}-index`)
          }
        ),
      }),
    }

    const first = await ensureRentalFlowE2EIndexes(database)
    const second = await ensureRentalFlowE2EIndexes(database)

    expect(first).toBeGreaterThan(10)
    expect(second).toBe(first)
    expect(calls).toHaveLength(first * 2)
    expect(new Set(calls.map(call => call.name)).size).toBe(first)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'rental_transaction_events',
          name: 'rental_transaction_events_transition_unique',
        }),
        expect.objectContaining({
          collection: 'move_in_settlements',
          name: 'move_in_settlements_contract_unique',
        }),
        expect.objectContaining({
          collection: 'move_out_handovers',
          name: 'move_out_handovers_contract_unique',
        }),
        expect.objectContaining({
          collection: 'deposit_settlement_statements',
          name: 'deposit_settlement_statements_contract_unique',
        }),
      ])
    )
  })
})
