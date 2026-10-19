import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/carousel/styles.css";
// No @mantine/modals/styles.css: the package ships none — Modal/Overlay styles
// come from @mantine/core above.
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import App from "./App";
import { mantineTheme } from "@/theme";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <MantineProvider theme={mantineTheme}>
      {/* Two app-wide providers, both of which are only a *place* to render
          things: `useModals()` throws without ModalsProvider (the artwork
          table's delete confirmation goes through it), and Notifications is
          where the delete-success toast lands. */}
      <ModalsProvider>
        <Notifications />
        <Router>
          <App />
        </Router>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>,
);
