/** Upload 1 file lên /api/media/upload, có theo dõi tiến độ. */
export function uploadFile(itemId: number, file: File, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/media/upload?itemId=${itemId}&filename=${encodeURIComponent(file.name)}`;
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Lỗi upload (${xhr.status})`;
      try {
        msg = JSON.parse(xhr.responseText).error || msg;
      } catch {}
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối khi upload"));
    xhr.send(file);
  });
}

export const ACCEPT_MEDIA = "image/*,video/*,application/pdf,.pdf,.zip,.txt,.step,.stp,.stl";
