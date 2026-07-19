/**
 * 平台用户 → loohii 本地影子用户解析（契约 §2.3/§2.4）。
 * 映射载体：Account(provider=AIJIEKOU, providerAccountId=<平台 users.id 字符串>)，
 * @@unique([provider, providerAccountId]) 保证一个平台账号只映射一个本地 User。
 */
import { prisma } from "./prisma";
import { ensureDefaultTeam } from "./defaults";
import type { PlatformMe } from "./aijiekou";

export const AIJIEKOU_PROVIDER = "AIJIEKOU" as const;

export interface LocalUserRef {
  id: string;
  email: string;
}

/** 平台 email 推导本地显示名（平台无昵称字段，契约 §4.4 未做） */
export function displayNameFor(email: string): string {
  return email.split("@")[0] || "loohii 用户";
}

/**
 * 解析（必要时创建）平台用户对应的本地影子用户：
 * 1. Account(AIJIEKOU, platformId) 已存在 → 刷新 accessToken，返回本地用户
 * 2. 否则同 email 本地用户已存在 → 挂 Account 绑定（契约 §2.4-1，同 email 即身份证据）
 * 3. 都没有 → 建影子 User（passwordHash=null 禁密码登录、creditBalance=0 不再赠送）+ Account + 默认 Team
 * 每次调用都会更新 Account.accessToken 为本次平台 token（P2-B 扣点透传用）。
 */
export async function resolveLocalUser(me: PlatformMe, platformToken: string): Promise<LocalUserRef> {
  const providerAccountId = String(me.id);

  const linked = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: AIJIEKOU_PROVIDER,
        providerAccountId,
      },
    },
    include: { user: true },
  });

  if (linked?.user) {
    await prisma.account.update({
      where: { id: linked.id },
      data: { accessToken: platformToken, email: me.email },
    });
    await touchLastLogin(linked.user.id);
    return { id: linked.user.id, email: linked.user.email };
  }

  const byEmail = await prisma.user.findUnique({ where: { email: me.email } });
  if (byEmail) {
    await prisma.account.create({
      data: {
        userId: byEmail.id,
        provider: AIJIEKOU_PROVIDER,
        providerAccountId,
        email: me.email,
        accessToken: platformToken,
      },
    });
    await touchLastLogin(byEmail.id);
    return { id: byEmail.id, email: byEmail.email };
  }

  const user = await prisma.user.create({
    data: {
      email: me.email,
      displayName: displayNameFor(me.email),
      passwordHash: null,
      creditBalance: 0,
      accounts: {
        create: {
          provider: AIJIEKOU_PROVIDER,
          providerAccountId,
          email: me.email,
          accessToken: platformToken,
        },
      },
    },
  });
  await ensureDefaultTeam(user.id);
  await touchLastLogin(user.id);
  return { id: user.id, email: user.email };
}

async function touchLastLogin(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}
