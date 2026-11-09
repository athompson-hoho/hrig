// Read-only inspection of a file the editor cannot open for editing (binary or
// over the 2 MB edit limit). Never returns an editable buffer or revision.
const IMAGE_MAX = 4000000;
const HEAD_TEXT = 262144;
const HEX_BYTES = 512;
const SNIFF = 8192;

const starts = (b, bytes, at = 0) => bytes.every((v, i) => b[at + i] === v);
function imageMime(head, path = "") {
  const ext = String(path).toLowerCase().split(".").pop();
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(head, [0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) return "image/gif";
  if (starts(head, [0x52, 0x49, 0x46, 0x46]) && starts(head, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts(head, [0x42, 0x4d]) && ext === "bmp") return "image/bmp";
  if (starts(head, [0, 0, 1, 0]) && ext === "ico") return "image/x-icon";
  return "";
}
/** Classify from the first bytes: "image" | "binary" | "text". */
function classify(head, path) {
  if (imageMime(head, path)) return "image";
  return head.includes(0) ? "binary" : "text";
}
function hexRows(buf) {
  const rows = [];
  for (let i = 0; i < buf.length; i += 16) {
    const chunk = buf.subarray(i, i + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    rows.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47, " ")}  ${ascii}`);
  }
  return rows.join("\n");
}
function headText(buf) {
  let text = buf.toString("utf8").replace(/�$/, "");
  const cut = text.lastIndexOf("\n");
  if (cut > text.length / 2) text = text.slice(0, cut);
  return text;
}
/**
 * @param {{size:number, head:Buffer, path?:string, readAll?:()=>Promise<Buffer>, readText?:()=>Promise<Buffer>}} f
 */
async function inspect(f) {
  const kind = classify(f.head, f.path);
  if (kind === "image") {
    const mime = imageMime(f.head, f.path);
    if (f.size <= IMAGE_MAX) {
      const data = await f.readAll();
      return { kind: "image", size: f.size, mime, dataUrl: `data:${mime};base64,${data.toString("base64")}` };
    }
    return { kind: "binary", size: f.size, mime, hex: hexRows(f.head.subarray(0, HEX_BYTES)), note: "Image is too large to preview." };
  }
  if (kind === "binary") return { kind: "binary", size: f.size, hex: hexRows(f.head.subarray(0, HEX_BYTES)) };
  if (f.size > 2000000) {
    const text = headText(await f.readText());
    return { kind: "large-text", size: f.size, text, shownBytes: Buffer.byteLength(text, "utf8") };
  }
  return { kind: "text", size: f.size };
}
async function inspectLocal(fs, target, path) {
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Not a regular file.");
  const handle = await fs.open(target, "r");
  try {
    const readN = async (n) => {
      const buf = Buffer.alloc(Math.min(n, stat.size));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      return buf.subarray(0, bytesRead);
    };
    const head = await readN(SNIFF);
    return await inspect({
      size: stat.size, head, path,
      readAll: () => readN(IMAGE_MAX),
      readText: () => readN(HEAD_TEXT),
    });
  } finally {
    await handle.close();
  }
}
module.exports = { inspect, inspectLocal, classify, imageMime, hexRows, headText, IMAGE_MAX, HEAD_TEXT, HEX_BYTES, SNIFF };
