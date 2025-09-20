"use client";

import * as React from "react";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast";

export type ToastMessage = {
  title?: string;
  description?: string;
};

const ToastContext = React.createContext<(msg: ToastMessage) => void>(() => { });

export function ToastProviderWithViewport({ children }: Readonly<{ children: React.ReactNode }>) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);

  const push = React.useCallback((msg: ToastMessage) => {
    setMessages((prev) => [...prev, msg]);
    // Auto-dismiss after 3 seconds by removing the oldest toast
    window.setTimeout(() => {
      setMessages((prev) => prev.slice(1));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <ToastProvider>
        {children}
        <ToastViewport />
        {messages.map((m, i) => (
          <Toast key={i} open onOpenChange={() => { }}>
            <div className="grid gap-1">
              {m.title && <ToastTitle>{m.title}</ToastTitle>}
              {m.description && <ToastDescription>{m.description}</ToastDescription>}
            </div>
            <ToastClose />
          </Toast>
        ))}
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}