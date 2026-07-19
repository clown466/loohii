import React, { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LandingPage } from "./pages/LandingPage";

const AuthPage = React.lazy(() => import("./pages/AuthPage").then(m => ({ default: m.AuthPage })));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const ProjectSetupPage = React.lazy(() => import("./pages/ProjectSetupPage").then(m => ({ default: m.ProjectSetupPage })));
const ProjectCanvasPage = React.lazy(() => import("./pages/ProjectCanvasPage").then(m => ({ default: m.ProjectCanvasPage })));
const ProjectRecordsPage = React.lazy(() => import("./pages/ProjectRecordsPage").then(m => ({ default: m.ProjectRecordsPage })));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/login",
    element: <Suspense fallback={null}><AuthPage /></Suspense>,
  },
  {
    path: "/register",
    // 本地注册通道已下线（全站只认 aijiekou 平台账号），老链接一律引导到登录页
    element: <Navigate to="/login" replace />,
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
