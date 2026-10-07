/** Save `text` as a file in the browser (an object-URL download — nothing is uploaded). */
export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
