import { Injectable } from '@nestjs/common'

@Injectable()
export class VadService {
  private readonly rmsThreshold = 200
  private readonly silenceTimeoutMs = 1200

  private readonly lastAudioTimes = new Map<string, number>()
  private readonly hasSpokenFlags = new Map<string, boolean>()

  processChunk(logId: string, pcmBuffer: Buffer): void {
    const rms = this.calculateRms(pcmBuffer)
    if (rms > this.rmsThreshold) {
      this.lastAudioTimes.set(logId, Date.now())
      this.hasSpokenFlags.set(logId, true)
    }
  }

  isSilent(logId: string): boolean {
    if (!this.hasSpokenFlags.get(logId)) {
      return false
    }
    const lastAudioTime = this.lastAudioTimes.get(logId) || 0
    return Date.now() - lastAudioTime > this.silenceTimeoutMs
  }

  reset(logId: string): void {
    this.hasSpokenFlags.set(logId, false)
    this.lastAudioTimes.delete(logId)
  }

  clear(logId: string): void {
    this.hasSpokenFlags.delete(logId)
    this.lastAudioTimes.delete(logId)
  }

  private calculateRms(buffer: Buffer): number {
    let sum = 0
    const count = Math.floor(buffer.length / 2)
    if (count === 0) {
      return 0
    }

    for (let i = 0; i < buffer.length; i += 2) {
      if (i + 1 < buffer.length) {
        const sample = buffer.readInt16LE(i)
        sum += sample * sample
      }
    }
    return Math.sqrt(sum / count)
  }
}
