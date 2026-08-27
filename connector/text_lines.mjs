export function splitLinesWithOffsets(input) {
  const text = String(input ?? "");
  const lines = [];
  const offsets = [];
  let lineStart = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (character !== "\n" && character !== "\r") {
      index += 1;
      continue;
    }

    lines.push(text.slice(lineStart, index));
    offsets.push(lineStart);
    if (character === "\r" && text[index + 1] === "\n") index += 2;
    else index += 1;
    lineStart = index;
  }

  lines.push(text.slice(lineStart));
  offsets.push(lineStart);
  return { lines, offsets };
}
