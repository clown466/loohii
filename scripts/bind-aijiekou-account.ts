/**
 * 一次性脚本：把存量 loohii 本地账号绑定到 aijiekou 平台账号（契约 §2.4）。
 *
 * 用法：
 *   npx tsx scripts/bind-aijiekou-account.ts --email <loohii本地邮箱> --cloud-token <平台JWT>
 * 或：
 *   npx tsx scripts/bind-aijiekou-account.ts --email <loohii本地邮箱> --platform-user-id <平台users.id>
 *
 * --cloud-token 模式（推荐）：脚本先调 {AIJIEKOU_API_BASE}/v1/me 验真，确保绑定的是本人账号，
 * 并把 accessToken 写入 Account（P2-B 扣点透传要用）。
 * --platform-user-id 模式：离线补录（不验真、不写 accessToken，首次登录时会自动刷新）。
 *
 * 幂等：已绑定同平台账号 → 直接报成功；已绑定不同平台账号 → 报错退出。
 * 前置：DATABASE_URL 可用，且已执行 prisma migrate（AccountProvider 含 AIJIEKOU）。
 */
import { prisma } from "../server/src/lib/prisma";
import { fetchPlatformMe } from "../server/src/lib/aijiekou";
import { AIJIEKOU_PROVIDER } from "../server/src/lib/shadowUser";

interface Args {
  email: string;
  cloudToken?: string;
  platformUserId?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--email" && value) args.email = value.trim().toLowerCase();
    if (key === "--cloud-token" && value) args.cloudToken = value.trim();
    if (key === "--platform-user-id" && value) args.platformUserId = value.trim();
    if (key.startsWith("--")) i += 1;
  }
  if (!args.email) {
    console.error("缺少 --email");
    process.exit(2);
  }
  if (!args.cloudToken && !args.platformUserId) {
    console.error("需要 --cloud-token 或 --platform-user-id 之一");
    process.exit(2);
  }
  return args as Args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let platformUserId = args.platformUserId ?? "";
  let platformEmail = args.email;
  let accessToken: string | undefined;

  if (args.cloudToken) {
    const me = await fetchPlatformMe(args.cloudToken);
    if (!me) {
      console.error("cloud-token 验真失败（平台返回 401），请重新登录平台获取");
      process.exit(1);
    }
    platformUserId = String(me.id);
    platformEmail = me.email;
    accessToken = args.cloudToken;
    if (me.email !== args.email) {
      console.warn(`注意：平台账号邮箱 ${me.email} 与本地邮箱 ${args.email} 不一致，仍按 --email 指定的本地用户绑定`);
    }
  }

  const user = await prisma.user.findUnique({ where: { email: args.email } });
  if (!user) {
    console.error(`本地不存在用户 ${args.email}，无需绑定（该平台账号首次登录时会自动建影子用户）`);
    process.exit(1);
  }

  const existing = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: AIJIEKOU_PROVIDER,
        providerAccountId: platformUserId,
      },
    },
  });
  if (existing) {
    if (existing.userId === user.id) {
      console.log(`已绑定：${args.email} ↔ 平台用户 ${platformUserId}（幂等，无需操作）`);
      process.exit(0);
    }
    console.error(`平台用户 ${platformUserId} 已绑定到其他本地用户（${existing.userId}），拒绝重复绑定`);
    process.exit(1);
  }

  await prisma.account.create({
    data: {
      userId: user.id,
      provider: AIJIEKOU_PROVIDER,
      providerAccountId: platformUserId,
      email: platformEmail,
      accessToken: accessToken ?? null,
    },
  });
  console.log(`绑定成功：本地用户 ${args.email}（${user.id}）↔ 平台用户 ${platformUserId}`);
  console.log("该用户的历史项目/画布数据保持不变；下次用平台账号登录即进入原账号。");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
