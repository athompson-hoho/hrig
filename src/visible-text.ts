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

/** Removes the approved invisible fillers and unpaired UTF-16 surrogates, without splitting valid astral characters. ZWJ is intentionally preserved for joined emoji and scripts; complete black-flag subdivision sequences keep their tag letters. */
export function stripInvisibleFillers(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; ) {
    const code = value.codePointAt(index)!;
    const width = code > 0xffff ? 2 : 1;
    if (code === 0x1f3f4) {
      let end = index + width;
      let tagCount = 0;
      while (
        end < value.length &&
        tagCount < 7 &&
        (value.codePointAt(end) ?? 0) >= 0xe0061 &&
        (value.codePointAt(end) ?? 0) <= 0xe007a
      ) {
        end += 2;
        tagCount++;
      }
      if (
        tagCount >= 3 &&
        value.codePointAt(end) === 0xe007f
      ) {
        result += value.slice(index, end + 2);
        index = end + 2;
        continue;
      }
    }
    if (!isInvisibleFiller(code) && !(code >= 0xd800 && code <= 0xdfff))
      result += value.slice(index, index + width);
    index += width;
  }
  return result;
}
