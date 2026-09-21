import "@mantine/core/styles.css";
import "@mantine/carousel/styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import App from "./App";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <MantineProvider>
      <Router>
        <App />
      </Router>
    </MantineProvider>
  </React.StrictMode>,
);
