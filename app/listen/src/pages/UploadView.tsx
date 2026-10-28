import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CheckCircle2,
  Music,
  Upload as UploadIcon,
  X,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { formatBytes } from "../../../shared/web/utils";
import type {
  UploadResponse,
  UploadProgress,
  FileUploadProgress,
} from "./upload-types";

export interface UploadViewProps {
  files: File[];
  submitting: boolean;
  lastUpload: UploadResponse | null;
  uploadProgress: UploadProgress | null;
  fileProgress: Record<number, FileUploadProgress>;
  totalBytes: number;
  onFilesChange: (files: File[]) => void;
  onClear: () => void;
  onSubmit: () => void;
}

/** File selection and real progress presentation; the page owns upload/task authority. */
export function UploadView({
  files,
  submitting,
  lastUpload,
  uploadProgress,
  fileProgress,
  totalBytes,
  onFilesChange,
  onClear,
  onSubmit,
}: UploadViewProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <PageHeader
        title={t("upload.title")}
        eyebrow={t("upload.badge")}
        subtitle={t("upload.subtitle")}
      />
      <div className="grid min-w-0 gap-8">
        <div className="grid min-w-0 content-start gap-6">
          <div
            role="group"
            aria-label={t("upload.badge")}
            data-upload-dropzone=""
            data-dragging={dragging && !submitting}
            className="grid min-h-64 min-w-0 content-center justify-items-center gap-6 rounded-panel border border-dashed border-border-quiet bg-surface-object p-6 transition-colors focus-within:border-accent-action data-[dragging=true]:border-accent-action"
            onDragEnter={(event) => {
              event.preventDefault();
              if (submitting || !event.dataTransfer.types.includes("Files"))
                return;
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = submitting ? "none" : "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              const droppedFiles = Array.from(event.dataTransfer.files);
              if (!submitting && droppedFiles.length)
                onFilesChange(droppedFiles);
            }}
          >
            <CrateLogo effects={false} className="size-12" />
            <FormField
              label={t("upload.dropzone.title")}
              hint={t("upload.dropzone.formats")}
              kind="group"
              className="w-full text-center"
            >
              {(props) => (
                <div {...props} role="group" className="flex justify-center">
                  <Input
                    ref={fileInput}
                    type="file"
                    hidden
                    multiple
                    accept=".flac,.mp3,.m4a,.ogg,.opus,.wav,.aac,.alac,.zip,audio/*"
                    disabled={submitting}
                    aria-label={t("upload.dropzone.chooseFiles")}
                    onChange={(event) => {
                      const selected = Array.from(event.target.files || []);
                      if (selected.length) onFilesChange(selected);
                      // Selecting the same files after Clear must fire change again.
                      event.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={submitting}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t("upload.dropzone.chooseFiles")}
                  </Button>
                </div>
              )}
            </FormField>
          </div>
          {files.length ? (
            <section
              aria-label={t("upload.ready.title")}
              className="grid min-w-0 gap-2 bg-surface-canvas"
            >
              <SectionHeader
                title={t("upload.ready.title")}
                subtitle={t("upload.selectedFiles", {
                  count: files.length,
                  size: formatBytes(totalBytes),
                })}
                action={
                  <ActionButton
                    label={t("common.clear")}
                    tooltip={t("common.clear")}
                    disabled={submitting}
                    onClick={onClear}
                  >
                    <X />
                  </ActionButton>
                }
              />
              <div className="grid max-h-72 min-w-0 gap-2 overflow-y-auto">
                {files.map((file, index) => {
                  const progress = fileProgress[index];
                  const reading = progress
                    ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(file.size)}`
                    : formatBytes(file.size);
                  const Icon = file.name.toLowerCase().endsWith(".zip")
                    ? Archive
                    : Music;
                  return (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="grid min-w-0 gap-2"
                    >
                      <EntityRow
                        title={file.name}
                        leading={
                          <Icon
                            size={CRATE_ICON_SIZE.md}
                            className="shrink-0 text-accent-action"
                            aria-hidden="true"
                          />
                        }
                        meta={<MonoLabel as="span">{reading}</MonoLabel>}
                        menuButton="none"
                      />
                      {submitting ? (
                        <ProgressHairline
                          label={file.name}
                          value={
                            progress && file.size > 0
                              ? progress.loadedBytes / file.size
                              : undefined
                          }
                          valueText={progress ? reading : undefined}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <div className="flex justify-end">
            <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={submitting || files.length === 0}
            >
              {!submitting ? <UploadIcon size={CRATE_ICON_SIZE.sm} /> : null}
              {uploadProgress
                ? t("upload.progress", {
                    done: uploadProgress.done,
                    total: uploadProgress.total,
                  })
                : t("upload.import")}
            </Button>
          </div>
          {lastUpload ? (
            <div role="status" className="grid min-w-0 gap-2">
              <MonoLabel
                tone="accent"
                className="inline-flex items-center gap-2"
              >
                <CheckCircle2 size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                {t("upload.status.queued")}
              </MonoLabel>
              <p className="wrap-anywhere text-sm text-text-muted">
                {t("upload.status.processing", {
                  count: lastUpload.file_count,
                })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
