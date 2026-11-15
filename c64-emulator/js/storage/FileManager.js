export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function downloadBytes(name, bytes, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(name, text, mime = 'application/json') {
  downloadBytes(name, new TextEncoder().encode(text), mime);
}

export function classifyFile(name, bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.d64') || [174848, 175531, 196608, 197376].includes(bytes.length)) {
    return 'd64';
  }
  if (lower.endsWith('.json') || lower.endsWith('.b64')) {
    return 'container';
  }
  if (lower.endsWith('.bas') || lower.endsWith('.txt')) {
    return 'basic-text';
  }
  if (lower.endsWith('.p00')) {
    return 'p00';
  }
  if (lower.endsWith('.rom') || lower.endsWith('.bin')) {
    if (bytes.length === 8192 || bytes.length === 4096) {
      return 'rom';
    }
  }
  return 'prg';
}

export function attachDropTarget(element, onFiles) {
  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener('dragover', prevent);
  element.addEventListener('dragenter', prevent);
  element.addEventListener('drop', (event) => {
    prevent(event);
    const files = Array.from(event.dataTransfer ? event.dataTransfer.files : []);
    if (files.length) {
      onFiles(files);
    }
  });
}
