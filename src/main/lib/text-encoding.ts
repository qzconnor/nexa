const UTF8 = new TextDecoder('utf-8', { fatal: true })
/** Windows-1252 (`latin1` names it too): Latin-1 with `€`, `„` and `“` where Latin-1 has control characters. */
const WINDOWS_1252 = new TextDecoder('windows-1252')
const UTF16LE = new TextDecoder('utf-16le')

/** Text written as UTF-16 with its byte order mark, as `>` and `Out-File` write it in Windows PowerShell 5.1. */
export function isUtf16(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
}

/** UTF-16 text (see `isUtf16`) without its byte order mark. */
export function decodeUtf16(bytes: Uint8Array): string {
  if (bytes[0] === 0xff) return UTF16LE.decode(bytes)
  // Big-endian: the bytes of each pair swapped, then as little-endian.
  const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)))
  return UTF16LE.decode(swapped.swap16())
}

/** Reads bytes in one code page. */
export interface ByteDecoder {
  decode(bytes: Uint8Array): string
}

/** The upper halves (0x80–0xFF) of the DOS code pages Windows' console programs write in. */
const OEM_TABLES: Record<number, string> = {
  437:
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ',
  850:
    'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ',
  852:
    'ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■ ',
}
// 858 is 850 with the euro sign where 850 has the dotless i.
OEM_TABLES[858] = OEM_TABLES[850]!.slice(0, 0x55) + '€' + OEM_TABLES[850]!.slice(0x56)

/**
 * A decoder for a Windows code page: the DOS ones of the console (437, 850, 852, 858, 866), else
 * what the encoding standard knows (`windows-1250` …); Windows-1252 for any other.
 */
export function codePageDecoder(codePage: number): ByteDecoder {
  const table = OEM_TABLES[codePage]
  if (table) {
    return {
      decode: (bytes) => {
        let text = ''
        for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : table[byte - 0x80]
        return text
      },
    }
  }
  const label = codePage === 866 ? 'ibm866' : `windows-${codePage}`
  try {
    return new TextDecoder(label)
  } catch {
    return WINDOWS_1252
  }
}

/**
 * Text that is mostly UTF-8: a line that isn't (a file saved as Latin-1 or Windows-1252, as older
 * editors on Windows do) is read as Windows-1252 instead of showing `�` for its umlauts. Line by
 * line, so a diff of such a file (git's headers are UTF-8) and a file of both kinds read right too.
 * `fallback` reads those lines another way (a console program's output: its DOS code page).
 */
export function decodeText(bytes: Uint8Array, fallback: ByteDecoder = WINDOWS_1252): string {
  try {
    return UTF8.decode(bytes)
  } catch {
    // Some line isn't UTF-8.
  }
  let text = ''
  let start = 0
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start)
    const end = newline === -1 ? bytes.length : newline + 1
    const line = bytes.subarray(start, end)
    try {
      text += UTF8.decode(line)
    } catch {
      text += fallback.decode(line)
    }
    start = end
  }
  return text
}
