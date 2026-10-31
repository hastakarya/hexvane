import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { ToastWindow } from "./Toast";

// The same page runs in both windows; the hotkey toast window renders only the toast.
const isToast = (() => {
  try {
    return getCurrentWindow().label === "toast";
  } catch {
    return false; // not inside Tauri (e.g. the page opened in a browser)
  }
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isToast ? <ToastWindow /> : <App />}
  </React.StrictMode>,
);
