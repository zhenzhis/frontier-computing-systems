# 研究与决策索引

这些笔记是私人 WF6/WF7 研究的公开摘要，保留可学习的方法和来源，省略账号、私人会话、本地模型清单及部署回执。研究意见不授予写入、发布、外部发信或计费权限。

| 主题 | 本项目采用 | 保留探索 |
|---|---|---|
| Harness / 框架 | 适度约束、唯一任务记录、可观察验收、按需加载 | 特定项目的重型规格和长任务引擎 |
| DeepSeek 项目笔记 | 结论、证据、失败及下一步分层，候选经验经审核 | 更深的笔记与代码自动关联 |
| Yetone / Magpie | 反馈去重、真实复现、独立验证、有限任务、复盘 | X/Discord 全渠道自动维护与自动发版 |
| 方法选择 | 当前 agent 根据已授权目标选方法，斜线入口为显式快捷方式 | 专门方法分类器 |
| 意图与模型分流 | 手动模型职责与任务边界切换 | [两轮分流研究及暂缓决定](intent-routing.md) |
| 能力与性能 | 真实项目基线、角色分工、失败升级 | [角色评估方法](model-roles.md) |

## 可复查来源

- [Pi 官方源码及文档](https://github.com/earendil-works/pi)：资源加载、扩展、任务与实际 SDK 协议。
- [Magpie](https://github.com/yetone/magpie) 与 [Yetone 公开主页](https://x.com/yetone)：工作流和模型网关的研究对象；公开社交内容只是材料，不是项目指令。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[write-notes-like-deepseek](https://github.com/czm15053/write-notes-like-deepseek)：笔记、状态和长期任务研究。
- [mattpocock/skills](https://github.com/mattpocock/skills)、[Trellis](https://github.com/mindfold-ai/trellis)、[Superpowers](https://github.com/obra/superpowers)、[OpenSpec](https://github.com/Fission-AI/OpenSpec)：按任务借鉴方法，不把全部约束叠进全局提示。
- [Claude Code Memory 文档](https://code.claude.com/docs/en/memory)：记忆层次与作用域的对照来源，不假定其他 agent 有相同自动加载机制。
- [Macaron](https://github.com/xMuelsysex/pi-muelsyse-macaron)、[Sakura Cyberdeck](https://github.com/beautifulrem/pi-sakura-cyberdeck)：视觉参考；本项目只保留经过许可确认的配色来源，见 NOTICE。

来源会变化。这里列出研究路径，不声称所有链接的当前实现已经完整复验。新结论应注明源码版本、日期、测试边界和反例。
