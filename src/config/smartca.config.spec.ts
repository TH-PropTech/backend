import smartCaConfig from './smartca.config'

describe('smartCA configuration', () => {
  it('does not expose a network polling interval', () => {
    const config = smartCaConfig()

    expect(config).not.toHaveProperty('pollingIntervalMs')
  })
})
