# Mori Studio

[Mori](https://github.com/Musenxi/Astro-Theme-Mori) 博客的本地写作与排版编辑器。读写项目里的内容文件，不需要 git。

```bash
pnpm install
node bin/mori-studio.mjs --root 博客项目目录
```

打开输出的地址（默认 http://127.0.0.1:4400）。博客项目要先 `pnpm install`：Studio 用项目自己的 Astro 预览和构建，文章结构、Markdown 转换、校验也用项目里的主题代码（`package.json` 的 `exports`）。

```bash
--port 4400   # 端口
--dev         # 开发模式：构建后自动重启预览，发布目标里多一个“本地文件夹”
```

改界面：`MORI_ROOT=博客项目目录 pnpm dev:ui`（热更新，接口转发给本机的 Studio）。测试：`MORI_THEME=主题仓库目录 pnpm test`。

## MCP

让 Claude 桌面版、Claude Code 这类 AI 客户端读写博客、管评论：读和改文章（正文用 Markdown，和编辑器一样，没改的段落原样保留）、新建、发布、往文章里加图、预览、构建和发布站点、看和回复评论、审核。

```bash
node bin/mori-studio.mjs mcp --root 博客项目目录
```

这是 stdio 的 MCP 服务：这个项目已经有 Studio 在跑（命令行版或桌面版）就连过去，没有就自己起一个不带界面的。配置可以在 Studio 的“设定 → MCP”里直接复制。Studio 服务本身也在 `/mcp` 上提供 Streamable HTTP。

删除、撤回、发布到线上、删除评论这几个工具标了 destructive，客户端会先问你。

## 桌面版

### 安装

在 [Releases](https://github.com/Musenxi/Mori-Studio/releases) 下载。macOS 下载 `.dmg`（Apple 芯片选 `aarch64`，Intel 选 `x64`），把 Mori Studio 拖进“应用程序”。要先装 Node.js 22.12 或更新。

应用没有 Apple 签名，第一次打开前在终端运行一次（不然会提示“已损坏”或“无法验证开发者”）：

```bash
xattr -cr "/Applications/Mori Studio.app"
```

Windows 下载 `-setup.exe` 安装。安装包同样没有签名，如果提示“Windows 已保护你的电脑”，点“更多信息 → 仍要运行”。Windows 上管理令牌、图床密钥还存在项目的 `.mori-studio.json` 里（不进 git），导入 HEIC 和实况照片要先装 ffmpeg 或者先转成 JPEG。

之后有新版本时，打开应用会提示更新。

### 开发

```bash
pnpm desktop          # 编译并打开窗口
pnpm desktop:build    # 本机打包（.app、.dmg）
```

要先装 Rust（`brew install rustup && rustup default stable`）。桌面版是 Tauri 写的壳：启动页选项目（最近打开的记在应用设置里），给项目起一个 Studio 服务（随机端口），窗口直接打开它；菜单“项目 → 打开项目…”（⌘O）回到启动页。`mori-studio-desktop 项目目录` 直接打开。

- 用本机的 Node（从登录 shell 里找，nvm、Homebrew 装的都行）；`MORI_NODE` 可以指定。
- 打包时 `desktop/scripts/stage-studio.mjs` 把 Studio 的代码和运行依赖放进应用（`Contents/Resources/studio`）；开发时直接用仓库里的。
- 界面按项目构建在应用缓存里（`~/Library/Caches/app.mori.studio/ui/`），不动仓库里的 `dist/`。
- 评论管理令牌、图床的 Secret Key 存在系统钥匙串（“Mori Studio”），按评论服务地址 / 存储桶存，几个项目共用；命令行版也一样。以前存在 `.mori-studio.json` 里的，打开项目时自动搬进去。

### 发布

GitHub Actions（`.github/workflows/release.yml`）在推 `v*` 标签时分别打 Apple 芯片、Intel 和 Windows 三个包，连同更新包传到 Release 草稿。在 Actions 里手动运行它只打包、不建 Release，安装包在那次运行的 Artifacts 里。

1. 改 `package.json` 的 `version`（桌面版的版本号就用它），提交。
2. `git tag v0.1.0 && git push origin main --tags`
3. Actions 跑完后到 Releases 检查草稿，发布。发布以后，已经装了的应用才会收到更新。

更新包要用私钥签名，公钥在 `desktop/src-tauri/tauri.conf.json`。私钥在本机 `~/.tauri/mori-studio.key`，第一次发布前放进仓库的 Secrets：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/mori-studio.key
```

私钥要备份：丢了的话，已装的应用就收不到之后的更新，只能重新下载安装。

## 功能

- 读写项目里的内容 JSON，自动保存；保存时用主题同一份 schema 校验，问题会列出来（不阻止保存）。删除是移进 `.mori-trash/`。
- 文章：默认用 Markdown 写（一个大文本框，标题是第一行 `# 标题`，拖入图片、旁注），分类、标签、摘要、封面、首页置顶在右侧“信息”面板；也可以切到 JSON 源码。
- 读法和地图：每篇都能开。“信息”里的“读法”勾选允许读者选哪几种（竖向 / 横向 / 混合）、默认哪种、横滚方向；“地图”是一个开关，开了以后封面有路线图、左下角显示读到哪里、文末有行程表。
- 地点：在 Markdown 里选中一个词，点工具栏的“地点”，填坐标（“纬度, 经度”，也认 Google 地图的 Plus Code / Open Location Code 和地图网址；短码用上一个地点补全；地名可以留空，只让读到这里时地图跟着变）、英文名、日期，文字就变成 `[地名](geo:纬度,经度)`，是地图上的一个点；不绑定标题，想标在哪就标在哪。坐标、英文名、日期之后在“信息”里改；路线（GPX 轨迹、按照片拍摄地点建议）也在“信息”里。
- 排版：“排版”视图按横向读法把整篇排成一条（相邻的文字是一列，二级标题另起一列），直接拖：上下拖调位置，左右拖换顺序，右下角圆点改大小，选中后在上方切换单图 / 双图 / 图组 / 网格 / 自由排布、合并或拆开、插地图、文字横排或竖排；自由排布和图组里的图也能直接拖。
- 页面：“关于”“留言”这样的独立页（网址 `/页面名/`）；“页头入口”决定网站顶部玻璃胶囊里放哪些入口；“友人帐”粘贴网址自动带出站名、简介和头像。
- 文件：所有图片，谁在引用、没被引用的，上传和删除。
- 仪表盘、分类 / 标签、草稿箱、评论管理、设定（刊名、首页版式与排法、订阅内容、主题色）。
- 评论服务（[Mori-Comment](https://github.com/Musenxi/Mori-Comment)）在“评论”页或“设定 → 评论”接入：填服务地址和管理令牌，连得通才写进 `mori.config.ts`（原来用的是 Giscus 这类第三方评论会先问你再替换）；评论服务开了人机验证时，那里也填 Turnstile 站点密钥。
- “预览”用项目自己的 Astro 渲染真实页面：打开预览时在 Studio 进程里起渲染器（不另开进程、不占 4321），请求哪页渲染哪页，十分钟不用就停掉；项目已经在跑 `astro dev` 就直接用它。
- 构建与发布：在项目的 `mori.config.ts` 里加发布目标（`publish`，写法见主题的 README），然后点“构建并发布”。
