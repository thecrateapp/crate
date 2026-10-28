export interface UploadResponse {
  task_id: string;
  upload_id: string;
  file_count: number;
  total_bytes: number;
}

export interface ChunkedUploadInitResponse {
  upload_id: string;
  file_count: number;
  chunk_size: number;
}

export interface UploadProgress {
  done: number;
  total: number;
}

export interface UploadMusicFilesOptions {
  chunkedThresholdBytes?: number;
  onProgress?: (progress: UploadProgress) => void;
  onFileProgress?: (progress: FileUploadProgress) => void;
}

export interface FileUploadProgress {
  fileIndex: number;
  loadedBytes: number;
  totalBytes: number;
}
