import React from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";

export default function App() {
  return (
    <div className="h-full w-full bg-background text-foreground selection:bg-primary/30">
      <RouterProvider router={router} />
    </div>
  );
}
