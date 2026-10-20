# Run once on the organizer machine (needs Docker and the built sandbox image: npm run sandbox:build).
# Produces ott-grader.tar for scripts/wsl/setup-grader.ps1; grader machines then need no Docker.
param([string]$Output = 'ott-grader.tar', [string]$SandboxImage = 'ottv2-sandbox:phase3')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$docker = if ($env:DOCKER_BIN) { $env:DOCKER_BIN } else { 'docker' }
$imageId = (& $docker image inspect $SandboxImage --format '{{.Id}}')
if ($LASTEXITCODE -ne 0) { throw "Không thấy image $SandboxImage. Chạy npm run sandbox:build trước." }
$nodeVersion = (node --version).TrimStart('v')
& $docker build -f "$root\sandbox\grader.Dockerfile" --build-arg "SANDBOX_IMAGE=$SandboxImage" --build-arg "SANDBOX_IMAGE_ID=$imageId" --build-arg "NODE_VERSION=$nodeVersion" -t ottv2-grader:latest $root
if ($LASTEXITCODE -ne 0) { throw 'Build rootfs thất bại.' }
$container = (& $docker create ottv2-grader:latest)
try { & $docker export $container -o $Output; if ($LASTEXITCODE -ne 0) { throw 'docker export thất bại.' } }
finally { & $docker rm $container | Out-Null }
"Đã tạo $Output · image sandbox $imageId · Node $nodeVersion"
