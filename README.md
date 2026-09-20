# ChatGPT Business 席位报价插件

这是一个非官方、适用于 Chrome / Edge 的 Manifest V3 浏览器插件。你登录 `chatgpt.com` 后点击插件，它会自动读取你有权限的 Team / Business Workspace，并分别预览：

- 当前 Standard / Premium 席位数量
- Standard 新增 1 席的本账期应付金额
- Premium 新增 1 席的本账期应付金额
- 月付或年付周期
- 当前账期截止时间（北京时间）
- 按 Wise 中间市场汇率换算的人民币参考金额

插件只调用订阅的 `preview` 接口，不调用确认购买或更新接口。

## 安装

1. 解压下载的 ZIP。
2. Chrome 打开 `chrome://extensions/`；Edge 打开 `edge://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的 `chatgpt-business-seat-checker` 文件夹。

## 使用

1. 在浏览器中打开 `https://chatgpt.com/` 并登录有 Business 权限的账号。
2. 保持 ChatGPT 标签页处于当前页面，点击浏览器工具栏里的插件图标。
3. 插件会自动查询当前或第一个 Business Workspace。
4. 如果账号有多个 Workspace，可从下拉框切换，插件会重新报价。
5. 点击“复制查询结果”可以复制脱敏后的报价信息。

## 权限与隐私

插件只申请：

- `activeTab`：仅在你主动点击插件时访问当前标签页。
- `scripting`：在当前 `chatgpt.com` 页面上下文中执行查询。
- `https://wise.com/*`：读取公开的 Wise 币种换算页面，用于获得 CNY 中间市场汇率。

它不会：

- 将 Access Token、Session 或 Cookie 写入 `chrome.storage`。
- 显示或复制完整 Session。
- 向第三方服务器上传 ChatGPT 登录数据、Workspace 信息或报价金额。
- 修改 Workspace 席位或提交付款。

Access Token 只在一次查询的页面内存中短暂使用，返回插件界面的仅有 Workspace 名称/ID、席位数量、报价与账期信息。

请求 Wise 时只包含原始币种与目标币种 CNY，不会发送 Workspace、报价金额、Session、Cookie 或 Access Token；人民币金额由插件在本地相乘计算。

## 金额说明

页面显示的 `Standard +1` 和 `Premium +1` 是后端针对“当前时间到本账期结束”的即时预览金额，可能包含按剩余天数计算的比例费用，因此不等同于一个完整月或完整年的标准单价。

人民币金额使用 Wise 换算页面公布的中间市场汇率，仅作对照。实际银行卡入账金额还可能受到发卡行汇率、跨境费和结算时间影响。

## 常见问题

### 提示“当前页面没有有效登录会话”

刷新 `chatgpt.com`，确认账号仍处于登录状态，再重新打开插件。

### 找不到 Business Workspace

当前登录账号可能只有 Personal 空间，或者已经被移出相关 Workspace。请切换到拥有该空间权限的账号。

### Premium 显示“暂不可报价”

这通常表示当前订阅、地区或 Workspace 暂不支持 `prolite`（Premium）席位，或 OpenAI 调整了内部接口。Standard 报价仍可单独使用。

### 插件突然失效

本插件使用 ChatGPT 网页内部订阅接口，并非公开稳定 API。网页接口字段或权限规则变化后，插件可能需要更新。

## 当前版本

`v1.0.0`

- 增加独立的浏览器工具栏图标与矢量源文件。
- 自动读取登录态，不需要手动复制 Session。
- 自动发现多个 Business Workspace。
- 同时预览 Standard / Premium 新增 1 席。
- 自动按 Wise 中间市场汇率显示人民币参考价与汇率更新时间。
- Wise 请求失败时自动降级，原币报价不受影响。
- 不持久化任何登录凭证。

更完整的数据流、接口清单和安全边界参见 `TECHNICAL-NOTES.md`。
