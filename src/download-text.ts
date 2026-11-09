/** Saves text as a file with the browser download the Settings export already uses: a temporary object URL on a temporary link that is clicked once and released a second later. It reads and writes nothing else and needs no channel to the main process. */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
