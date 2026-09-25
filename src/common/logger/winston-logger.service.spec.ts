import { WinstonLoggerService } from './winston-logger.service'

describe('WinstonLoggerService', () => {
  let loggerService: WinstonLoggerService

  beforeEach(() => {
    // Set env for test
    process.env.LOG_FORMAT = 'json'
    process.env.LOG_LEVEL = 'debug'
    process.env.LOG_DIR = '.test-logs'
    loggerService = new WinstonLoggerService()
  })

  it('should be defined', () => {
    expect(loggerService).toBeDefined()
  })

  it('should log info messages without throwing', () => {
    expect(() =>
      loggerService.log('Test info message', 'TestContext')
    ).not.toThrow()
  })

  it('should log error with stack trace without throwing', () => {
    expect(() =>
      loggerService.error(
        'Test error message',
        'Error stack trace here',
        'TestContext'
      )
    ).not.toThrow()
  })

  it('should handle object messages (destructure { message, ...meta })', () => {
    expect(() =>
      loggerService.log(
        { message: 'Structured log', userId: 'user-123', action: 'LOGIN' },
        'AuthContext'
      )
    ).not.toThrow()
  })

  it('should log warn messages without throwing', () => {
    expect(() =>
      loggerService.warn('Test warning', 'WarnContext')
    ).not.toThrow()
  })

  it('should log debug messages without throwing', () => {
    expect(() =>
      loggerService.debug('Test debug', 'DebugContext')
    ).not.toThrow()
  })

  it('should log verbose messages without throwing', () => {
    expect(() =>
      loggerService.verbose('Test verbose', 'VerboseContext')
    ).not.toThrow()
  })

  it('should handle error with object message', () => {
    expect(() =>
      loggerService.error(
        { message: 'DB Error', query: 'SELECT *', duration: 500 },
        'Error stack',
        'DBContext'
      )
    ).not.toThrow()
  })
})
