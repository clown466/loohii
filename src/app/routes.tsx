import React from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LandingPage } from "./pages/LandingPage";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectSetupPage } from "./pages/ProjectSetupPage";
import { ProjectCanvasPage } from "./pages/ProjectCanvasPage";
import { ProjectRecordsPage } from "./pages/ProjectRecordsPage";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/login",
    element: <AuthPage />,
  },
  {
    path: "/register",
    element: <AuthPage />,
  },
  {
    path: "/app",
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="dashboard" replace />,
          },
          {
            path: "dashboard",
            element: <DashboardPage />,
          },
          {
            path: "project/:id/setup",
            element: <ProjectSetupPage />,
          },
          {
            path: "project/:id/canvas",
            element: <ProjectCanvasPage />,
          },
          {
            path: "project/:id/records",
            element: <ProjectRecordsPage />,
          },
          {
            path: "settings",
            children: [
              { index: true, element: <Navigate to="profile" replace /> },
              { path: ":tab", element: <SettingsPage /> },
            ]
          }
        ],
      }
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  }
]);
