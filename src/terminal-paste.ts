export async function pasteClipboard(actions: {
  readText: () => Promise<string>; hasImage: () => Promise<boolean>;
  pasteText: (text: string) => void; pasteImage: () => Promise<void>;
}) {
  const text=await actions.readText();
  if(text){actions.pasteText(text);return;}
  if(await actions.hasImage())await actions.pasteImage();
}
