"use client";

import { useEffect, useRef, useState } from "react";

type NotificationPermission = "granted" | "denied" | "default";

export function useNotification() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (!supported) return false;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === "granted";
    } catch {
      return false;
    }
  };

  const sendNotification = (options: {
    title: string;
    body?: string;
    icon?: string;
    tag?: string;
    requireInteraction?: boolean;
  }) => {
    if (!supported || permission !== "granted") return;

    try {
      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon || "/favicon-idle-v2.svg",
        tag: options.tag,
        requireInteraction: options.requireInteraction,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      setTimeout(() => notification.close(), 5000);
    } catch {
      // Silent fail
    }
  };

  return {
    supported,
    permission,
    requestPermission,
    sendNotification,
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { supported, permission, requestPermission } = useNotification();
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!supported || permission !== "default" || requested) return;

    // Auto-request permission on first timer start
    const handleTimerStart = () => {
      if (!requested) {
        setRequested(true);
        requestPermission();
      }
    };

    window.addEventListener("voho-timer-changed", handleTimerStart);
    return () => window.removeEventListener("voho-timer-changed", handleTimerStart);
  }, [supported, permission, requested]);

  return <>{children}</>;
}
