import { ImageOff } from "lucide-react";

export interface FileInspection {
  kind: "image" | "binary" | "large-text";
  size: number;
  mime?: string;
  dataUrl?: string;
  hex?: string;
  text?: string;
  shownBytes?: number;
  note?: string;
}

const fmt = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`;

/** Read-only preview for files the editor will not open: images, binary data, very large text. */
export default function FilePreview({ info, path }: { info: FileInspection; path: string }) {
  const name = path.split("/").pop() || path;
  return (
    <div className="file-preview" role="region" aria-label={`Read-only preview of ${name}`}>
      <div className="editor-notice" role="status">
        {info.kind === "image" && `Image preview (${info.mime}, ${fmt(info.size)}). Read-only: this file is not opened for editing.`}
        {info.kind === "binary" &&
          `Binary file (${fmt(info.size)}${info.mime ? ", " + info.mime : ""}). It cannot be edited as text. ${info.note ? info.note + " " : ""}Showing the first bytes in hexadecimal.`}
        {info.kind === "large-text" &&
          `Large text file (${fmt(info.size)}) is over the 2 MB editing limit. Read-only: showing only the first ${fmt(info.shownBytes ?? 0)}. Nothing here can be edited or saved.`}
      </div>
      {info.kind === "image" && info.dataUrl && (
        <div className="file-preview-image">
          <img src={info.dataUrl} alt={`Preview of ${name}`} draggable={false} />
        </div>
      )}
      {info.kind === "image" && !info.dataUrl && <ImageOff size={20} aria-hidden="true" />}
      {info.kind === "binary" && <pre className="file-preview-text" tabIndex={0} aria-label="Hexadecimal dump of the first bytes">{info.hex}</pre>}
      {info.kind === "large-text" && <pre className="file-preview-text" tabIndex={0} aria-label="Beginning of the file, read-only">{info.text}</pre>}
    </div>
  );
}
