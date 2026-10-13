# 第三方来源与许可 · Third-Party Notices

本仓库包含或依赖以下第三方作品。版本号取自 `pnpm-lock.yaml` 实际安装结果。

## 一、上游方法论与知识库材料

| 作品 | 作者 / 来源 | 许可 |
| --- | --- | --- |
| goutoujunshi（方法论、`references/` 下 43 篇参考资料、行为边界与证据分级） | powerycy · <https://github.com/shengjidaguai-china/goutoujunshi> | MIT，Copyright (c) 2026 powerycy |

`references/knowledge/`（20 篇）与 `references/practical/`（23 篇）的 Markdown 原文按 MIT 条款收录，并由 `scripts/build-knowledge.mjs` 编译进 `src/data/knowledge.generated.ts`。

**注意**：这些材料本身是中文互联网语境的整理，其中引用的外部来源（百科、视频、公众号文章等）未经本程序独立核实，也各有其自身许可。材料内部按「较强证据 / 理论框架 / 流行说法 / 经验策略」四级自评，引用时应保留该分级，不要当成经同行评议的结论。部分 material 末尾带有「文档部分内容可能由 AI 生成」的注记。

## 二、运行时依赖

| 包 | 版本 | 许可 |
| --- | --- | --- |
| react / react-dom | 19.3.0 | MIT |
| vite | 8.3.4 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | MIT |
| @base-ui/react | 1.9.0 | MIT |
| @tabler/icons-react | 3.49.0 | MIT |
| lucide-react | 1.55.0 | ISC |
| echarts | 6.1.0 | Apache-2.0 |
| zustand | 5.0.15 | MIT |
| dexie | 4.4.6 | Apache-2.0 |
| zod | 4.6.6 | MIT |
| clsx | 2.1.1 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| cmdk | 1.1.1 | MIT |
| cn | 0.4.0 | MIT |
| tw-animate-css | 1.4.0 | MIT |

## 三、开发依赖

| 包 | 版本 | 许可 |
| --- | --- | --- |
| shadcn（CLI，用于生成 `src/components/ui/` 下的组件） | 4.21.4 | MIT |
| oxlint | 1.87.0 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |

## 四、纳入本仓库源码的生成物

`src/components/ui/` 下的 28 个组件由 shadcn CLI 依 [ui.shadcn.com](https://ui.shadcn.com) 的 `base-nova` 预设生成后纳入版本控制（这是 shadcn 的设计：组件是复制进项目的源码，不是黑盒依赖）。这些组件：MIT 许可，源自 shadcn/ui，底层基于 Base UI（MIT）。

`src/index.css` 中的主题层改写自 shadcn 随包分发的 Tailwind v4 preset（`node_modules/shadcn/dist/tailwind.css`，MIT），并追加了本项目专用的证据分级与 K 线方向语义色。

## 五、为什么同时存在两套图标库

界面与领域图标统一用 `@tabler/icons-react`（MIT）。但 shadcn 生成的 7 个组件（checkbox、command、dialog、dropdown-menu、select、sheet、sonner）内部 import 了 `lucide-react`（ISC）。为避免大规模重写生成代码带来的尺寸与对齐回归，这里选择保留两套：**Tabler 用于我们自己写的组件，lucide 只留在 shadcn 生成物内部，不新增 lucide 用法。**

## 六、字体与外部资源

本程序不加载任何外部字体、图标 CDN、埋点或第三方脚本。生产构建会注入 `Content-Security-Policy`（`script-src 'self'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'none'`），因此页面里不存在来源不明的可执行内容。
