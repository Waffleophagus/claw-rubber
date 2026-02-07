import { createRoot } from "react-dom/client"
import { DashboardApp } from "../shared/dashboard-app"
import "./app.css"

const container = document.getElementById("root")
if (!container) {
  throw new Error("Missing root container")
}

createRoot(container).render(<DashboardApp variant="v1" />)
