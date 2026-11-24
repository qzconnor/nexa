import { describe, expect, it } from 'vitest'
import { codePageDecoder, decodeText, decodeUtf16, isUtf16 } from './text-encoding'

const latin1 = (text: string) => Buffer.from(text, 'latin1')

describe('decodeText', () => {
  it('reads UTF-8 as it is', () => {
    expect(decodeText(Buffer.from('Grüße\n€ und „Zitat“\n'))).toBe('Grüße\n€ und „Zitat“\n')
  })

  it('reads a file saved as Windows-1252 without replacement characters', () => {
    // Grüße, € and „ in Windows-1252.
    const bytes = Buffer.concat([latin1('Gr\xfc\xdfe\r\n'), Buffer.from([0x80, 0x20, 0x84, 0x0a])])
    expect(decodeText(bytes)).toBe('Grüße\r\n€ „\n')
  })

  it('reads each line by itself: a diff of a Latin-1 file has UTF-8 around it', () => {
    const patch = Buffer.concat([Buffer.from('@@ -1 +1 @@ Überschrift\n'), latin1('-Gr\xfc\xdfe\n'), Buffer.from('+Grüße\n')])
    expect(decodeText(patch)).toBe('@@ -1 +1 @@ Überschrift\n-Grüße\n+Grüße\n')
  })

  it("reads a console program's lines in the DOS code page it is given, UTF-8 ones as they are", () => {
    // ping on a German Windows without a console: „ausgeführt“ with ü as 0x81 (code page 850).
    const output = Buffer.concat([latin1('Ping wird ausgef\x81hrt f\x81r 127.0.0.1\r\n'), Buffer.from('Grüße von git\n')])
    expect(decodeText(output, codePageDecoder(850))).toBe('Ping wird ausgeführt für 127.0.0.1\r\nGrüße von git\n')
  })
})

describe('codePageDecoder', () => {
  it('knows the DOS code pages of the console and the others of Windows', () => {
    expect(codePageDecoder(437).decode(latin1('\x9a\xe1 \xc9\xcd\xbb'))).toBe('Üß ╔═╗')
    expect(codePageDecoder(850).decode(latin1('\x8e\x99\x9a \xd5'))).toBe('ÄÖÜ ı')
    expect(codePageDecoder(858).decode(latin1('\xd5'))).toBe('€')
    expect(codePageDecoder(852).decode(latin1('\x88\xa5'))).toBe('łą')
    expect(codePageDecoder(866).decode(latin1('\x8f\xe0\xa8\xa2\xa5\xe2'))).toBe('Привет')
    expect(codePageDecoder(1250).decode(latin1('\x9a'))).toBe('š')
    expect(codePageDecoder(99999).decode(latin1('\x80'))).toBe('€')
  })
})

describe('UTF-16', () => {
  it('is known by its byte order mark, in both byte orders', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Grüße\r\n', 'utf16le')])
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Grüße\r\n', 'utf16le').swap16()])
    expect([isUtf16(le), isUtf16(be), isUtf16(Buffer.from('Grüße'))]).toEqual([true, true, false])
    expect(decodeUtf16(le)).toBe('Grüße\r\n')
    expect(decodeUtf16(be)).toBe('Grüße\r\n')
  })
})
