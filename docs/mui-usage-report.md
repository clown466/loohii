# MUI 使用量报告（阶段3 Task 9 · 只读分析）

- 日期：2026-07-06
- 基准提交：`4db2ce1`（branch `main`）
- 目的：为「MUI → Radix」迁移决策提供数据依据。所有数字均来自本仓库实际执行的 grep/统计命令输出，未做估算。

## 1. 统计方法（实际执行的命令）

```bash
cd "H:\claude项目\loohii"

# 1) 收集 src 下所有 @mui import 行
grep -rn "from ['\"]@mui" --include="*.tsx" --include="*.ts" src \
  | sed 's/:.*from/ ->/' | sort > /tmp/mui-imports.txt
wc -l /tmp/mui-imports.txt
# 输出：0 /tmp/mui-imports.txt

# 2) 引用 @mui 的文件数
grep -rl "from ['\"]@mui" --include="*.tsx" --include="*.ts" src | wc -l
# 输出：0

# 3) 全仓库（排除 node_modules / dist / package-lock.json）任何 @mui / @emotion 引用
grep -rn "@mui\|@emotion" --include="*.tsx" --include="*.ts" --include="*.jsx" \
  --include="*.js" --include="*.mjs" --include="*.cjs" --include="*.html" \
  --include="*.css" . --exclude-dir=node_modules --exclude-dir=dist \
  --exclude=package-lock.json | grep -v "^\./package.json"
# 输出：（空，0 条）

# 4) 其他 import 形式（require / 动态 import / 双引号 from）
grep -rn "require(['\"]@mui\|import(['\"]@mui\|from \"@mui\|from '@mui" \
  -r src server tests scripts utils docs | wc -l
# 输出：0
```

## 2. 核心发现：MUI 是「零使用」的死依赖

| 指标 | 实测值 |
|---|---|
| src 下 `.ts/.tsx` 文件总数 | 98 |
| 引用 `@mui` 的文件总数 | **0** |
| `@mui` import 语句总数 | **0** |
| 全仓库（含 server/tests/scripts/utils/docs/html/css）@mui/@emotion 代码引用 | **0** |
| `require()` / 动态 `import()` 形式的 @mui 引用 | **0** |

但 `package.json`（第 19–22 行）仍声明了 4 个相关依赖：

```json
"@emotion/react": "11.14.0",
"@emotion/styled": "11.14.1",
"@mui/icons-material": "7.3.5",
"@mui/material": "7.3.5",
```

lockfile 依赖关系核验（脚本遍历 `package-lock.json` 的 packages 图）：`@mui/*` 与 `@emotion/react`、`@emotion/styled` 的依赖方**只有根 package.json 和 MUI 家族内部互相依赖**，没有任何第三方包需要它们作为传递依赖。

磁盘占用（`du -sh`）：

| 目录 | 安装体积 |
|---|---|
| `node_modules/@mui` | 109 MB |
| `node_modules/@emotion` | 2.4 MB |

## 3. 按组件名的使用频次表

Step 1 的组件名提取命令（`grep ... '@mui/material' | grep -o '{[^}]*}' | uniq -c | sort -rn`）输出为**空**。

| MUI 组件 | 使用次数 |
|---|---|
| （无任何组件被使用） | 0 |

## 4. Top 5 重度使用文件

无。没有任何文件引用 @mui（`/tmp/mui-imports.txt` 为 0 行）。

## 5. 与 Radix 等价组件对照

由于没有实际使用的 MUI 组件，无逐组件迁移对照需求。项目现状：UI 层已完全建立在 **shadcn/ui + Radix** 之上，`package.json` 中已安装 26 个 `@radix-ui/react-*` 包（accordion、alert-dialog、avatar、checkbox、dialog、dropdown-menu、popover、progress、select、slider、switch、tabs、tooltip 等 ✔），常见 MUI 组件在本项目均已有 Radix/shadcn 对应实现，不存在能力缺口。

## 6. 结论与建议

- **迁移工作量：无（低于「低」）。** 不存在「MUI → Radix」迁移任务——代码从未使用 MUI。
- **建议后续动作（本任务不执行，仅记录）：** 从 `package.json` 移除 `@mui/material`、`@mui/icons-material`、`@emotion/react`、`@emotion/styled` 4 个依赖并重装。
  - 收益：node_modules 减少约 111 MB，`npm install` 更快；由于零引用，对产物 bundle 无影响（Vite tree-shaking 下本就不会打包），风险极低。
  - 验证方式：删除后执行 `npm run build && npm run server:check` 确认通过即可。
