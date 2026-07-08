const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_PHOTO_DIMENSION = 512;

export async function readProfilePhotoFile(file: File): Promise<string> {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Upload a JPG or PNG image");
  }

  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error("Profile photo must be 2MB or smaller");
  }

  const source = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not process image");
  }

  const scale = Math.min(1, MAX_PROFILE_PHOTO_DIMENSION / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(source, 0, 0, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = outputType === "image/jpeg" ? 0.88 : undefined;
  const dataUrl = canvas.toDataURL(outputType, quality);
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Math.ceil((base64.length * 3) / 4);

  if (bytes > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error("Profile photo must be 2MB or smaller");
  }

  return dataUrl;
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image file"));
    };

    image.src = objectUrl;
  });
}
