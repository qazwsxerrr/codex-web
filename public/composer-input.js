export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function makeMention(file) {
  const path = String(file?.path || "").trim();
  if (!path) throw new Error("Mention path is required");
  return { type: "mention", name: String(file?.file_name || file?.name || path.split(/[\\/]/).pop()), path };
}

export function validateImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Only image attachments are supported");
  if (Number(file.size) > MAX_IMAGE_BYTES) throw new Error("Each image must be 10 MB or smaller");
  return true;
}

export function composeUserInput(text, mentions = [], images = []) {
  if (images.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images`);
  const input = [];
  const rawText = String(text ?? "");
  if (rawText.trim()) input.push({ type: "text", text: rawText });
  for (const mention of mentions) input.push(makeMention(mention));
  for (const image of images) {
    const url = typeof image === "string" ? image : image?.url;
    if (!String(url || "").startsWith("data:image/")) throw new Error("Image data URL is invalid");
    input.push({ type: "image", url });
  }
  if (!input.length) throw new Error("Message cannot be empty");
  return input;
}

export function displayInput(input = []) {
  let imageIndex = 0;
  return input.map((part) => {
    if (part.type === "text") return part.text;
    if (part.type === "mention") return `@${part.name}`;
    if (part.type === "image" || part.type === "localImage") {
      imageIndex += 1;
      return `[Image #${imageIndex}]`;
    }
    return "";
  }).filter(Boolean).join("\n");
}

export function displayInputText(input = []) {
  return input.map((part) => {
    if (part?.type === "text") return String(part.text || "");
    if (part?.type === "mention") return `@${part.name}`;
    return "";
  }).filter(Boolean).join("\n");
}

export function displayInputImages(input = []) {
  let imageIndex = 0;
  return input.flatMap((part) => {
    if (!part || !["image", "localImage"].includes(part.type)) return [];
    imageIndex += 1;
    const url = part.type === "image" ? String(part.url || "") : "";
    const src = url.startsWith("data:image/") ? url : "";
    return [{ index: imageIndex, src, available: Boolean(src) }];
  });
}

export function presentUserInput(input = []) {
  return {
    text: displayInputText(input),
    displayText: displayInput(input),
    images: displayInputImages(input),
  };
}
