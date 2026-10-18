import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/ui";
import { api, applyAppearance, loadAppInfo } from "./lib/api";
import "./styles.css";

// Image paths depend on the app's data folder, and the theme on saved settings,
// so load both before the first render to avoid a flash of the wrong theme.
Promise.all([loadAppInfo(), api.getSettings().then((s) => applyAppearance(s.appearance))]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );
});

