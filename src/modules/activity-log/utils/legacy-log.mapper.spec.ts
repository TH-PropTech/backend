import { ObjectId } from 'mongodb'
import type { ActivityLog } from '../schemas/activity-log.schema'
import {
  LEGACY_LOG_FIELDS,
  toAiConsultationLog,
  toBlockchainLog,
  toConfigAudit,
  toHttpActivityLog,
  toJobRunHistory,
  toRecommendationHistory,
} from './legacy-log.mapper'

const id = new ObjectId()
const base = {
  _id: id,
  kind: 'blockchain',
  createdAt: new Date(10),
  updatedAt: new Date(11),
} as unknown as ActivityLog

describe('legacy log mappers', () => {
  it('keeps the blockchain JSON shape and drops kind and foreign columns', () => {
    const row = {
      ...base,
      action: 'recordDeposit',
      txHash: 'sim_1',
      contractId: 'c-1',
      details: { a: 1 },
      jobName: 'should-not-leak',
      userId: 'nope',
    } as ActivityLog

    expect(toBlockchainLog(row)).toEqual({
      _id: id,
      action: 'recordDeposit',
      txHash: 'sim_1',
      contractId: 'c-1',
      details: { a: 1 },
      createdAt: new Date(10),
    })
  })

  it('keeps job-run fields including stored nulls', () => {
    const row = {
      ...base,
      kind: 'job-run',
      jobName: 'rental-ops',
      trigger: 'cron',
      status: 'running',
      startedAt: new Date(5),
      finishedAt: null,
      durationMs: null,
      result: null,
      error: null,
    } as unknown as ActivityLog

    expect(toJobRunHistory(row)).toEqual({
      _id: id,
      jobName: 'rental-ops',
      trigger: 'cron',
      status: 'running',
      startedAt: new Date(5),
      finishedAt: null,
      durationMs: null,
      result: null,
      error: null,
      createdAt: new Date(10),
      updatedAt: new Date(11),
    })
  })

  it('keeps recommendation training fields only', () => {
    const row = {
      _id: id,
      kind: 'recommendation',
      userAge: 30,
      userIncome: 20,
      preferredDistrict: 'Q7',
      preferredBedrooms: 2,
      requiresGym: 1,
      requiresParking: 0,
      rentedApartmentId: 'a-1',
      satisfactionScore: 5,
      createdAt: new Date(10),
      updatedAt: new Date(11),
    } as unknown as ActivityLog

    expect(toRecommendationHistory(row)).toEqual({
      _id: id,
      userAge: 30,
      userIncome: 20,
      preferredDistrict: 'Q7',
      preferredBedrooms: 2,
      requiresGym: 1,
      requiresParking: 0,
      rentedApartmentId: 'a-1',
      satisfactionScore: 5,
      createdAt: new Date(10),
    })
  })

  it('keeps ai-consultation fields and a null userId', () => {
    const row = {
      ...base,
      kind: 'ai-consultation',
      logId: 'call-1',
      userId: null,
      messages: [],
      status: 'pending',
      result: 'not_interested',
      duration: 0,
    } as unknown as ActivityLog

    expect(toAiConsultationLog(row)).toEqual({
      _id: id,
      logId: 'call-1',
      userId: null,
      messages: [],
      status: 'pending',
      result: 'not_interested',
      duration: 0,
      createdAt: new Date(10),
      updatedAt: new Date(11),
    })
  })

  it('keeps the HTTP activity log shape without kind', () => {
    const row = {
      ...base,
      kind: 'http',
      userId: 'u1',
      userRole: 'admin',
      method: 'POST',
      path: '/x',
      action: 'a',
      statusCode: 201,
      duration: 5,
      logId: 'not-http',
    } as unknown as ActivityLog

    expect(toHttpActivityLog(row)).toEqual({
      _id: id,
      userId: 'u1',
      userRole: 'admin',
      method: 'POST',
      path: '/x',
      action: 'a',
      statusCode: 201,
      duration: 5,
      createdAt: new Date(10),
      updatedAt: new Date(11),
    })
  })

  it('keeps the config-audit shape (no kind, no updatedAt) and drops foreign columns', () => {
    const row = {
      _id: id,
      kind: 'config-audit',
      scope: 'rental-flow',
      key: 'profile-1',
      version: 3,
      action: 'PROFILE_PUBLISHED',
      actorId: 'admin-1',
      reason: null,
      beforeHash: null,
      afterHash: 'h1',
      targetType: 'profile',
      details: { a: 1 },
      createdAt: new Date(10),
      updatedAt: new Date(11),
      userId: 'should-not-leak',
      jobName: 'should-not-leak',
    } as unknown as ActivityLog

    expect(toConfigAudit(row)).toEqual({
      _id: id,
      scope: 'rental-flow',
      key: 'profile-1',
      version: 3,
      action: 'PROFILE_PUBLISHED',
      actorId: 'admin-1',
      reason: null,
      beforeHash: null,
      afterHash: 'h1',
      targetType: 'profile',
      details: { a: 1 },
      createdAt: new Date(10),
    })
  })

  it('defines a legacy field list for every kind', () => {
    expect(Object.keys(LEGACY_LOG_FIELDS).sort()).toEqual(
      [
        'ai-consultation',
        'blockchain',
        'config-audit',
        'http',
        'job-run',
        'recommendation',
      ].sort()
    )
  })
})
