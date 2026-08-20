# 划词翻译助手 WordWise（浏览器扩展）

Manifest V3 浏览器插件：在任意网页上划词/选词后，文字旁边自动出现插件 Logo，点击 Logo 展示中英互译与网络翻译，支持点击朗读，并在再次选中已学习过的内容时显示「已学习」标记。

## 功能特性

- 划词即显：选中网页文字后，自动在选区末尾悬浮插件 Logo（蓝底白气泡「译」图标）
- 取消即隐：点击页面其它位置、按 Esc 或滚动页面，Logo 自动隐藏；重新划词后再次出现
- 中英互译：翻译卡片同时展示「英 → 中」与「中 → 英」两个方向（Google 自动检测语种）
- 网络翻译：额外展示网络翻译结果（MyMemory 公开 API），两个独立翻译源互为补充
- 点击朗读：源文本与每条译文旁均有 🔊 按钮，使用浏览器内置 TTS 朗读，中英文自动匹配语音
- 学习标记：查看过翻译的内容自动记入本地学习记录；再次选中相同内容时，Logo 显示绿色「已学 N」徽标，卡片内显示「已学习 N 次」
- 学习记录面板：点击工具栏图标打开，可搜索、删除、清空全部学习记录
- 复制译文：点击任意译文即可复制
- 设置项：打开卡片自动朗读、网络翻译开关、已学习标记开关、朗读语速
- 界面使用 Shadow DOM 注入，不会受网页样式干扰

## 安装方法

1. 打开 Chrome 或 Edge，地址栏访问 chrome://extensions（Edge 为 edge://extensions）
2. 打开右上角「开发者模式」开关
3. 点击「加载已解压的扩展程序」，选择本项目 wordwise-extension 文件夹
4. 打开任意网页，选中一段文字试试

## 使用方法

1. 用鼠标划选网页上的英文或中文文字，选区右侧会出现蓝色「译」Logo
2. 点击 Logo，弹出翻译卡片：
   - 顶部：源文本 + 检测语种 + 学习状态（已学习 N 次 / 首次学习）+ 朗读按钮
   - 中英互译：英 → 中、中 → 英 两行译文（Google）
   - 网络翻译：网络译文（MyMemory）
   - 点击译文复制，点击 🔊 朗读
3. 再次选中曾经学过的内容时，Logo 上会出现绿色「已学 N」徽标
4. 点击工具栏的插件图标，可查看学习记录、调整设置

## 目录结构

    wordwise-extension/
    ├── manifest.json      # MV3 清单
    ├── background.js      # Service Worker：Google + MyMemory 翻译请求
    ├── content.js         # 内容脚本：划词检测、Logo、翻译卡片、朗读、学习标记
    ├── popup.html / css / js  # 设置与学习记录面板
    ├── icons/             # 扩展图标（16/32/48/128）
    ├── tools/gen-icons.js # 图标生成脚本（纯 Node，无依赖）
    └── README.md

## 技术说明

- Manifest V3：Service Worker 后台执行网络请求（fetch），规避页面 CORS 限制
- 翻译源一：Google 非官方接口 translate.googleapis.com/translate_a/single（无需 Key，自动检测语种）
- 翻译源二：MyMemory 公开 API api.mymemory.translated.net（网络翻译）
- 朗读：Web Speech API（speechSynthesis），无需额外权限
- 存储：chrome.storage.local，学习记录仅保存在本机浏览器；词条上限 3000，自动清理最久未学习的条目
- 兼容 Firefox：代码同时兼容 browser.* / chrome.* API

## 注意事项

- 两个翻译服务均为免费公开接口，可能限流或变更；失败时卡片会给出明确提示（网络翻译失败不影响互译展示）
- 翻译文本会发送给 Google / MyMemory 第三方服务，请勿用于敏感内容
- 朗读效果取决于操作系统安装的语音包
- 仅在网页（http/https）内生效；浏览器内置页面（chrome:// 等）与 PDF 查看器无法注入
- 划词发生在 iframe 内时，顶部页面不会弹出 Logo（默认仅顶层页面注入）

## 排障（划词后没有出现 Logo？）

按顺序检查：

1. 安装扩展后，**必须刷新已打开的网页**（内容脚本只在页面加载时注入）
2. 确认扩展已启用：chrome://extensions 里找到「划词翻译助手」，开关为打开状态，且无红色报错
3. 打开网页按 F12 → Console，查找「[WordWise]」前缀日志：
   - 看到「[WordWise] content script loaded」= 脚本已注入；划词后应看到「[WordWise] 划词显示 Logo: ...」
   - 没有任何「[WordWise]」日志 = 脚本未注入（检查第 1、2 步）
4. 换一个普通网站测试（如 example.com、百度），排除 iframe / 特殊页面因素
5. 若 Console 有红色报错，请把报错信息反馈给开发者