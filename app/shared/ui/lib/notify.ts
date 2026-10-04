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

type ToastMethod = (message: ReactNode, options?: NotifyOptions) => NotifyId;

function toToastOptions(options?: NotifyOptions): NotifyOptions | undefined {
  if (!options) return undefined;
  const { id, description, duration } = options;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(duration !== undefined ? { duration } : {}),
  };
}

function show(
  method: ToastMethod,
  message: ReactNode,
  options?: NotifyOptions,
): NotifyId {
  const toastOptions = toToastOptions(options);
  return toastOptions ? method(message, toastOptions) : method(message);
}

export const notify = {
  success(message: ReactNode, options?: NotifyOptions): NotifyId {
    return show(toast.success, message, options);
  },
  error(message: ReactNode, options?: NotifyOptions): NotifyId {
    return show(toast.error, message, options);
  },
  info(message: ReactNode, options?: NotifyOptions): NotifyId {
    return show(toast.info, message, options);
  },
  loading(message: ReactNode, options?: NotifyOptions): NotifyId {
    return show(toast.loading, message, options);
  },
  dismiss(id?: NotifyId): void {
    if (id === undefined) toast.dismiss();
    else toast.dismiss(id);
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
