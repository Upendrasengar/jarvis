// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Paste an image into a note or call note, the way Obsidian does: the file is
// written into the vault as "Pasted image <stamp>.png" and the note gets an
// ![[embed]] line. The markdown stays portable — open the same note in
// Obsidian and the image is there.
import { imagesFromClipboard } from "./image";

const asDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(f);
  });

/** Uploads one clipboard image and returns its Obsidian embed, or null. */
export async function uploadPastedImage(file: Blob): Promise<string | null> {
  try {
    const data = await asDataUrl(file);
    const r = await fetch("/api/attachment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!r.ok) return null;
    return (await r.json()).embed as string;
  } catch {
    return null;
  }
}

/**
 * Clipboard → markdown. Returns the new note text with the embeds appended as
 * their own lines, or null when the clipboard holds no image (so the caller
 * lets the normal text paste happen).
 */
export async function pasteImagesInto(
  e: ClipboardEvent | React.ClipboardEvent,
  md: string,
): Promise<string | null> {
  const files = imagesFromClipboard(e);
  if (!files.length) return null;
  const embeds: string[] = [];
  for (const f of files.slice(0, 4)) {
    const em = await uploadPastedImage(f);
    if (em) embeds.push(em);
  }
  if (!embeds.length) return null;
  const base = md.replace(/\s*$/, "");
  return `${base}\n\n${embeds.join("\n")}\n`;
}
