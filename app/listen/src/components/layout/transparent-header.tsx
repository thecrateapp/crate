import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

type RegisterTransparentHeader = () => () => void;

const TransparentHeaderContext =
  createContext<RegisterTransparentHeader | null>(null);

export const TransparentHeaderProvider = TransparentHeaderContext.Provider;

export function useTransparentHeaderRegistry() {
  const [requests, setRequests] = useState(0);
  const register = useCallback<RegisterTransparentHeader>(() => {
    setRequests((count) => count + 1);
    return () => setRequests((count) => count - 1);
  }, []);
  return { transparent: requests > 0, register };
}

export function useTransparentHeader(enabled = true) {
  const register = useContext(TransparentHeaderContext);
  useLayoutEffect(() => {
    if (!enabled || !register) return;
    return register();
  }, [enabled, register]);
}

export function TransparentHeader({ children }: { children: ReactNode }) {
  useTransparentHeader();
  return children;
}
