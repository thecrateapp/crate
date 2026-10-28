import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { ApiError, api } from "@/lib/api";

import type {
  UploadResponse,
  ChunkedUploadInitResponse,
  UploadProgress,
  UploadMusicFilesOptions,
  FileUploadProgress,
} from "./upload-types";
import { UploadView } from "./UploadView";

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 80 * 1024 * 1024;

function totalFileBytes(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function directUpload(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return api<UploadResponse>("/api/acquisition/upload", "POST", formData);
}

async function chunkedUpload(
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
  onFileProgress?: (progress: FileUploadProgress) => void,
): Promise<UploadResponse> {
  const init = await api<ChunkedUploadInitResponse>(
    "/api/acquisition/upload/chunked",
    "POST",
    {
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || null,
      })),
    },
  );

  const totalChunks = files.reduce(
    (sum, file) => sum + Math.max(1, Math.ceil(file.size / init.chunk_size)),
    0,
  );
  let done = 0;

  files.forEach((file, fileIndex) => {
    onFileProgress?.({ fileIndex, loadedBytes: 0, totalBytes: file.size });
  });

  for (const [fileIndex, file] of files.entries()) {
    const chunkCount = Math.max(1, Math.ceil(file.size / init.chunk_size));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * init.chunk_size;
      const end = Math.min(file.size, start + init.chunk_size);
      const formData = new FormData();
      formData.append("file_index", String(fileIndex));
      formData.append("chunk_index", String(chunkIndex));
      formData.append(
        "chunk",
        file.slice(start, end),
        `${file.name}.part-${chunkIndex}`,
      );

      // Chunks are sent in order so the server can commit a deterministic upload.
      // react-doctor-disable-next-line async-await-in-loop
      await api(
        `/api/acquisition/upload/chunked/${init.upload_id}/chunk`,
        "POST",
        formData,
      );
      done += 1;
      onFileProgress?.({ fileIndex, loadedBytes: end, totalBytes: file.size });
      onProgress?.({ done, total: totalChunks });
    }
  }

  return api<UploadResponse>(
    `/api/acquisition/upload/chunked/${init.upload_id}/complete`,
    "POST",
  );
}

export function uploadMusicFiles(
  files: File[],
  options: UploadMusicFilesOptions = {},
): Promise<UploadResponse> {
  const threshold =
    options.chunkedThresholdBytes ?? CHUNKED_UPLOAD_THRESHOLD_BYTES;
  if (totalFileBytes(files) > threshold) {
    return chunkedUpload(files, options.onProgress, options.onFileProgress);
  }
  return directUpload(files);
}

function uploadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.status === 413) {
    return t("upload.errors.tooLarge");
  }
  if (error instanceof ApiError && error.message) {
    return t("upload.errors.queueWithMessage", { message: error.message });
  }
  return t("upload.errors.queue");
}

export function Upload() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const [fileProgress, setFileProgress] = useState<
    Record<number, FileUploadProgress>
  >({});

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  async function handleSubmit() {
    if (files.length === 0) return;

    setSubmitting(true);
    setUploadProgress(null);
    setFileProgress({});
    try {
      const response = await uploadMusicFiles(files, {
        onProgress: setUploadProgress,
        onFileProgress: (progress) =>
          setFileProgress((current) => ({
            ...current,
            [progress.fileIndex]: progress,
          })),
      });
      setLastUpload(response);
      notify.success(t("upload.toasts.queued"));
      setFiles([]);
    } catch (error) {
      notify.error(uploadErrorMessage(error, t));
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
      setFileProgress({});
    }
  }

  return (
    <UploadView
      files={files}
      submitting={submitting}
      lastUpload={lastUpload}
      uploadProgress={uploadProgress}
      fileProgress={fileProgress}
      totalBytes={totalBytes}
      onFilesChange={setFiles}
      onClear={() => setFiles([])}
      onSubmit={() => void handleSubmit()}
    />
  );
}
