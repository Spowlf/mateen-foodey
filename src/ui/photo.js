// A photo for logging, resized on the phone to 1,024 px on the long edge and sent as JPEG.

export const LONG_EDGE = 1024;

/** The size a photo is sent at: the long edge at most 1,024 px, never enlarged. */
export function fitSize(width, height, max = LONG_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A picked image file as { mediaType, data } (base64 JPEG, without the data: prefix). */
export async function photoForParse(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}
