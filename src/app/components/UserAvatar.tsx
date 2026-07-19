import { cn } from "../utils/cn";

/**
 * 默认用户头像（P5-D）：渐变底色 + 用户名首字，替代 dicebear 卡通图。
 * 3 组渐变配色按用户 id/email 哈希取模，同人同色；圆形 + 微描边。
 * 传入的 src 若为空或仍是 dicebear 外链，一律走渐变首字方案。
 */
const AVATAR_PALETTES: Array<[string, string]> = [
  ["#F5A623", "#C2710A"], // 琥珀金（品牌色）
  ["#8B7CFF", "#4F46E5"], // 星紫
  ["#3ECFC0", "#0E7490"], // 青碧
];

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface UserAvatarProps {
  /** 用户名（取首字）；为空时用邮箱前缀 */
  name?: string | null;
  /** 稳定标识（用户 id 或邮箱），决定渐变配色 */
  seed?: string | null;
  /** 自定义头像 URL；空或 dicebear 默认图一律忽略 */
  src?: string | null;
  /** 尺寸/形状由调用方给（如 "h-8 w-8"），字号随之 */
  className?: string;
  alt?: string;
}

export function UserAvatar({ name, seed, src, className, alt }: UserAvatarProps) {
  const usableSrc = src && !src.includes("dicebear.com") ? src : "";
  if (usableSrc) {
    return (
      <img
        loading="lazy"
        decoding="async"
        src={usableSrc}
        alt={alt ?? name ?? "用户头像"}
        className={cn("rounded-full object-cover ring-1 ring-white/15", className)}
      />
    );
  }

  const displayName = (name ?? "").trim() || "U";
  const initial = displayName.charAt(0).toUpperCase();
  const paletteKey = seed || displayName;
  const [from, to] = AVATAR_PALETTES[hashKey(paletteKey) % AVATAR_PALETTES.length];

  return (
    <div
      role="img"
      aria-label={alt ?? `${displayName} 的头像`}
      className={cn(
        "flex select-none items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/15",
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${from}, ${to})`,
        containerType: "size",
      }}
    >
      {/* 字号随容器边长（45cqmin），h-8→约14px，h-20→约36px */}
      <span style={{ fontSize: "45cqmin", lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
        {initial}
      </span>
    </div>
  );
}
