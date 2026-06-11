import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  children: React.ReactNode;
}

export function ImageLightbox({ src, alt, children }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  const isDismissedRef = useRef(false);
  const handleOverlayPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    isDismissedRef.current = true;
    close();
  };
  const handleOverlayTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    isDismissedRef.current = true;
    close();
  };

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  return (
    <>
      <div onClick={() => setOpen(true)} className="cursor-zoom-in">
        {children}
      </div>
      {open && (
        <div
          onPointerDown={handleOverlayPointerDown}
          onTouchStart={handleOverlayTouchStart}
          onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (isDismissedRef.current) {
              isDismissedRef.current = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            close();
          }}
          className="fixed inset-0 z-app-modal flex items-center justify-center bg-black/80 animate-in fade-in duration-200"
        >
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] rounded-md object-contain animate-in zoom-in-90 duration-200"
          />
        </div>
      )}
    </>
  );
}
