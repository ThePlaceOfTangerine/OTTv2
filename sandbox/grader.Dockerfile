# Grader rootfs for WSL2 / Linux / USB (Phase 7): the exact sandbox image (same g++ and Python)
# plus bubblewrap, Node.js and this project. Built by scripts/wsl/build-rootfs.ps1 from the repository root.
ARG SANDBOX_IMAGE=ottv2-sandbox:phase3
FROM ${SANDBOX_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
ARG NODE_VERSION
RUN test -n "$NODE_VERSION" \
 && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " node-v${NODE_VERSION}-linux-x64.tar.xz\$" | sha256sum -c - \
 && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 \
 && rm "node-v${NODE_VERSION}-linux-x64.tar.xz"
RUN useradd --create-home --uid 1000 --shell /bin/bash grader
COPY . /opt/ott
RUN cd /opt/ott && npm ci --omit=dev && rm -rf /root/.npm \
 && sed -i 's/\r$//' scripts/wsl/*.sh && chmod 755 scripts/wsl/*.sh
# The image ID this rootfs was built FROM; the bwrap backend reports it so jobs pinned to that image can run here.
ARG SANDBOX_IMAGE_ID
RUN test -n "$SANDBOX_IMAGE_ID" && printf '%s\n' "$SANDBOX_IMAGE_ID" > /opt/arena/IMAGE_ID \
 && printf '[user]\ndefault=grader\n[boot]\nsystemd=false\n' > /etc/wsl.conf
USER grader
WORKDIR /home/grader
ENTRYPOINT []
CMD ["/bin/bash"]
