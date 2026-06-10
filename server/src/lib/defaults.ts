import { prisma } from "./prisma";

export async function ensureDefaultTeam(userId: string) {
  const existing = await prisma.teamMember.findFirst({
    where: { userId },
    include: { team: true },
  });

  if (existing?.team) return existing.team;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const baseSlug = slugify(user.email.split("@")[0] || "loohii");
  const slug = `${baseSlug}-${userId.slice(-6)}`;

  return prisma.team.create({
    data: {
      ownerId: userId,
      name: `${user.displayName ?? user.email.split("@")[0]} 的团队`,
      slug,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "loohii";
}

