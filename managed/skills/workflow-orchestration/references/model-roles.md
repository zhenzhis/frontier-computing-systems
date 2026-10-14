# Model roles

Reviewed 2026-10-14. These are task-role candidates, not endpoint measurements or an instruction to change models. Intent routing is deferred; manual model selection remains the baseline.

- Daily implementation: GPT-6.1 Sol, high as a starting effort.
- Hard implementation/review: Claude Opus 5.5.
- Terminal/UI: Claude Sonnet 5.5 or Opus.
- Independent reasoning/vision review: GPT-6 Astra, scoped evidence.
- Long-document synthesis: Kimi K3; AA-LCR covers 10K–100K, not guaranteed 1M accuracy.
- Bounded extraction: GLM Flash, DeepSeek Flash, GPT-6 Luna; validate tool and image support on the actual endpoint.
- Decision models such as Jev classify constrained choices; they never grant authority. No decision model is installed or called by this package.

Different providers of the same model improve availability, not review independence. Official capacity and price do not override channel-specific limits or subscriptions. See docs/research/model-roles.md.
