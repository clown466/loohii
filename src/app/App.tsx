import React from "react";
import { RouterProvider } from "react-router";
import { router } from "./routes";

export default function App() {
  return (
    <div className="h-full w-full bg-[#09090b] text-[#fafafa] selection:bg-[#6366f1]/30">
      <RouterProvider router={router} />
    </div>
  );
}
