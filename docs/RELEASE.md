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

## npm registry prerequisites

Перед першим `publish=true` maintainer має підготувати npm registry state:

- npm scope `@rmem` має існувати як npm organization або user scope.
- Account/token, який використовується в GitHub Actions, має право публікувати packages у scope `@rmem`.
- GitHub secret `NPM_TOKEN` має бути granular access token з publish/write permissions для `@rmem/core` і `rmem-cli`.
- Якщо npm account має 2FA для publish, token має бути створений з bypass 2FA, інакше registry поверне `E403`.
- `repository.url` у root і workspace `package.json` має збігатися з GitHub repository з provenance: `https://github.com/sagifire/rmem-cli`.

Помилка `E404 Scope not found` для `@rmem/core` означає, що npm registry не має scope `@rmem` або authenticated account не має до нього доступу. Це не виправляється GitHub Actions workflow-ом: потрібно створити/отримати npm scope або змінити package name.

Помилка `E422 Error verifying sigstore provenance bundle` з повідомленням про `repository.url` означає, що npm package metadata не збігається з GitHub repository, з якого запускається workflow.

Помилка `E403 You cannot publish over the previously published versions` означає, що version уже існує в npm. Release workflow перевіряє `npm view` перед publish і пропускає вже опубліковані package versions, щоб повторний запуск після partial publish міг завершити решту packages.

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
npm publish --workspace rmem-cli --dry-run --access public
```

Порядок важливий: `@rmem/core` публікується перед `rmem-cli`, бо CLI залежить від core.

Перед publish workflow перевіряє, чи існують поточні versions у npm. Якщо package version уже опублікована, відповідний publish step пропускається.

## Publish with provenance

Публікація має виконуватися тільки з GitHub Actions release workflow або з контрольованого локального середовища:

```bash
npm publish --workspace @rmem/core --provenance --access public
npm publish --workspace rmem-cli --provenance --access public
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
