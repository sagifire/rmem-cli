# BGE-M3 Server for Windows

This server is the Docker-free embedding backend for `rmem-cli` on Windows.

It uses:

- Python 3.11
- PyTorch CUDA
- `FlagEmbedding`
- `BAAI/bge-m3`
- FastAPI/Uvicorn

## Project-local venv

Recommended runtime path:

```powershell
.runtime\bge-m3-venv
```

The folder is ignored by git.

## Install dependencies

```powershell
py -3.11 -m venv .runtime\bge-m3-venv
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install --upgrade pip
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu121
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install -r tools\bge-m3-server\requirements.txt
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install --force-reinstall --no-deps --no-cache-dir torch==2.5.1+cu121 --index-url https://download.pytorch.org/whl/cu121
```

## Run

```powershell
.\.runtime\bge-m3-venv\Scripts\python.exe -m uvicorn tools.bge-m3-server.server:app --host 127.0.0.1 --port 8765
```

PowerShell module syntax does not support dashes in package names. Prefer direct file execution:

```powershell
.\.runtime\bge-m3-venv\Scripts\python.exe -m uvicorn server:app --app-dir tools\bge-m3-server --host 127.0.0.1 --port 8765
```

The first run downloads `BAAI/bge-m3` from Hugging Face.

Model cache is stored under:

```text
.runtime/huggingface
```

## Health

```powershell
Invoke-RestMethod http://localhost:8765/health
```

## Embed

```powershell
$body = @{ texts = @('test text') } | ConvertTo-Json
Invoke-RestMethod http://localhost:8765/embed -Method Post -ContentType 'application/json' -Body $body
```
