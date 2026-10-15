FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ libseccomp2 nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*
COPY supervisor.py /opt/arena/supervisor.py
USER 65534:65534
WORKDIR /work
ENV LANG=C.UTF-8 TZ=UTC PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["/usr/bin/python3", "-I", "-B", "/opt/arena/supervisor.py"]
