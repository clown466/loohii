import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { router } from "./routes";
import { queryClient } from "./lib/queryClient";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-full w-full bg-background text-foreground selection:bg-primary/30">
        <RouterProvider router={router} />
      </div>
    </QueryClientProvider>
  );
}
