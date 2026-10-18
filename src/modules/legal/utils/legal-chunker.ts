import type { LegalChunkDraft } from './legal-knowledge.types'
import { unwrapHardLines } from './legal-text'

const DEFAULT_MAX_CHARS = 1200
const DEFAULT_OVERLAP = 150
const MIN_MAX_CHARS = 50
const MAX_HEADING_CHARS = 200

/**
 * "Chương I", "Mục 2.", "Điều 472." or a Markdown heading. A line that merely starts with a
 * cross-reference ("Điều 19 của Luật này;") is NOT a heading.
 */
const HEADING_RE =
  /^(?:[Cc]hương\s+[IVXLC\d]+\s*(?:[.:–-]|$)|[Mm]ục\s+\d+\s*(?:[.:–-]|$)|[Đđ]iều\s+\d+[a-zđ]?(?:\s*[.:]|\s*$|\s+\p{Lu})|#{1,6}\s+\S)/u
const CHAPTER_RE = /^Chương\s+[IVXLC\d]+/i

const PARAGRAPH_SEP = '\n\n'
const SENTENCE_SEP = ' '

interface RawSection {
  heading: string | undefined
  chapterPrefix: string | undefined
  lines: string[]
}

export interface ChunkLegalTextOptions {
  maxChars?: number
  overlap?: number
}

/**
 * Splits legal text into retrieval chunks. Sections start at Chương/Mục/Điều
 * headings (or Markdown headings); the last Chương line is carried as a prefix
 * so every article keeps its context. Long sections are packed on paragraph
 * and sentence boundaries with an overlap. Deterministic and never emits empty
 * chunks.
 */
export function chunkLegalText(
  text: string,
  opts: ChunkLegalTextOptions = {}
): LegalChunkDraft[] {
  const maxChars = Math.max(
    MIN_MAX_CHARS,
    Math.floor(opts.maxChars ?? DEFAULT_MAX_CHARS)
  )
  const overlap = Math.min(
    Math.max(0, Math.floor(opts.overlap ?? DEFAULT_OVERLAP)),
    Math.floor(maxChars / 4)
  )

  const sections = splitSections(text)
  const drafts: LegalChunkDraft[] = []

  for (const section of sections) {
    const body = [
      ...(section.chapterPrefix ? [section.chapterPrefix] : []),
      ...section.lines,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (!body) continue

    for (const piece of splitSection(body, maxChars, overlap)) {
      drafts.push({
        order: drafts.length,
        text: piece,
        ...(section.heading ? { heading: section.heading } : {}),
      })
    }
  }

  return drafts
}

function splitSections(text: string): RawSection[] {
  const lines = unwrapHardLines(text.replace(/\r\n?/g, '\n')).split('\n')
  const sections: RawSection[] = []
  let chapter: string | undefined
  let current: RawSection = {
    heading: undefined,
    chapterPrefix: undefined,
    lines: [],
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (HEADING_RE.test(line)) {
      sections.push(current)
      const heading = line.slice(0, MAX_HEADING_CHARS)
      const isChapter = CHAPTER_RE.test(line)
      if (isChapter) chapter = heading
      current = {
        heading,
        chapterPrefix: isChapter ? undefined : chapter,
        lines: [line],
      }
    } else {
      current.lines.push(raw.trimEnd())
    }
  }
  sections.push(current)
  return sections
}

interface Unit {
  text: string
  /** Separator placed before this unit when it is appended to a chunk. */
  sep: string
}

function splitSection(
  text: string,
  maxChars: number,
  overlap: number
): string[] {
  if (text.length <= maxChars) return [text]
  return packUnits(toUnits(text, maxChars), maxChars, overlap)
}

/**
 * Turns text into units no longer than maxChars. Lines are kept as units (a
 * blank line before a line gives a paragraph separator); over-long lines are
 * split on sentence boundaries, and giant sentences are hard-sliced.
 */
function toUnits(text: string, maxChars: number): Unit[] {
  const units: Unit[] = []
  let afterBlank = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      afterBlank = true
      continue
    }
    const lineSep = units.length === 0 ? '' : afterBlank ? PARAGRAPH_SEP : '\n'
    afterBlank = false

    if (line.length <= maxChars) {
      units.push({ text: line, sep: lineSep })
      continue
    }

    const sentences = line
      .split(/(?<=[.!?;:])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
    sentences.forEach((sentence, i) => {
      const sep = i === 0 ? lineSep : SENTENCE_SEP
      for (let start = 0; start < sentence.length; start += maxChars) {
        const piece = sentence.slice(start, start + maxChars)
        units.push({ text: piece, sep: start === 0 ? sep : '' })
      }
    })
  }

  return units
}

/**
 * Greedily packs units into chunks of at most maxChars. When a chunk is closed,
 * the last ~overlap chars (cut at a word boundary, and never more than the room
 * left for the next unit) are carried into the next chunk.
 */
function packUnits(units: Unit[], maxChars: number, overlap: number): string[] {
  const out: string[] = []
  let current = ''

  for (const unit of units) {
    if (!current) {
      current = unit.text
      continue
    }
    const candidate = `${current}${unit.sep}${unit.text}`
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }

    out.push(current)
    const room = maxChars - unit.sep.length - unit.text.length
    const tail = overlapTail(current, Math.min(overlap, room))
    current = tail ? `${tail}${unit.sep}${unit.text}` : unit.text
  }

  if (current.trim()) out.push(current)
  return out
}

function overlapTail(text: string, length: number): string {
  if (length <= 0 || text.length <= length) return ''
  let tail = text.slice(-length)
  const boundary = tail.search(/\s/)
  if (boundary >= 0) tail = tail.slice(boundary + 1)
  return tail.trim()
}
