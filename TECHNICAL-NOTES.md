# 技术说明与接口清单

## 数据流

插件由弹窗页和一次性页面脚本组成，没有后台服务、远程代码或遥测。

1. 用户在已登录的 `https://chatgpt.com/` 标签页打开插件。
2. 弹窗通过 `activeTab` 与 `scripting`，把自包含查询函数注入当前页面的 MAIN world。
3. 页面函数从当前登录会话临时提取 Access Token，并读取账号可访问的 Workspace。
4. 选定 Workspace 后，页面函数调用订阅预览接口，读取当前席位并分别计算 Standard +1 与 Premium +1。
5. 页面函数只把脱敏结果返回弹窗；Session、Access Token 和 Cookie 不会返回。
6. 弹窗仅用报价币种访问 Wise 公开换算页，解析中间市场汇率，并在本地完成 RMB 乘法换算。

## ChatGPT URL / 接口

所有相对路径都运行在 `https://chatgpt.com` 页面中。

| 方法 | 路径 | 用途 | 是否修改订阅 |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | 获取当前登录会话与临时 Access Token | 否 |
| GET | `/backend-api/accounts/check/v4-2023-04-27` | 读取当前账号可访问的 Workspace 列表 | 否 |
| GET | `/api/auth/session?exchange_workspace_token=true&workspace_id={id}&reason=setCurrentAccount` | 为所选 Workspace 获取对应会话上下文 | 否 |
| POST | `/backend-api/subscriptions/update/preview` | 获取当前席位结构，以及 Standard +1 / Premium +1 的本账期报价 | 否，仅预览 |
| GET | `/backend-api/subscriptions/update/preview?account_id={id}&updated_seats={n}` | 读取当前账期截止时间 | 否，仅预览 |

POST 预览请求只使用两种内部席位类型：

- `default`：Standard
- `prolite`：Premium

插件没有实现或调用任何购买确认、订阅更新、支付或成员变更接口。

## Wise URL

| 方法 | URL | 用途 |
| --- | --- | --- |
| GET | `https://wise.com/zh-cn/currency-converter/{source}-to-cny-rate` | 获取源币种兑 CNY 的公开中间市场汇率和数据时间戳 |

插件不会把 Workspace ID、报价金额、ChatGPT Session、Access Token 或 Cookie 发送给 Wise。Wise 请求只暴露源币种和目标币种 CNY；换算金额由插件本地计算。

## Cookie 与凭证处理

- Access Token 只保存在单次页面函数调用的内存中。
- 不使用 `chrome.storage`、IndexedDB 或远程服务器保存凭证。
- 为取得非当前 Workspace 的会话，脚本会临时设置 `_account`、`_account_is_fedramp` 和 `_account_residency_region`，并在 `finally` 中还原原值。
- Wise 请求使用 `credentials: "omit"`，不会携带 ChatGPT Cookie。
- UI 与复制结果中不包含 Session、Access Token、Cookie 或支付卡详情。

## 权限

- `activeTab`：仅在用户主动打开插件时访问当前标签页。
- `scripting`：在当前 ChatGPT 页面执行一次性查询函数。
- `https://wise.com/*`：从插件弹窗读取 Wise 公开币种换算页。

没有申请 `cookies`、`storage`、`tabs`、`webRequest`、`downloads` 或 `<all_urls>` 权限。

## 稳定性边界

- ChatGPT 订阅接口与字段属于网页内部接口，不是公开稳定 API。
- Wise 汇率来自公开换算页面而非需要密钥的 Wise Platform API，页面结构变化后解析器可能需要更新。
- Wise 请求超时或解析失败时，原币报价继续显示，只有人民币参考价降级为不可用。
- 当前金额是从查询时刻到本账期结束的按比例预览，不等于完整月费或年费。
