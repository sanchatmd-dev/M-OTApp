# Run with PowerShell on Windows. Requires uv on PATH.
$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot 'runtime/openthai/Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    uv venv --python 3.12 (Join-Path $PSScriptRoot 'runtime/openthai')
    if ($LASTEXITCODE) { throw 'Python environment setup failed' }
}
uv pip install --python $python numpy==2.5.5 opencv-python-headless==5.1.0.95 pyclipper==1.4.0 onnxruntime==1.32.0
if ($LASTEXITCODE) { throw 'Python dependency installation failed' }

# Official v2.2.0 release. Inference uses only local files.
$base = 'https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118/resolve/0033e556ed93913b797bf8758bd77ee7156149cb'
$model = Join-Path $PSScriptRoot 'models/openthai-v2.2.0'
New-Item -ItemType Directory -Force (Join-Path $model 'runtime') | Out-Null
$manifest = (Invoke-WebRequest "$base/SHA256SUMS").Content
if ($manifest -is [byte[]]) { $manifest = [Text.Encoding]::UTF8.GetString($manifest) }
foreach ($name in @('NOTICE','config.json','det.yml','det.onnx','rec.onnx','rec2.onnx','rec_dict.txt','runtime/__init__.py','runtime/line_engine.py','runtime/thai_norm.py','runtime/dewarp.py')) {
    $file = Join-Path $model $name
    $pattern = '(?m)^([a-f0-9]{64})\s+(?:\./)?' + [regex]::Escape($name) + '\s*$'
    if ($manifest -notmatch $pattern) { throw "Missing checksum for $name" }
    $expected = $Matches[1]
    if ((Test-Path $file) -and (Get-FileHash $file).Hash -eq $expected) { continue }
    Invoke-WebRequest "$base/$name" -OutFile "$file.download"
    if ((Get-FileHash "$file.download").Hash -ne $expected) { throw "Checksum mismatch for $name" }
    Move-Item -Force -LiteralPath "$file.download" -Destination $file
}
