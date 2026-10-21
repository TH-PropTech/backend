import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class SttService {
  private readonly logger = new Logger(SttService.name)
  private readonly buffers = new Map<string, Buffer[]>()

  appendAudio(logId: string, pcmBuffer: Buffer): void {
    if (!this.buffers.has(logId)) {
      this.buffers.set(logId, [])
    }
    this.buffers.get(logId)?.push(pcmBuffer)
  }

  clearAudio(logId: string): void {
    this.buffers.delete(logId)
  }

  async transcribe(logId: string): Promise<string> {
    const chunks = this.buffers.get(logId) || []
    if (chunks.length === 0) {
      return ''
    }

    const pcmData = Buffer.concat(chunks)
    this.clearAudio(logId)

    const wavHeader = this.createWavHeader(pcmData.length)
    const wavFile = Buffer.concat([wavHeader, pcmData])

    return this.callGoogleSpeechApi(wavFile)
  }

  private createWavHeader(
    length: number,
    sampleRate = 8000,
    channels = 1,
    bitsPerSample = 16
  ): Buffer {
    const buffer = Buffer.alloc(44)
    buffer.write('RIFF', 0)
    buffer.writeUInt32LE(36 + length, 4)
    buffer.write('WAVE', 8)
    buffer.write('fmt ', 12)
    buffer.writeUInt32LE(16, 16)
    buffer.writeUInt16LE(1, 20)
    buffer.writeUInt16LE(channels, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
    buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32)
    buffer.writeUInt16LE(bitsPerSample, 34)
    buffer.write('data', 36)
    buffer.writeUInt32LE(length, 40)
    return buffer
  }

  private async callGoogleSpeechApi(wavFile: Buffer): Promise<string> {
    try {
      const apiKey = process.env.GOOGLE_SPEECH_API_KEY
      if (!apiKey) {
        this.logger.warn(
          'GOOGLE_SPEECH_API_KEY is not set: speech-to-text is disabled.'
        )
        return ''
      }
      const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=vi-VN&key=${encodeURIComponent(apiKey)}&pFilter=0`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/l16; rate=8000',
        },
        body: new Uint8Array(wavFile),
      })

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        this.logger.error(
          `Google Speech API error: ${response.status} ${response.statusText} - Body: ${bodyText}`
        )
        return ''
      }

      const text = await response.text()
      return this.parseSpeechResponse(text)
    } catch (error) {
      this.logger.error('Failed to transcribe audio via Google Speech:', error)
      return ''
    }
  }

  private parseSpeechResponse(rawResponse: string): string {
    const lines = rawResponse.split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          result?: Array<{
            alternative?: Array<{ transcript?: string }>
          }>
        }
        const alternative = parsed.result?.[0]?.alternative?.[0]
        if (alternative?.transcript) {
          return alternative.transcript
        }
      } catch {
        // Bỏ qua dòng không parse được JSON
      }
    }
    return ''
  }
}
