# 家庭账本

单管理员家庭记账 Web App。GitHub Pages 发布静态网页，Supabase 托管登录和账本。桌面与手机打开同一个网址即可使用同一份账本。

## 本地体验

使用 Node.js 24。

```sh
npm ci
npm run dev
```

打开终端显示的地址。可以快速记账，或在总览载入模拟账单。此模式的数据保存在当前浏览器。可通过「账户设置 → 下载备份」保存完整 JSON，或部署后用「恢复备份」迁移到云端。

## 部署到 GitHub Pages

1. 创建或选择 Supabase 项目，在 SQL Editor 执行 [数据库迁移](supabase/migrations/202611260001_ledger.sql)。
2. 在 Supabase Authentication 中手动添加管理员邮箱并确认账号，关闭公开注册。复制该用户的 UUID，在 SQL Editor 执行下面的 SQL，替换其中的占位符。
3. 将源码放到 GitHub 仓库。在 **Settings → Pages** 选择 **GitHub Actions**。在 **Settings → Secrets and variables → Actions → Variables** 添加 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`。使用以 `sb_publishable_` 开头的公钥。账单、真实备份和服务端密钥都放在仓库之外。
4. 在 Supabase 的 **Authentication → URL Configuration** 配置 Pages 站点地址，作为 Site URL 和允许的 Redirect URL。例如 `https://你的账号.github.io/你的仓库/`。登录使用邮箱链接。Supabase 默认发信服务只向项目团队邮箱发信。若管理员使用其他邮箱，需要配置自定义 SMTP。
5. 推送至 `main`，或在 Actions 中手动运行 **Deploy GitHub Pages**。访问 Pages 地址，使用管理员邮箱完成登录。双端同时编辑发生冲突时，点击「刷新账本」获取最新版本再提交。

```sql
insert into public.ledger_admins (user_id) values ('替换为管理员 UUID');
```

如需从本地网页连接云端，可将 `.env.example` 复制为 `.env.local` 填写公钥和项目 URL，并把终端显示的本地网址加入 Supabase 的 Redirect URL。

[GitHub Pages 发布设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Supabase 回跳地址](https://supabase.com/docs/guides/auth/redirect-urls) · [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## 导入、分类和记账

- 微信和支付宝支持 CSV、XLSX。CSV 可用 UTF‑8 或 GB18030。已测试的模拟格式在 [test/fixtures](test/fixtures)。银行卡使用页面提供的通用模板。
- 选默认账户和文件后，在预览按支付方式批量匹配账户，再逐项核对需要处理的流水。为信用卡、借款和不同所有人的银行卡建立独立账户。
- 同来源有订单号的流水按订单身份去重。无订单号时用原始字段组合。已入账的跨来源流水在同账户、同金额、同交易类型且时间相差不超过五分钟时成为合并候选。合并后保留两条原始来源，并只计算一次交易。
- 导入中的转账先保留为待核对。核对转出、转入账户和状态后才会改变余额。信用卡还款填为银行卡到信用卡的转账。借款本金填为借款账户到收款账户的转账，归还本金填写反向转账。
- 退款按到账日冲减净支出。有原订单号的记录可自动关联。没有关联依据时，可在账单明细选择原支出；未关联退款归入未分类。
- 余额起点填写在首笔账单之前的实际余额。日常对账差额录为余额调整。你的个人账户、对象的个人账户和共同账户分别设置归属。
- 分类建议依次使用商户规则、历史确认和原始分类。其余记录可用 AI 补充，或使用内置词库。核对后确认分类会记住该商户。
- Excel 和 CSV 用于查看明细。完整备份还包含账户、原始流水、规则和修改历史，恢复使用 JSON 文件。

## 可选的 AI 分类

部署 [classify](supabase/functions/classify/index.ts) Edge Function。服务端仅对当前项目中已经验证并授权的管理员开放，浏览器在获得确认后才提交商户和描述片段。可以保留默认设置，使用本地规则和词库。

使用已登录的 Supabase CLI，在仓库目录运行以下命令。环境文件应保存在仓库外。

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set --env-file /path/to/ledger-ai.env
supabase functions deploy classify
```

环境文件包含下面的值。

```dotenv
APP_ORIGIN=https://你的账号.github.io
AI_CHAT_COMPLETIONS_URL=https://你授权的服务/v1/chat/completions
AI_MODEL=服务支持的模型名
AI_API_KEY=服务端密钥
```

模型应支持 Chat Completions 的 JSON 对象响应。将 GitHub Actions 变量 `ENABLE_AI` 设为 `true` 后重新部署。确认服务可处理相关数据后，在导入预览点击「AI 补充分类」。

## 验证

```sh
npm test
npm run build
```

测试覆盖模拟微信 CSV、支付宝 XLSX、长订单号、异常行、重复导入、跨来源合并、工资与家庭划拨、信用卡还款、借款、部分退款、余额调整以及分类优先级。数据结构和页面原型见 [DESIGN.md](DESIGN.md)。
