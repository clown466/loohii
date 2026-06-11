type User = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  creditBalance: number;
};

type Asset = {
  url: string;
};

type Project = {
  id: string;
  name: string;
  aspectRatio: string;
  description: string | null;
  settings: unknown;
  createdAt: Date;
};

export function mapUser(user: User) {
  return {
    id: user.id,
    name: user.displayName ?? user.email.split("@")[0],
    email: user.email,
    avatar: user.avatarUrl ?? avatarFor(user.displayName ?? user.email),
    credits: user.creditBalance,
  };
}

export function mapProject(project: Project & { coverAsset?: Asset | null; _count?: { scenes?: number } }) {
  const settings = isRecord(project.settings) ? project.settings : {};
  return {
    id: project.id,
    title: project.name,
    ratio: project.aspectRatio,
    style: stringFrom(settings.style, "动漫风"),
    cover:
      project.coverAsset?.url ??
      stringFrom(settings.cover, "https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop"),
    description: project.description ?? undefined,
    globalPrompt: stringFrom(settings.globalPrompt, undefined),
    negativePrompt: stringFrom(settings.negativePrompt, undefined),
    setupSettings: isRecord(settings.setupSettings) ? settings.setupSettings : undefined,
    createdAt: project.createdAt.toISOString(),
    scenes: project._count?.scenes ?? 0,
    completedScenes: numberFrom(settings.completedScenes, 0),
  };
}

export function avatarFor(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function stringFrom(value: unknown, fallback: string): string;
export function stringFrom(value: unknown, fallback: undefined): string | undefined;
export function stringFrom(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
