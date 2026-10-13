import { useEffect, useRef } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { deviceTimezone } from "@/lib/device-timezone";

export function TimezoneAutodetect() {
  const { user, refetch } = useAuth();
  const attemptedRef = useRef<number | null>(null);
  const userId = user?.id ?? null;
  const storedTimezone = user?.timezone;

  useEffect(() => {
    if (userId === null || storedTimezone !== null) return;
    if (attemptedRef.current === userId) return;
    const timezone = deviceTimezone();
    if (!timezone) return;
    attemptedRef.current = userId;
    api("/api/auth/profile", "PUT", { timezone })
      .then(() => refetch())
      .catch(() => {});
  }, [refetch, storedTimezone, userId]);

  return null;
}
