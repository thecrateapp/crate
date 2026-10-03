import type { ReactNode } from "react";
import { toast } from "sonner";

export type NotifyId = string | number;

export interface NotifyOptions {
  id?: NotifyId;
  description?: ReactNode;
  duration?: number;
}

export interface NotifyPromiseMessages<T> {
  loading: ReactNode;
  success: ReactNode | ((data: T) => ReactNode);
  error: ReactNode | ((error: unknown) => ReactNode);
}

function toToastOptions(options?: NotifyOptions) {
  if (!options) return undefined;
  const { id, description, duration } = options;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(duration !== undefined ? { duration } : {}),
  };
}

export const notify = {
  success(message: ReactNode, options?: NotifyOptions): NotifyId {
    return toast.success(message, toToastOptions(options));
  },
  error(message: ReactNode, options?: NotifyOptions): NotifyId {
    return toast.error(message, toToastOptions(options));
  },
  info(message: ReactNode, options?: NotifyOptions): NotifyId {
    return toast.info(message, toToastOptions(options));
  },
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    messages: NotifyPromiseMessages<T>,
    options?: NotifyOptions,
  ): Promise<T> {
    const pending = typeof promise === "function" ? promise() : promise;
    toast.promise(pending, { ...toToastOptions(options), ...messages });
    return pending;
  },
};
