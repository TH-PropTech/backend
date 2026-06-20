import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name)

  async textToSpeech(text: string): Promise<string> {
    try {
      const chunks = this.splitText(text)
      const buffers: Buffer[] = []
      for (const chunk of chunks) {
        const buf = await this.getTtsChunk(chunk)
        buffers.push(buf)
      }
      return Buffer.concat(buffers).toString('base64')
    } catch (error) {
      this.logger.error('Failed to convert text to speech:', error)
      return ''
    }
  }

  private splitText(text: string, maxLength = 200): string[] {
    const words = text.split(/\s+/)
    const chunks: string[] = []
    let current = ''

    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxLength) {
        if (current) chunks.push(current.trim())
        current = word
      } else {
        current += ' ' + word
      }
    }
    if (current.trim()) {
      chunks.push(current.trim())
    }
    return chunks
  }

  private async getTtsChunk(text: string): Promise<Buffer> {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(text)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
      },
    })
    if (!response.ok) {
      throw new Error(`Google TTS request failed: ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
