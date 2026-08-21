// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Clipboard/drop image processing for chat. Two renditions per image:
//   full  — max 1400px JPEG, what Jarvis actually sees (keeps tokens sane)
//   thumb — max 280px JPEG, what the transcript stores (localStorage-safe)
export type ChatImage = { full: string; thumb: string };

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function scale(img: HTMLImageElement, maxDim: number, quality: number): string {
  const f = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * f);
  c.height = Math.round(img.height * f);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export async function processImage(file: Blob): Promise<ChatImage> {
  const img = await loadImage(await readAsDataUrl(file));
  return { full: scale(img, 1400, 0.85), thumb: scale(img, 280, 0.7) };
}

export function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const items = (e as ClipboardEvent).clipboardData?.items ?? [];
  return [...items]
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}
