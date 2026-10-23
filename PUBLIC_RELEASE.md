# Public release boundary / 公开发布边界

The editor is open source; the hosted collaboration service is protected by server-side authorization, not by hiding its endpoint or client code. A public key identifies the service and is not an administrator credential. Every access must still be authorized by the server. Never ship a secret/service-role key, database password, deployment credential, live invitation or user session.

插件源码可以公开；后台必须按成员身份、邀请码及服务端规则检查每次访问，不能依赖隐藏服务地址或混淆代码。公开配置不是管理员权限，前端校验不能代替服务端鉴权。

## Local source review

Run `node scripts/audit-public-release.mjs` in the private working checkout to review the candidate public file list. This read-only scan does not export or publish anything, and cannot certify that no secret exists. Explicitly review its exclusions and all public candidates before release.

Internal roadmaps, execution notes, personal HTML examples, operational records, live-test scripts, browser data, build caches and `.git` history are not public deliverables. Do not push the working `main` branch merely because `.gitignore` contains these names: already-tracked files and historical commits remain accessible. Review remote history separately; rewriting it requires an explicit decision and coordination. Keep internal files locally rather than deleting them to prepare a ZIP.

源码候选白名单与实际工作区分离。执行路线图、内部讨论、个人样例、运维记录和真实数据不进入公开交付物；`.gitignore` 不会清除已跟踪文件或历史。白名单审查通过不等于GitHub远端已清理，也不等于可立即公开。

## Distribution

- Source configuration uses the blank `.env.example`. Obtain a public client configuration from the service operator when building a hosted edition; never paste administrator credentials into a `VITE_` variable.
- Official installable builds may connect to the operator's service using a visible URL and public key. Keep user sessions and invitations out of build inputs and archives.
- GitHub manual-install ZIPs and Web Store ZIPs have different directory layouts. Review actual ZIP entries; a Web Store package must have `manifest.json` at its root. Source archives are not installable extension packages.
- Before public hosted release, verify deployed authorization/expiry, registration abuse controls, quotas, monitoring and recovery. Local tests or anonymous registration limits alone are not a public-security guarantee.
- Update the published privacy policy and store declarations to match the hosted build before submitting it. A local policy edit does not update the live website.

本地准备不会自动开启计费、部署SQL、改远端历史或提交商店。最终源码可复现构建、安装包目录、敏感内容、线上权限和隐私声明仍须逐项确认，不能用“地址没公开”替代这些步骤。
