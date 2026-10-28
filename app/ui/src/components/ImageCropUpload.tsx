import { useRef, useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Button } from "@crate/ui/shadcn/button";
import { toast } from "sonner";
import { Camera } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { FormField } from "@crate/ui/primitives/FormField";
import { Slider } from "@crate/ui/primitives/Slider";

import { waitForTask } from "@/lib/tasks";

interface ImageCropUploadProps {
  endpoint: string;
  aspect: number;
  onUploaded?: () => void;
  className?: string;
  label?: string;
}

export function ImageCropUpload({
  endpoint,
  aspect,
  onUploaded,
  className,
  label,
}: ImageCropUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const croppedAreaRef = useRef<Area | null>(null);

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    croppedAreaRef.current = croppedPixels;
  }, []);

  async function handleUpload() {
    const croppedArea = croppedAreaRef.current;
    if (!imageSrc || !croppedArea) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedArea);
      const form = new FormData();
      form.append("file", blob, "image.jpg");
      const res = await fetch(endpoint, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // Wait for worker task to complete
      if (data.task_id) {
        toast.success("Processing image...");
        const task = await waitForTask(data.task_id, 15000).catch(() => null);
        if (task?.status === "failed") {
          throw new Error(task.error || "Image processing failed");
        }
      }

      toast.success("Image saved");
      setImageSrc(null);
      croppedAreaRef.current = null;
      onUploaded?.();
    } catch (e) {
      toast.error(
        `Upload failed: ${e instanceof Error ? e.message : "Unknown"}`,
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function cancel() {
    setImageSrc(null);
    croppedAreaRef.current = null;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        aria-label={label ?? "Upload image"}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
        }}
      />

      <span
        className={
          className ??
          "absolute bottom-1 right-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/cover:opacity-100 pointer-fine:group-focus-within/cover:opacity-100"
        }
      >
        <ActionButton
          label={label ?? "Upload image"}
          loading={uploading}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <Camera data-admin-ux="crop-upload" aria-hidden="true" />
        </ActionButton>
      </span>

      <AppModal
        open={Boolean(imageSrc)}
        onClose={cancel}
        title="Crop image"
        description="Adjust the crop and zoom before uploading."
        closeDisabled={uploading}
        closeOnOverlay={!uploading}
        closeOnEscape={!uploading}
        size="lg"
      >
        <ModalBody className="space-y-4">
          <div
            className="relative w-full"
            style={{
              height: aspect >= 1 ? "min(50vh, 400px)" : "min(55vh, 500px)",
            }}
          >
            {imageSrc ? (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            ) : null}
          </div>
          <FormField label="Zoom" className="px-5 pb-4">
            <Slider
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </FormField>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={cancel} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleUpload()}
            loading={uploading}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </ModalFooter>
      </AppModal>
    </>
  );
}

async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const img = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/jpeg",
      0.92,
    );
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
