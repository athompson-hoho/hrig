function isInvisibleFiller(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x180e ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x2800 ||
    code === 0x3164 ||
    code === 0xffa0 ||
    (code >= 0xfff9 && code <= 0xfffb) ||
    (code >= 0xe0000 && code <= 0xe007f)
  );
}

/** Removes the approved invisible fillers and unpaired UTF-16 surrogates, without splitting valid astral characters. ZWJ is intentionally preserved for joined emoji and scripts. */
export function stripInvisibleFillers(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (isInvisibleFiller(code) || (code >= 0xd800 && code <= 0xdfff))
      continue;
    result += character;
  }
  return result;
}
