# Release Checklist

Цей документ описує контрольований release process для `rmem-cli` і `@rmem/core`.

Реліз не повинен виконуватися автоматично після merge. Публікація npm package має бути manual, explicit і gated перевірками нижче.

## Preconditions

- Робоче дерево clean.
- `package.json`, `packages/rmem-cli/package.json` і `packages/rmem-core/package.json` мають узгоджені versions.
- `packages/rmem-cli/package.json` залежить від тієї ж версії `@rmem/core`.
- `README.md`, `DOCUMENTATION.md` і package README актуальні.
- `CHANGELOG.md` містить запис для версії, що публікується.
- Немає пошкодженого UTF-8 або mojibake в документації, tests і fixtures.

## Required validation

```bash
npm ci
npm run check
```

`npm run check` виконує:

- TypeScript build
- automated tests
- package install smoke з real tarballs
- package dry-run

## Optional local model validation

Перед release, який змінює providers, embeddings, notes або search, виконати:

```powershell
npm run smoke:real-models
```

Цей сценарій потребує:

- Ollama на `http://localhost:11434`
- модель `qwen2.5:7b`
- BGE-M3 server на `http://localhost:8765`
- CUDA-ready Python runtime для `BAAI/bge-m3`

## npm publish dry-run

Перед публікацією виконати dry-run:

```bash
npm publish --workspace @rmem/core --dry-run --access public
npm publish --workspace rmem-cli --dry-run
```

Порядок важливий: `@rmem/core` публікується перед `rmem-cli`, бо CLI залежить від core.

## Publish with provenance

Публікація має виконуватися тільки з GitHub Actions release workflow або з контрольованого локального середовища:

```bash
npm publish --workspace @rmem/core --provenance --access public
npm publish --workspace rmem-cli --provenance
```

Якщо provenance недоступний у локальному середовищі, не публікувати локально без окремого рішення maintainer-а.

## Versioning rules

- Patch: bug fixes, docs, packaging fixes without command contract changes.
- Minor: new dev commands, provider adapters, non-breaking response additions.
- Major: public command contract changes, response shape breaking changes, package export changes that remove previously supported public API.

## Release notes

Release notes мають включати:

- public command changes
- provider/config changes
- package/install changes
- migration notes
- validation summary

Перед release ці пункти мають бути синхронізовані з `CHANGELOG.md`.

## Rollback

Якщо package опубліковано з критичною помилкою:

1. Не видаляти npm package без окремої оцінки impact.
2. Підготувати patch release.
3. Перевірити `npm run check`.
4. Опублікувати patch з release notes, що описують проблему.
